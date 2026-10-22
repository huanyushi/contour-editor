import { arcThrough, pointOnArc } from '../../lib/arc'
import { edgePointAt, type SourceInterval } from '../../lib/connectedAvoidanceGeometry'
import type { ComplexPoint } from '../../lib/geometry'
import type { LabelSettings } from './appearance'
import { sourceEdge } from './avoidanceConstruction'
import type { ConstructionTable, ParentConstruction } from './avoidanceConstructionTypes'
import type { Vertex } from './model'
import { activeSegments } from './pathTopology'
import { sourcePieceId, pieceAppearance, type SourcePieceBoundary } from './sourcePieces'
import type {
  ResolvedSegment,
  ResolvedSegmentLabel,
  SceneDocument,
  SceneResolution,
  SegmentOrigin,
} from './resolvedScene'

const same = (a: ComplexPoint, b: ComplexPoint) => a.re === b.re && a.im === b.im

function midpoint(
  chain: readonly ResolvedSegment[],
  points: ReadonlyMap<string, Vertex>,
): ComplexPoint {
  const measures = chain.map((s) => {
    const start = points.get(s.startId)!,
      end = points.get(s.endId)!
    if (s.kind === 'line')
      return {
        length: Math.hypot(end.re - start.re, end.im - start.im),
        at: (t: number) => ({
          re: (1 - t) * start.re + t * end.re,
          im: (1 - t) * start.im + t * end.im,
        }),
      }
    const fit = arcThrough(start, end, s.through)
    if (!fit.ok) throw new Error(fit.error)
    const arc = s.resolvedArc ?? fit.arc
    return { length: arc.radius * Math.abs(arc.sweep), at: (t: number) => pointOnArc(arc, t) }
  })
  let left = measures.reduce((sum, m) => sum + m.length, 0) / 2
  for (const m of measures) {
    if (left <= m.length) return m.at(m.length ? left / m.length : 0)
    left -= m.length
  }
  return points.get(chain.at(-1)!.endId)!
}

/** Splice all source replacements and all child cuts before exposing actual edges. */
export function spliceSourcePaths(
  document: SceneDocument,
  table: ConstructionTable,
): SceneResolution {
  const points = new Map([...document.vertices, ...document.markers].map((p) => [p.id, p]))
  const sources = [...document.segments, ...document.connections]
  const sourceMap = new Map(sources.map((s) => [s.id, s]))
  const declarations = new Map(document.avoidances.map((a) => [a.id, a]))
  const connections = new Set(document.connections.map((s) => s.id))
  const visible = new Set([...activeSegments(document), ...document.connections].map((s) => s.id))
  const enabled = new Set(
    [...table.parents.values()]
      .filter((p) => p.trims.every((t) => visible.has(t.sourceSegmentId)))
      .map((p) => p.id),
  )
  const origins = new Map<string, SegmentOrigin>()
  const chains = new Map<string, readonly ResolvedSegment[]>()
  const partChains = new Map<string, readonly ResolvedSegment[]>()
  const labels: ResolvedSegmentLabel[] = []
  const groups = new Map<string, { parent: ParentConstruction; trim: SourceInterval }[]>()
  const nodes = new Map<
    string,
    { entryBase: string; entry: string; exit: string; exitBase: string }
  >()
  const replacements = new Map<string, readonly ResolvedSegment[]>()
  for (const s of sources)
    origins.set(s.id, {
      kind: 'source',
      sourceSegmentId: s.id,
      collection: connections.has(s.id) ? 'connection' : 'contour',
    })
  const joint = (id: string, p: ComplexPoint, reuse?: string, localScale = 0): string => {
    if (reuse) {
      const source = points.get(reuse)!
      // Only an explicit t=0/1 topology match may reuse a real vertex. Never
      // merge unrelated IDs by proximity; preserve the source's exact position.
      const roundoff =
        8 *
        Number.EPSILON *
        Math.max(Math.abs(source.re), Math.abs(source.im), Math.abs(p.re), Math.abs(p.im))
      if (Math.hypot(source.re - p.re, source.im - p.im) <= 1e-9 * localScale + roundoff)
        return reuse
      throw new Error(`接入口 ${id} 与源顶点 ${reuse} 在当前精度下无法保持接合。`)
    }
    points.set(id, { id, re: p.re, im: p.im })
    return id
  }
  const addLabel = (
    id: string,
    value: LabelSettings | undefined,
    chain: readonly ResolvedSegment[],
  ) => {
    if (value && chain.length)
      labels.push({
        target: { kind: 'segment', id, part: 'label' },
        anchor: midpoint(chain, points),
        value,
      })
  }
  for (const parent of table.parents.values()) {
    const base = origins.get(parent.primarySourceId)!
    const sourceIds = [...new Set(parent.trims.map((t) => t.sourceSegmentId))]
    const rootOrigin = parent.mode === 'corridor' ? { ...base, sourceSegmentIds: sourceIds } : base
    for (const part of ['entry', 'arc', 'exit'] as const)
      origins.set(`avoid:${parent.id}:${part}`, {
        ...rootOrigin,
        kind: 'avoidance',
        avoidanceId: parent.id,
        part,
      })
    for (const trim of parent.trims) {
      const group = groups.get(trim.sourceSegmentId) ?? []
      group.push({ parent, trim })
      groups.set(trim.sourceSegmentId, group)
    }
    for (const child of table.clearances.values()) {
      if (child.parentAvoidanceId !== parent.id) continue
      for (const part of ['bank-entry', 'bank-exit'] as const)
        origins.set(`avoid:${child.id}:${part}`, {
          ...rootOrigin,
          kind: 'avoidance',
          avoidanceId: child.id,
          parentAvoidanceId: parent.id,
          part,
        })
    }
    if (!enabled.has(parent.id)) continue
    const g = parent.geometry,
      prefix = `avoid:${parent.id}`
    const first = parent.trims[0],
      last = parent.trims.at(-1)!
    const firstSource = sourceMap.get(first.sourceSegmentId)!,
      lastSource = sourceMap.get(last.sourceSegmentId)!
    const entryBase = joint(
      `${prefix}:entry-base`,
      g.entryBase,
      first.startT === 0 ? firstSource.startId : undefined,
      g.arc.radius,
    )
    const entry = same(g.entryBase, g.entry) ? entryBase : joint(`${prefix}:entry-point`, g.entry)
    const exitBase = joint(
      same(g.exit, g.exitBase) ? `${prefix}:exit-point` : `${prefix}:exit-base`,
      g.exitBase,
      last.endT === 1 ? lastSource.endId : undefined,
      g.arc.radius,
    )
    const exit = same(g.exit, g.exitBase) ? exitBase : joint(`${prefix}:exit-point`, g.exit)
    nodes.set(parent.id, { entryBase, entry, exit, exitBase })
    const declaration = declarations.get(parent.id)!
    const style = { ...document.appearance.stroke, ...sourceMap.get(parent.primarySourceId)!.style }
    const replacement: ResolvedSegment[] = []
    for (const part of ['entry', 'arc', 'exit'] as const) {
      const id = `${prefix}:${part}`
      const startId = part === 'entry' ? entryBase : part === 'arc' ? entry : exit
      const endId = part === 'entry' ? entry : part === 'arc' ? exit : exitBase
      if (startId === endId) continue
      const partStyle = { ...style, ...declaration.partStyles?.[part] }
      const common = {
        id,
        startId,
        endId,
        style: partStyle,
        origin: origins.get(id)!,
      }
      let parts: ResolvedSegment[]
      if (part === 'arc')
        parts = [{ ...common, kind: 'arc', through: g.through, resolvedArc: g.arc }]
      else {
        const cuts = [...table.clearances.values()]
          .filter((c) => c.parentAvoidanceId === parent.id)
          .flatMap((c) =>
            c.cuts.filter((cut) => cut.bank === part).map((cut) => ({ childId: c.id, cut })),
          )
          .sort((a, b) => a.cut.startT - b.cut.startT || a.childId.localeCompare(b.childId))
        if (!cuts.length) parts = [{ ...common, kind: 'line' }]
        else {
          parts = []
          let cursorId = startId,
            cursorT = 0
          const addRetained = (retainedId: string, end: string, endT: number) => {
            if (endT > cursorT && end !== cursorId) {
              origins.set(retainedId, common.origin)
              parts.push({ ...common, id: retainedId, kind: 'line', startId: cursorId, endId: end })
            }
          }
          for (const { childId, cut } of cuts) {
            if (cut.startT < cursorT)
              return { ok: false, error: `两岸避让 ${childId} 在父绕行 ${parent.id} 上范围重叠。` }
            const childPart = `bank-${part}` as const
            const childPrefix = `avoid:${childId}:${childPart}`
            const a = joint(`${childPrefix}:start`, cut.start),
              b = joint(`${childPrefix}:end`, cut.end)
            addRetained(`${id}:before:${childId}`, a, cut.startT)
            const child = declarations.get(childId)!
            const childSegment: ResolvedSegment = {
              id: childPrefix,
              kind: 'arc',
              startId: a,
              endId: b,
              through: cut.through,
              resolvedArc: cut.arc,
              style: { ...partStyle, ...child.partStyles?.[childPart] },
              origin: origins.get(childPrefix)!,
            }
            parts.push(childSegment)
            partChains.set(childPrefix, [childSegment])
            addLabel(childPrefix, child.partLabels?.[childPart], [childSegment])
            cursorId = b
            cursorT = cut.endT
          }
          addRetained(`${id}:after:${cuts.at(-1)!.childId}`, endId, 1)
        }
      }
      partChains.set(id, parts)
      addLabel(
        id,
        declaration.partLabels?.[part],
        parts.filter((segment) => {
          const origin = segment.origin
          return (
            origin.kind === 'avoidance' && origin.avoidanceId === parent.id && origin.part === part
          )
        }),
      )
      replacement.push(...parts)
    }
    replacements.set(parent.id, replacement)
  }

  const registerPiece = (sourceId: string, id: string, piece: SourcePieceBoundary) => {
    const origin: SegmentOrigin = { ...origins.get(sourceId)!, kind: 'gap', piece }
    origins.set(id, origin)
    origins.set(sourcePieceId(sourceId, piece), origin)
    return origin
  }
  // Register dormant and zero-length pieces too, so selection and settings survive hiding.
  for (const [sourceId, values] of groups) {
    const sorted = [...values].sort((a, b) => a.trim.startT - b.trim.startT)
    for (const [index, { parent }] of sorted.entries())
      registerPiece(sourceId, `gap:${sourceId}:before:${parent.id}`, {
        startAvoidanceId: index ? sorted[index - 1].parent.id : null,
        endAvoidanceId: parent.id,
      })
    registerPiece(sourceId, `gap:${sourceId}:after:${sorted.at(-1)!.parent.id}`, {
      startAvoidanceId: sorted.at(-1)!.parent.id,
      endAvoidanceId: null,
    })
  }

  const expand = (source: (typeof sources)[number]): ResolvedSegment[] => {
    const group = (groups.get(source.id) ?? [])
      .filter((v) => enabled.has(v.parent.id))
      .sort((a, b) => a.trim.startT - b.trim.startT)
    if (!group.length) {
      const result = [{ ...source, origin: origins.get(source.id)! }]
      chains.set(source.id, result)
      addLabel(source.id, source.label, result)
      return result
    }
    const chain: ResolvedSegment[] = []
    const edge = sourceEdge(document, source)
    const style = { ...document.appearance.stroke, ...source.style }
    let cursor = source.startId,
      cursorT = 0
    let previousAvoidanceId: string | null = null
    let inheritedLabelUsed = false
    const gap = (id: string, toId: string, toT: number, nextAvoidanceId: string | null) => {
      const boundary = { startAvoidanceId: previousAvoidanceId, endAvoidanceId: nextAvoidanceId }
      const origin = registerPiece(source.id, id, boundary)
      if (toT <= cursorT || cursor === toId) return
      const own = pieceAppearance(source, boundary)
      const common = {
        id,
        startId: cursor,
        endId: toId,
        origin,
        style: { ...style, ...own?.style },
      }
      const s: ResolvedSegment =
        edge.kind === 'arc'
          ? { ...common, kind: 'arc', through: edgePointAt(edge, (cursorT + toT) / 2) }
          : { ...common, kind: 'line' }
      chain.push(s)
      const editableId = sourcePieceId(source.id, boundary)
      chains.set(editableId, [s])
      addLabel(editableId, own?.label ?? (!inheritedLabelUsed ? source.label : undefined), [s])
      inheritedLabelUsed = true
    }
    for (const { parent, trim } of group) {
      if (trim.startT < cursorT)
        throw new Error(`源路径 ${source.id} 上绕行 ${parent.id} 的范围重叠。`)
      const node = nodes.get(parent.id)!
      const isFirst = trim === parent.trims[0],
        isLast = trim === parent.trims.at(-1)
      const from = isFirst
        ? node.entryBase
        : trim.startT === 0
          ? source.startId
          : joint(`avoid:${parent.id}:trim:${source.id}:start`, edgePointAt(edge, trim.startT))
      gap(`gap:${source.id}:before:${parent.id}`, from, trim.startT, parent.id)
      if (isFirst) chain.push(...replacements.get(parent.id)!)
      cursor = isLast
        ? node.exitBase
        : trim.endT === 1
          ? source.endId
          : joint(`avoid:${parent.id}:trim:${source.id}:end`, edgePointAt(edge, trim.endT))
      cursorT = trim.endT
      previousAvoidanceId = parent.id
    }
    gap(`gap:${source.id}:after:${group.at(-1)!.parent.id}`, source.endId, 1, null)
    chains.set(source.id, chain)
    return chain
  }
  const contourSegments = activeSegments(document).flatMap(expand)
  const connectionSegments = document.connections.flatMap(expand)
  return {
    ok: true,
    scene: {
      points,
      contourSegments,
      connectionSegments,
      chains,
      partChains,
      labels,
      origins,
    },
  }
}
