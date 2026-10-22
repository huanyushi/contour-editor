import { arcThrough } from '../../../lib/arc'
import { nearestPathPoint } from '../../../lib/pathSnap'
import { anchorForConnectedDirection } from '../../../lib/connectedAvoidanceControls'
import type { GeometryResult } from '../../../lib/connectedAvoidanceGeometry'
import { sourceEdge } from './avoidanceConstruction'
import type { CorridorAvoidance } from './avoidanceTypes'
import type { SceneDocument } from '../scene/resolvedScene'
import { canonicalSourceAnchor, sourceChainForSegment } from '../sourcePathChain'
import { edgePointAt } from '../../../lib/connectedAvoidanceGeometry'
import type { ComplexPoint } from '../../../lib/geometry'
import { activeSegments } from '../pathTopology'
import { buildApproachingAvoidance } from '../../../lib/approachingAvoidance'
import type { SourceAnchor, SourceChain } from '../../../lib/connectedAvoidanceGeometry'

function acceptAnchor(
  document: SceneDocument,
  value: CorridorAvoidance,
  source: SourceChain,
  anchor: SourceAnchor,
): GeometryResult<CorridorAvoidance> {
  const next = { ...value, anchor }
  const visible = new Set([...activeSegments(document), ...document.connections].map((s) => s.id))
  if (visible.has(value.anchor.segmentId)) {
    const center = [...document.vertices, ...document.markers].find((p) => p.id === value.markerId)!
    const geometry = buildApproachingAvoidance({
      source,
      anchor,
      center,
      radius: value.radius,
      gap: value.gap,
      direction: corridorDirection(document, next),
    })
    if (!geometry.ok) return geometry
    if (geometry.value.trims.some((t) => !visible.has(t.sourceSegmentId)))
      return { ok: false, error: '该接入位置需要暂存的关闭边，请先恢复闭合或选择可见方向。' }
  }
  return { ok: true, value: next }
}

export function corridorDirection(document: SceneDocument, value: CorridorAvoidance): ComplexPoint {
  if (value.alignment?.kind === 'direction') {
    const radians = (value.alignment.angle * Math.PI) / 180
    return { re: Math.cos(radians), im: Math.sin(radians) }
  }
  const source = [...document.segments, ...document.connections].find(
    (s) => s.id === value.anchor.segmentId,
  )!
  const edge = sourceEdge(document, source)
  const t =
    value.anchor.kind === 'segment'
      ? value.anchor.t
      : value.anchor.vertexId === source.startId
        ? 0
        : 1
  const point = edgePointAt(edge, t)
  const center = [...document.vertices, ...document.markers].find((p) => p.id === value.markerId)!
  const distance = Math.hypot(point.re - center.re, point.im - center.im)
  if (distance > 1e-10 * value.radius)
    return { re: (point.re - center.re) / distance, im: (point.im - center.im) / distance }
  if (edge.kind === 'arc') {
    const fit = arcThrough(edge.start, edge.end, edge.through)
    if (fit.ok)
      return normalSide(
        {
          re: (point.re - fit.arc.center.re) / fit.arc.radius,
          im: (point.im - fit.arc.center.im) / fit.arc.radius,
        },
        value,
      )
  }
  const length = Math.hypot(edge.end.re - edge.start.re, edge.end.im - edge.start.im)
  return normalSide(
    { re: (edge.end.im - edge.start.im) / length, im: -(edge.end.re - edge.start.re) / length },
    value,
  )
}

function normalSide(normal: ComplexPoint, value: CorridorAvoidance): ComplexPoint {
  const angle = value.alignment?.angle
  if (angle === undefined) return normal
  const radians = (angle * Math.PI) / 180
  const sign = normal.re * Math.cos(radians) + normal.im * Math.sin(radians) < 0 ? -1 : 1
  return { re: sign * normal.re, im: sign * normal.im }
}

/** Source-only projection; never infer an attachment from generated detour geometry. */
export function followAvoidance(
  document: SceneDocument,
  value: CorridorAvoidance,
): GeometryResult<CorridorAvoidance> {
  if (!value.alignment) return { ok: true, value }
  const center = [...document.vertices, ...document.markers].find((p) => p.id === value.markerId)
  if (!center) return { ok: false, error: '绕行奇点不存在。' }
  const chain = sourceChainForSegment(document, value.anchor.segmentId)
  if (!chain.ok) return chain
  if (value.alignment.kind === 'direction') {
    const radians = (value.alignment.angle * Math.PI) / 180
    const anchor = anchorForConnectedDirection({
      source: chain.value,
      center,
      radius: value.radius,
      gap: value.gap,
      approaching: true,
      direction: { re: Math.cos(radians), im: Math.sin(radians) },
    })
    return anchor.ok ? acceptAnchor(document, value, chain.value, anchor.value) : anchor
  }
  const source = [...document.segments, ...document.connections].find(
    (s) => s.id === value.anchor.segmentId,
  )
  if (!source) return { ok: false, error: '接入源路径不存在。' }
  const edge = sourceEdge(document, source)
  const circle = edge.kind === 'arc' ? arcThrough(edge.start, edge.end, edge.through) : null
  if (
    circle?.ok &&
    Math.hypot(center.re - circle.arc.center.re, center.im - circle.arc.center.im) <=
      1e-10 * circle.arc.radius
  )
    return {
      ok: true,
      value:
        value.alignment.angle === undefined ? value : { ...value, alignment: { kind: 'normal' } },
    }
  const eligible = chain.value.edges.filter((item) => {
    if (item.id === source.id) return true
    if (!circle?.ok || item.edge.kind !== 'arc') return false
    const other = arcThrough(item.edge.start, item.edge.end, item.edge.through)
    return (
      other.ok &&
      Math.hypot(
        other.arc.center.re - circle.arc.center.re,
        other.arc.center.im - circle.arc.center.im,
      ) <=
        1e-9 * circle.arc.radius &&
      Math.abs(other.arc.radius - circle.arc.radius) <= 1e-9 * circle.arc.radius
    )
  })
  const hits = eligible
    .flatMap((item) => {
      const hit = nearestPathPoint(item.edge, center, { a: 1, b: 0, c: 0, d: 1 })
      if (!hit) return []
      let tangent = {
        re: item.edge.end.re - item.edge.start.re,
        im: item.edge.end.im - item.edge.start.im,
      }
      if (item.edge.kind === 'arc') {
        const fit = arcThrough(item.edge.start, item.edge.end, item.edge.through)
        if (!fit.ok) return []
        tangent = { re: -(hit.point.im - fit.arc.center.im), im: hit.point.re - fit.arc.center.re }
      }
      const length = Math.hypot(tangent.re, tangent.im)
      const tangentialOffset = Math.abs(
        (center.re - hit.point.re) * (tangent.re / length) +
          (center.im - hit.point.im) * (tangent.im / length),
      )
      const roundoff =
        16 *
        Number.EPSILON *
        Math.max(
          1,
          Math.abs(center.re),
          Math.abs(center.im),
          Math.abs(hit.point.re),
          Math.abs(hit.point.im),
        )
      if (tangentialOffset > 1e-9 * Math.max(value.radius, hit.distance) + roundoff) return []
      return [{ ...hit, id: item.id }]
    })
    .sort((a, b) => a.distance - b.distance)
  if (!hits.length) return { ok: false, error: '无法确定有限源路径上的法向接入位置。' }
  const hit = hits[0]
  const anchor = canonicalSourceAnchor(chain.value, hit.id, hit.t)
  return anchor.ok
    ? acceptAnchor(
        document,
        {
          ...value,
          alignment: hit.distance <= 1e-10 * value.radius ? value.alignment : { kind: 'normal' },
        },
        chain.value,
        anchor.value,
      )
    : anchor
}
