import { pointOnArc } from '../../lib/arc'
import { buildAvoidance, type AvoidanceGeometry } from '../../lib/avoidanceGeometry'
import { edgeArcFrame } from '../../lib/edgeArcFrame'
import type { GeometricEdge } from '../../lib/geometryIntersections'
import { buildArcAvoidance, buildCornerAvoidance } from '../../lib/pathAvoidanceGeometry'
import type { Avoidance, AvoidanceSide } from './avoidanceTypes'
import type { PathSegment } from './model'
import type { SceneDocument } from './resolvedScene'

export interface AvoidanceInterval {
  sourceSegmentId: string
  startT: number
  endT: number
}
export interface AvoidanceConstruction {
  mode: 'line' | 'arc' | 'corner'
  geometry: AvoidanceGeometry
  /** Actual removed source intervals, in directed normalized source parameters. */
  trims: readonly AvoidanceInterval[]
  /** Conflict intervals; legacy lines deliberately reserve their full radius. */
  occupancy: readonly AvoidanceInterval[]
  defaultSide: AvoidanceSide
}
export type AvoidanceConstructionResult =
  { ok: true; value: AvoidanceConstruction } | { ok: false; error: string }

export function sourceEdge(document: SceneDocument, source: PathSegment): GeometricEdge {
  const points = [...document.vertices, ...document.markers]
  const start = points.find((p) => p.id === source.startId)
  const end = points.find((p) => p.id === source.endId)
  if (!start || !end) throw new Error(`源路径 ${source.id} 的端点引用无效。`)
  return source.kind === 'arc'
    ? { kind: 'arc', start, end, through: source.through }
    : { kind: 'line', start, end }
}

/** Evaluate retained true source geometry, never an endpoint chord. */
export function sourcePointAt(edge: GeometricEdge, t: number) {
  if (t === 0) return edge.start
  if (t === 1) return edge.end
  if (edge.kind === 'line')
    return {
      re: edge.start.re + (edge.end.re - edge.start.re) * t,
      im: edge.start.im + (edge.end.im - edge.start.im) * t,
    }
  const { origin, scale, arc } = edgeArcFrame(edge)
  const p = pointOnArc(arc, origin === edge.start ? t : 1 - t)
  return { re: origin.re + p.re * scale, im: origin.im + p.im * scale }
}

/** Single construction boundary shared by scene expansion, conflicts and UI preview. */
export function constructAvoidance(
  document: SceneDocument,
  avoidance: Avoidance,
): AvoidanceConstructionResult {
  const context = `绕行 ${avoidance.id}（源路径 ${avoidance.targetSegmentId}${avoidance.exitSegmentId === undefined ? '' : `、${avoidance.exitSegmentId}`}）`
  const invalid = (error: string): AvoidanceConstructionResult => ({
    ok: false,
    error: `${context}：${error}`,
  })
  try {
    const point = [...document.vertices, ...document.markers].find(
      (p) => p.id === avoidance.markerId,
    )
    if (!point || !['pole', 'isolated', 'branch'].includes(point.mathematicalKind ?? 'ordinary'))
      return invalid(`需要非普通数学点：${avoidance.markerId}`)
    const center = { re: point.re, im: point.im }
    if (
      !Number.isFinite(avoidance.openingRatio) ||
      avoidance.openingRatio <= 0 ||
      avoidance.openingRatio > 1
    )
      return invalid('偏好开口比例必须大于 0 且不超过 1。')
    const source = [...document.segments, ...document.connections].find(
      (s) => s.id === avoidance.targetSegmentId,
    )
    if (!source) return invalid('目标必须是现有源路径。')
    const edge = sourceEdge(document, source)
    const interval = (
      sourceSegmentId: string,
      startT: number,
      endT: number,
    ): AvoidanceInterval => ({ sourceSegmentId, startT, endT })
    if (avoidance.exitSegmentId !== undefined) {
      const incoming = document.segments.filter((s) => s.endId === point.id)
      const outgoing = document.segments.filter((s) => s.startId === point.id)
      const exit = outgoing[0]
      if (
        !document.vertices.some((p) => p.id === point.id) ||
        incoming.length !== 1 ||
        outgoing.length !== 1 ||
        incoming[0].id !== source.id ||
        exit.id !== avoidance.exitSegmentId ||
        source.id === exit.id
      )
        return invalid('角点需要同一围道内共享顶点的一条进入源段和一条离开源段。')
      const result = buildCornerAvoidance({
        incoming: edge,
        outgoing: sourceEdge(document, exit),
        center,
        radius: avoidance.radius,
        side: avoidance.side,
      })
      if (!result.ok) return invalid(result.error)
      const { geometry, entryT, exitT, defaultSide } = result.value
      const trims = [interval(source.id, entryT, 1), interval(exit.id, 0, exitT)]
      return { ok: true, value: { mode: 'corner', geometry, trims, occupancy: trims, defaultSide } }
    }
    if (source.startId === point.id || source.endId === point.id)
      return invalid('奇点不能是单源目标路径端点；角点需要进入和离开两个源段。')
    if (edge.kind === 'arc') {
      const result = buildArcAvoidance({
        source: edge,
        center,
        radius: avoidance.radius,
        side: avoidance.side,
      })
      if (!result.ok) return invalid(result.error)
      const { geometry, entryT, exitT, defaultSide } = result.value
      const trims = [interval(source.id, entryT, exitT)]
      return { ok: true, value: { mode: 'arc', geometry, trims, occupancy: trims, defaultSide } }
    }
    const result = buildAvoidance({
      start: edge.start,
      end: edge.end,
      center,
      radius: avoidance.radius,
      side: avoidance.side,
      openingRatio: avoidance.openingRatio,
    })
    if (!result.ok) return invalid(result.error)
    const g = result.geometry
    const length = Math.hypot(edge.end.re - edge.start.re, edge.end.im - edge.start.im)
    const parameter = (p: typeof edge.start) =>
      ((p.re - edge.start.re) / length) * ((edge.end.re - edge.start.re) / length) +
      ((p.im - edge.start.im) / length) * ((edge.end.im - edge.start.im) / length)
    return {
      ok: true,
      value: {
        mode: 'line',
        geometry: g,
        trims: [interval(source.id, parameter(g.entryBase), parameter(g.exitBase))],
        occupancy: [interval(source.id, g.footprint[0] / length, g.footprint[1] / length)],
        defaultSide: g.onLine ? avoidance.side : g.signedDistance > 0 ? 'left' : 'right',
      },
    }
  } catch (error) {
    return invalid(
      `数值构造失败，无法可靠裁剪源路径。${error instanceof Error ? error.message : ''}`,
    )
  }
}
