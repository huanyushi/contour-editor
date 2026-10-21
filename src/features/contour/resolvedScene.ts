import { arcThrough, pointOnArc, type CircularArc } from '../../lib/arc'
import {
  constructAvoidance,
  sourceEdge,
  sourcePointAt,
  type AvoidanceConstruction,
  type AvoidanceInterval,
} from './avoidanceConstruction'
import { isValidPoint, type ComplexPoint } from '../../lib/geometry'
import type { LabelSettings } from './appearance'
import type { Avoidance, AvoidancePart } from './avoidanceTypes'
import type { ContourState, PathSegment, Vertex } from './model'
import { activeSegments, isSingleCycle, validTopology } from './pathTopology'

export type SceneDocument = Pick<
  ContourState,
  | 'vertices'
  | 'segments'
  | 'connections'
  | 'markers'
  | 'formulas'
  | 'closed'
  | 'appearance'
  | 'avoidances'
>

export type SegmentOrigin = {
  sourceSegmentId: string
  collection: 'contour' | 'connection'
} & ({ kind: 'source' | 'gap' } | { kind: 'avoidance'; avoidanceId: string; part: AvoidancePart })
export type ResolvedSegment = PathSegment & {
  origin: SegmentOrigin
  /** Authoritative generated circle, independent of world-coordinate refit rounding. */
  resolvedArc?: CircularArc
  /** Explicit part override, distinct from the inherited effective stroke. */
  arrowOverride?: boolean
}
export interface ResolvedSegmentLabel {
  target: { kind: 'segment'; id: string; part: 'label' }
  anchor: ComplexPoint
  value: LabelSettings
}
export interface ResolvedScene {
  points: ReadonlyMap<string, Vertex>
  contourSegments: readonly ResolvedSegment[]
  connectionSegments: readonly ResolvedSegment[]
  chains: ReadonlyMap<string, readonly ResolvedSegment[]>
  labels: readonly ResolvedSegmentLabel[]
  origins: ReadonlyMap<string, SegmentOrigin>
}
export type SceneResolution = { ok: true; scene: ResolvedScene } | { ok: false; error: string }

const samePoint = (a: ComplexPoint, b: ComplexPoint) => a.re === b.re && a.im === b.im

/** Source validation and expansion only; scene-level conflicts are validated separately. */
export function resolveScene(document: SceneDocument): SceneResolution {
  try {
    return resolveSceneUnchecked(document)
  } catch (error) {
    return {
      ok: false,
      error: `派生场景数值构造失败：${error instanceof Error ? error.message : '无法可靠计算路径。'}`,
    }
  }
}

function resolveSceneUnchecked(document: SceneDocument): SceneResolution {
  const invalid = (error: string): SceneResolution => ({ ok: false, error })
  // Keep this module independent of sceneObjects: its public queries call this resolver.
  const sourcePoints = [...document.vertices, ...document.markers]
  const sourceSegments = [...document.segments, ...document.connections]
  const ids = new Set<string>()
  for (const object of [
    ...sourcePoints,
    ...document.formulas,
    ...sourceSegments,
    ...document.avoidances,
  ]) {
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(object.id)) return invalid(`源对象 ID 格式无效：${object.id}`)
    if (ids.has(object.id)) return invalid(`源对象或绕行 ID 重复：${object.id}`)
    ids.add(object.id)
  }
  for (const point of [...sourcePoints, ...document.formulas]) {
    if (!isValidPoint(point)) return invalid(`源对象 ${point.id} 的坐标不是可绘制的有限数值。`)
  }
  for (const point of sourcePoints)
    if (
      !['ordinary', 'pole', 'isolated', 'branch'].includes(
        point.mathematicalKind === undefined ? 'ordinary' : point.mathematicalKind,
      )
    )
      return invalid(`源点 ${point.id} 的数学类型无效。`)
  const points = new Map(sourcePoints.map((point) => [point.id, point]))
  const contourPointIds = new Set(document.vertices.map((point) => point.id))
  const connections = new Set(document.connections.map((segment) => segment.id))
  const linePairs = new Set(
    document.segments
      .filter((s) => s.kind === 'line')
      .map((s) => [s.startId, s.endId].sort().join(':')),
  )
  for (const segment of sourceSegments) {
    const start = points.get(segment.startId),
      end = points.get(segment.endId)
    if (!start || !end || start.id === end.id)
      return invalid(`源路径 ${segment.id} 的端点引用无效。`)
    if (
      !connections.has(segment.id) &&
      (!contourPointIds.has(start.id) || !contourPointIds.has(end.id))
    )
      return invalid(`围道路径 ${segment.id} 的端点必须来自围道顶点。`)
    if (connections.has(segment.id)) {
      if (samePoint(start, end)) return invalid(`独立路径 ${segment.id} 的端点位置不能相同。`)
      if (segment.kind === 'line') {
        const pair = [start.id, end.id].sort().join(':')
        if (linePairs.has(pair)) return invalid(`独立路径 ${segment.id} 的直线段连接重复。`)
        linePairs.add(pair)
      }
    }
    if (segment.kind === 'arc') {
      const result = arcThrough(start, end, segment.through)
      if (!result.ok) return invalid(`源路径 ${segment.id}：${result.error}`)
    }
  }
  if (!validTopology(document.vertices, document.segments))
    return invalid('源围道拓扑存在分叉或局部环路。')
  if (
    document.closed &&
    (!isSingleCycle(document) ||
      (document.vertices.length < 3 && !document.segments.some((s) => s.kind === 'arc')))
  )
    return invalid('源围道拓扑不能构成有效闭合围道。')

  type Binding = {
    avoidance: Avoidance
    construction: AvoidanceConstruction
    trim: AvoidanceInterval
  }
  const bindings = new Map<string, Binding[]>()
  const pairs = new Set<string>()
  const visible = new Set([...activeSegments(document), ...document.connections].map((s) => s.id))
  const enabled = new Set<string>()
  // Validate hidden bindings too; only logical ownership survives while hidden.
  for (const avoidance of document.avoidances) {
    const pair = `${avoidance.markerId}:${avoidance.targetSegmentId}:${avoidance.exitSegmentId ?? ''}`
    if (pairs.has(pair)) return invalid(`绕行 ${avoidance.id} 的奇点与源路径绑定重复。`)
    pairs.add(pair)
    const result = constructAvoidance(document, avoidance)
    if (!result.ok) return result
    if (result.value.trims.every((trim) => visible.has(trim.sourceSegmentId)))
      enabled.add(avoidance.id)
    for (const trim of result.value.trims) {
      const group = bindings.get(trim.sourceSegmentId) ?? []
      group.push({ avoidance, construction: result.value, trim })
      bindings.set(trim.sourceSegmentId, group)
    }
  }

  const origins = new Map<string, SegmentOrigin>()
  for (const segment of sourceSegments) {
    origins.set(segment.id, {
      kind: 'source',
      sourceSegmentId: segment.id,
      collection: connections.has(segment.id) ? 'connection' : 'contour',
    })
  }
  // Ownership belongs to the retained source declaration, not its visibility.
  // Keep selections (including gaps, labels and mixed batches) routable without
  // adding hidden geometry, joints, chains or label anchors to the actual scene.
  for (const [sourceId, group] of bindings) {
    group.sort((a, b) => a.trim.startT - b.trim.startT)
    const origin = origins.get(sourceId)!
    for (const { avoidance } of group) {
      origins.set(`gap:${sourceId}:before:${avoidance.id}`, { ...origin, kind: 'gap' })
      origins.set(`gap:${sourceId}:after:${avoidance.id}`, { ...origin, kind: 'gap' })
      if (sourceId !== avoidance.targetSegmentId) continue
      for (const part of ['entry', 'arc', 'exit'] as const)
        origins.set(`avoid:${avoidance.id}:${part}`, {
          ...origin,
          kind: 'avoidance',
          avoidanceId: avoidance.id,
          part,
        })
    }
  }
  const chains = new Map<string, readonly ResolvedSegment[]>()
  const labels: ResolvedSegmentLabel[] = []
  const addLabel = (
    id: string,
    value: LabelSettings | undefined,
    chain: readonly ResolvedSegment[],
  ) => {
    if (value && chain.length)
      labels.push({
        target: { kind: 'segment', id, part: 'label' },
        anchor: chainMidpoint(chain, points),
        value,
      })
  }
  const expand = (source: PathSegment): ResolvedSegment[] => {
    const origin = origins.get(source.id)!
    const ordered = (bindings.get(source.id) ?? []).filter((b) => enabled.has(b.avoidance.id))
    if (!ordered.length) {
      const chain = [{ ...source, origin }]
      chains.set(source.id, chain)
      addLabel(source.id, source.label, chain)
      return chain
    }
    const chain: ResolvedSegment[] = []
    const style = { ...document.appearance.stroke, ...source.style }
    let cursor = source.startId
    let cursorT = 0
    const edge = sourceEdge(document, source)
    const joint = (id: string, point: ComplexPoint, previous?: string): string => {
      if (previous && samePoint(points.get(previous)!, point)) return previous
      points.set(id, { id, re: point.re, im: point.im })
      return id
    }
    const gap = (id: string, startId: string, endId: string, startT: number, endT: number) => {
      if (startId === endId || endT <= startT) return
      const gapOrigin = origins.get(id)!
      const common = { id, startId, endId, style, origin: gapOrigin }
      chain.push(
        edge.kind === 'arc'
          ? { ...common, kind: 'arc', through: sourcePointAt(edge, (startT + endT) / 2) }
          : { ...common, kind: 'line' },
      )
    }
    for (const { avoidance, construction, trim } of ordered) {
      const g = construction.geometry
      const prefix = `avoid:${avoidance.id}`
      if (source.id === avoidance.exitSegmentId) {
        cursor = joint(`${prefix}:exit-point`, g.exit)
        cursorT = trim.endT
        continue
      }
      const entryMerged = g.onLine || samePoint(g.entryBase, g.entry)
      const exitMerged = g.onLine || samePoint(g.exitBase, g.exit)
      const entryBase = joint(`${prefix}:entry-base`, entryMerged ? g.entry : g.entryBase, cursor)
      const entry = entryMerged ? entryBase : joint(`${prefix}:entry-point`, g.entry)
      const exit = joint(`${prefix}:exit-point`, g.exit)
      const exitBase = exitMerged ? exit : joint(`${prefix}:exit-base`, g.exitBase)
      gap(`gap:${source.id}:before:${avoidance.id}`, cursor, entryBase, cursorT, trim.startT)
      const part = (name: AvoidancePart, startId: string, endId: string) => {
        const id = `${prefix}:${name}`
        const partOrigin = origins.get(id)!
        if (startId === endId) return
        const common = {
          id,
          startId,
          endId,
          style: { ...style, ...avoidance.partStyles?.[name] },
          origin: partOrigin,
          arrowOverride: avoidance.partStyles?.[name]?.arrows,
        }
        const segment: ResolvedSegment =
          name === 'arc'
            ? { ...common, kind: 'arc', through: g.through, resolvedArc: g.arc }
            : { ...common, kind: 'line' }
        chain.push(segment)
        addLabel(id, avoidance.partLabels?.[name], [segment])
      }
      part('entry', entryBase, entry)
      part('arc', entry, exit)
      part('exit', exit, exitBase)
      cursor = exitBase
      cursorT = trim.endT
    }
    gap(`gap:${source.id}:after:${ordered.at(-1)!.avoidance.id}`, cursor, source.endId, cursorT, 1)
    chains.set(source.id, chain)
    addLabel(source.id, source.label, chain)
    return chain
  }
  const contourSegments = activeSegments(document).flatMap(expand)
  const connectionSegments = document.connections.flatMap(expand)
  return {
    ok: true,
    scene: { points, contourSegments, connectionSegments, chains, labels, origins },
  }
}

function chainMidpoint(
  chain: readonly ResolvedSegment[],
  points: ReadonlyMap<string, Vertex>,
): ComplexPoint {
  const measures = chain.map((segment) => {
    const start = points.get(segment.startId)!,
      end = points.get(segment.endId)!
    if (segment.kind === 'arc') {
      const result = arcThrough(start, end, segment.through)
      if (!result.ok) throw new Error(`派生圆弧 ${segment.id} invariant：${result.error}`)
      const arc = segment.resolvedArc ?? result.arc
      return { length: arc.radius * Math.abs(arc.sweep), at: (t: number) => pointOnArc(arc, t) }
    }
    return {
      length: Math.hypot(end.re - start.re, end.im - start.im),
      at: (t: number) => ({
        re: start.re + (end.re - start.re) * t,
        im: start.im + (end.im - start.im) * t,
      }),
    }
  })
  let remaining = measures.reduce((sum, measure) => sum + measure.length, 0) / 2
  for (const measure of measures) {
    if (remaining <= measure.length)
      return measure.at(measure.length ? remaining / measure.length : 0)
    remaining -= measure.length
  }
  return points.get(chain.at(-1)!.endId)!
}
