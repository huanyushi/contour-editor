import { arcThrough } from '../../lib/arc'
import { type GeometryResult } from '../../lib/connectedAvoidanceGeometry'
import { nearestPathPoint, type PathScreenMetric } from '../../lib/pathSnap'
import type { ComplexPoint } from '../../lib/geometry'
import { constructAvoidance, sourceEdge } from './avoidanceConstruction'
import { constructAvoidances } from './avoidanceConstructionTable'
import type { Avoidance, LegacyAvoidance } from './avoidanceTypes'
import type { ContourState } from './model'
import {
  findPoint,
  findResolvedSegment,
  findSegment,
  scenePoints,
  sceneSegments,
  segmentOrigin,
  visibleSceneSegments,
} from './sceneObjects'
import { canonicalSourceAnchor, sourceChainForSegment } from './sourcePathChain'
import { defaultAvoidanceRadius } from './avoidanceDefaults'

export function legacyTargetForPoint(
  state: ContourState,
  markerId: string,
  sourceId: string,
): { targetSegmentId: string; exitSegmentId?: string } | { error: string } | null {
  const target = findSegment(state, sourceId)
  const visible = new Set(visibleSceneSegments(state).map((s) => s.id))
  if (!target || !visible.has(sourceId)) return null
  if (target.startId === markerId || target.endId === markerId) {
    if (!state.vertices.some((p) => p.id === markerId)) return null
    const incoming = state.segments.filter((s) => s.endId === markerId),
      outgoing = state.segments.filter((s) => s.startId === markerId)
    if (
      incoming.length !== 1 ||
      outgoing.length !== 1 ||
      ![incoming[0], outgoing[0]].some((s) => s.id === sourceId) ||
      !visible.has(incoming[0].id) ||
      !visible.has(outgoing[0].id)
    )
      return {
        error: `顶点 ${markerId} 的角点绕行需要一条可见进入路径和一条可见离开路径；开放端点不能创建角点绕行。`,
      }
    return { targetSegmentId: incoming[0].id, exitSegmentId: outgoing[0].id }
  }
  if (target.kind === 'arc') return { targetSegmentId: sourceId }
  const start = findPoint(state, target.startId),
    end = findPoint(state, target.endId),
    marker = findPoint(state, markerId)
  if (!start || !end || !marker) return null
  const dx = end.re - start.re,
    dy = end.im - start.im,
    length = Math.hypot(dx, dy)
  const projection = (marker.re - start.re) * (dx / length) + (marker.im - start.im) * (dy / length)
  return Number.isFinite(length) && length > 0 && projection > 0 && projection < length
    ? { targetSegmentId: sourceId }
    : null
}

function fitInitialRadius(state: ContourState, value: Avoidance): Avoidance {
  for (let attempt = 0; attempt < 16; attempt++) {
    const radius = value.radius / 2 ** attempt
    let candidate = { ...value, radius }
    if (candidate.kind === 'corridor') candidate = { ...candidate, gap: radius * 0.6 }
    if (candidate.kind === undefined || candidate.kind === 'local') {
      const construction = constructAvoidance(state, candidate)
      if (construction.ok) candidate = { ...candidate, side: construction.value.defaultSide }
    }
    if (constructAvoidances({ ...state, avoidances: [...state.avoidances, candidate] }).ok)
      return candidate
  }
  // Keep a repairable, honest preview instead of silently accepting invalid geometry.
  return value
}

export function makeAvoidanceTarget(
  state: ContourState,
  markerId: string,
  input: {
    renderedId: string
    point?: ComplexPoint
    metric?: PathScreenMetric
  },
): GeometryResult<Avoidance> {
  const invalid = (error: string): GeometryResult<Avoidance> => ({ ok: false, error })
  const marker = findPoint(state, markerId)
  if (!marker || !['pole', 'isolated', 'branch'].includes(marker.mathematicalKind ?? 'ordinary'))
    return invalid('请选择真实奇点。')
  const occupied = new Set(
    [...scenePoints(state), ...sceneSegments(state), ...state.formulas, ...state.avoidances].map(
      (a) => a.id,
    ),
  )
  let index = 0
  while (occupied.has(`avoidance-${index}`)) index++
  const id = `avoidance-${index}`
  const origin = segmentOrigin(state, input.renderedId)
  const sourceId = origin?.sourceSegmentId ?? input.renderedId
  if (input.renderedId !== sourceId && !findResolvedSegment(state, input.renderedId))
    return invalid('该路径当前不可见或不存在。')
  if (origin?.kind === 'avoidance') {
    if (origin.part !== 'entry' && origin.part !== 'exit')
      return invalid('请选择源路径或可见的平行连接段；绕行圆弧不是新目标。')
    const table = constructAvoidances(state)
    if (!table.ok) return table
    const banks = table.value.parents.get(origin.avoidanceId)?.bankPair
    if (!banks) return invalid('当前绕行没有两条有效的平行连接段。')
    const radius = Math.max(
      banks.gap,
      Math.min(
        Math.hypot(
          banks.entry.end.re - banks.entry.start.re,
          banks.entry.end.im - banks.entry.start.im,
        ),
        Math.hypot(
          banks.exit.end.re - banks.exit.start.re,
          banks.exit.end.im - banks.exit.start.im,
        ),
      ) / 20,
    )
    return {
      ok: true,
      value: {
        kind: 'bank-clearance',
        id,
        markerId,
        parentAvoidanceId: origin.avoidanceId,
        radius,
      },
    }
  }
  const target = findSegment(state, sourceId)
  if (!target || !visibleSceneSegments(state).some((s) => s.id === sourceId))
    return invalid('请选择可见的源路径。')
  const edge = sourceEdge(state, target)
  const closest = nearestPathPoint(edge, marker, { a: 1, b: 0, c: 0, d: 1 })
  if (!closest) return invalid('无法可靠确定奇点与源路径的关系。')
  const roundoff =
    16 *
    Number.EPSILON *
    Math.max(
      1,
      Math.abs(marker.re),
      Math.abs(marker.im),
      Math.abs(edge.start.re),
      Math.abs(edge.start.im),
      Math.abs(edge.end.re),
      Math.abs(edge.end.im),
    )
  const onSource =
    closest.distance <= roundoff || target.startId === markerId || target.endId === markerId
  const preferredRadius = defaultAvoidanceRadius(state)
  if (!onSource) {
    const chain = sourceChainForSegment(state, sourceId)
    if (!chain.ok) return chain
    const circle = edge.kind === 'arc' ? arcThrough(edge.start, edge.end, edge.through) : null
    const concentric =
      circle?.ok &&
      Math.hypot(circle.arc.center.re - marker.re, circle.arc.center.im - marker.im) <= roundoff
    const hit =
      concentric && input.point
        ? nearestPathPoint(edge, input.point, input.metric ?? { a: 1, b: 0, c: 0, d: 1 })
        : closest
    if (!hit) return invalid('无法可靠投影到源路径。')
    const anchor = canonicalSourceAnchor(chain.value, sourceId, hit.t)
    if (!anchor.ok) return anchor
    const radius = preferredRadius
    return {
      ok: true,
      value: fitInitialRadius(state, {
        kind: 'corridor',
        id,
        markerId,
        anchor: anchor.value,
        radius,
        gap: radius * 0.6,
        alignment: { kind: 'normal' },
      }),
    }
  }
  const targetIds = legacyTargetForPoint(state, markerId, sourceId)
  if (!targetIds) return invalid('请选择奇点可绕行的有限源路径。')
  if ('error' in targetIds) return invalid(targetIds.error)
  const avoidance: LegacyAvoidance = {
    id,
    markerId,
    ...targetIds,
    radius: preferredRadius,
    side: 'left',
    openingRatio: 0.5,
  }
  const construction = constructAvoidance(state, avoidance)
  if (construction.ok) avoidance.side = construction.value.defaultSide
  return { ok: true, value: fitInitialRadius(state, avoidance) }
}
