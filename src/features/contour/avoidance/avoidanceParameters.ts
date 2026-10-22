import {
  anchorForConnectedDirection,
  anchorForConnectedPort,
} from '../../../lib/connectedAvoidanceControls'
import {
  buildConnectedAvoidance,
  edgeParameter,
  edgePointAt,
  type GeometryResult,
} from '../../../lib/connectedAvoidanceGeometry'
import { constructAvoidance, sourceEdge } from './avoidanceConstruction'
import { isLegacyAvoidance, type Avoidance, type CorridorAvoidance } from './avoidanceTypes'
import type { AvoidancePatch } from './avoidanceModel'
import type { SceneDocument } from '../scene/resolvedScene'
import { canonicalSourceAnchor, sourceChainForSegment } from '../sourcePathChain'
import { activeSegments } from '../pathTopology'
import { nearestPath, type PathScreenMetric } from '../../../lib/pathSnap'
import type { ComplexPoint } from '../../../lib/geometry'
import { corridorDirection, followAvoidance } from './avoidanceFollowing'
import { buildApproachingAvoidance } from '../../../lib/approachingAvoidance'
import { constructAvoidances } from './avoidanceConstructionTable'
import { validateAvoidances } from './avoidanceValidation'

/** A lossless editing adapter, not an eager file migration. Direct detours and
 * degenerate legacy connectors keep their original construction constraints. */
export function editableAvoidance(document: SceneDocument, value: Avoidance): Avoidance {
  if (!isLegacyAvoidance(value) || value.exitSegmentId) return value
  const result = constructAvoidance(document, value)
  if (!result.ok || result.value.mode !== 'line' || result.value.geometry.onLine) return value
  const g = result.value.geometry
  if (
    Math.hypot(g.entry.re - g.entryBase.re, g.entry.im - g.entryBase.im) <= 1e-9 * value.radius ||
    Math.hypot(g.exit.re - g.exitBase.re, g.exit.im - g.exitBase.im) <= 1e-9 * value.radius
  )
    return value
  const chain = sourceChainForSegment(document, value.targetSegmentId)
  if (!chain.ok) return value
  const edge = chain.value.edges.find((s) => s.id === value.targetSegmentId)!
  const midpoint = {
    re: g.entryBase.re / 2 + g.exitBase.re / 2,
    im: g.entryBase.im / 2 + g.exitBase.im / 2,
  }
  const anchor = canonicalSourceAnchor(chain.value, edge.id, edgeParameter(edge.edge, midpoint))
  if (!anchor.ok) return value
  const converted = buildConnectedAvoidance({
    source: chain.value,
    center: g.arc.center,
    radius: value.radius,
    gap: g.actualOpeningWidth,
    anchor: anchor.value,
  })
  if (!converted.ok) return value
  // A valid old declaration is not necessarily expressible by the strict corridor
  // constraints (notably a full-diameter opening). Never migrate by shape inference alone.
  const points = ['entryBase', 'entry', 'exit', 'exitBase', 'through'] as const
  if (
    points.some(
      (key) =>
        Math.hypot(
          converted.value.geometry[key].re - g[key].re,
          converted.value.geometry[key].im - g[key].im,
        ) >
        1e-9 * value.radius,
    )
  )
    return value
  return {
    kind: 'corridor',
    id: value.id,
    markerId: value.markerId,
    radius: value.radius,
    gap: g.actualOpeningWidth,
    anchor: anchor.value,
    ...(value.partStyles ? { partStyles: value.partStyles } : {}),
    ...(value.partLabels ? { partLabels: value.partLabels } : {}),
  }
}

export function avoidanceAngle(document: SceneDocument, value: CorridorAvoidance): number {
  if (value.alignment) {
    const direction = corridorDirection(document, value)
    return ((((Math.atan2(direction.im, direction.re) * 180) / Math.PI) % 360) + 360) % 360
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
  const anchor = edgePointAt(edge, t)
  const center = [...document.vertices, ...document.markers].find((p) => p.id === value.markerId)!
  const angle =
    ((Math.atan2(anchor.im - center.im, anchor.re - center.re) * 180) / Math.PI + 360) % 360
  return Math.abs(angle - 360) < 1e-10 || Math.abs(angle) < 1e-10 ? 0 : angle
}

export function avoidanceDirectionPatch(
  document: SceneDocument,
  value: Avoidance,
  degrees: number,
): GeometryResult<AvoidancePatch> {
  const editable = editableAvoidance(document, value)
  if (editable.kind !== 'corridor' || !Number.isFinite(degrees))
    return { ok: false, error: '请输入有限角度；路径上的直接绕行由源路径交点确定朝向。' }
  const segments = activeSegments(document)
  const source = sourceChainForSegment({ ...document, segments }, editable.anchor.segmentId)
  if (!source.ok) return source
  const center = [...document.vertices, ...document.markers].find(
    (p) => p.id === editable.markerId,
  )!
  const radians = ((degrees % 360) * Math.PI) / 180
  const result = anchorForConnectedDirection({
    source: source.value,
    center,
    radius: editable.radius,
    gap: editable.gap,
    approaching: true,
    direction: { re: Math.cos(radians), im: Math.sin(radians) },
  })
  if (!result.ok) return result
  return visibleAnchorPatch(document, {
    ...editable,
    anchor: result.value,
    alignment: { kind: 'direction', angle: ((degrees % 360) + 360) % 360 },
  })
}

export function avoidancePortPatch(
  document: SceneDocument,
  value: Avoidance,
  point: ComplexPoint,
  outward: -1 | 1,
  metric: PathScreenMetric,
  snap = false,
): GeometryResult<AvoidancePatch> {
  if (snap) {
    const raw = avoidancePortPatch(document, value, point, outward, metric)
    const editable = editableAvoidance(document, value)
    if (editable.kind !== 'corridor') return raw
    const normal = followAvoidance(document, { ...editable, alignment: { kind: 'normal' } })
    const angles = [0, 90, 180, 270]
    if (normal.ok) angles.unshift(avoidanceAngle(document, normal.value))
    let best: { patch: AvoidancePatch; distance: number } | undefined
    for (const angle of angles) {
      const patch = avoidanceDirectionPatch(document, editable, angle)
      if (!patch.ok) continue
      const next = {
        ...document,
        avoidances: document.avoidances.map((a) =>
          a.id === value.id ? patchAvoidanceForPort(editable, patch.value) : a,
        ),
      }
      const table = constructAvoidances(next)
      if (!table.ok) continue
      const banks = table.value.parents.get(value.id)?.bankPair
      if (!banks) continue
      const bank = banks.entry.outward === outward ? banks.entry : banks.exit
      const contact = banks.entry.outward === outward ? bank.start : bank.end
      const dx = contact.re - point.re,
        dy = contact.im - point.im
      const distance = Math.hypot(metric.a * dx + metric.c * dy, metric.b * dx + metric.d * dy)
      if (distance > 8 || (best && distance >= best.distance) || !validateAvoidances(next).ok)
        continue
      best = { patch: patch.value, distance }
    }
    return best ? { ok: true, value: best.patch } : raw
  }
  const editable = editableAvoidance(document, value)
  if (editable.kind !== 'corridor') return { ok: false, error: '当前绕行没有可移动的平行接入口。' }
  const source = sourceChainForSegment(
    { ...document, segments: activeSegments(document) },
    editable.anchor.segmentId,
  )
  if (!source.ok) return source
  const hit = nearestPath(
    source.value.edges.map((s) => s.edge),
    point,
    metric,
  )
  if (!hit) return { ok: false, error: '无法投影到所选可见源路径。' }
  const center = [...document.vertices, ...document.markers].find(
    (p) => p.id === editable.markerId,
  )!
  const result = anchorForConnectedPort({
    source: source.value,
    center,
    radius: editable.radius,
    gap: editable.gap,
    point: hit.point,
    outward,
  })
  if (!result.ok) return result
  const angle = avoidanceAngle(document, {
    ...editable,
    anchor: result.value,
    alignment: undefined,
  })
  return visibleAnchorPatch(document, {
    ...editable,
    anchor: result.value,
    alignment: { kind: 'direction', angle },
  })
}

function visibleAnchorPatch(
  document: SceneDocument,
  editable: CorridorAvoidance,
): GeometryResult<AvoidancePatch> {
  const visible = new Set([...activeSegments(document), ...document.connections].map((s) => s.id))
  const center = [...document.vertices, ...document.markers].find(
    (p) => p.id === editable.markerId,
  )!
  // Acceptance reconstructs against the stored source chain. Check that this
  // reconstruction, not just the visible-chain solve, needs no hidden closing edge.
  const storedSource = sourceChainForSegment(document, editable.anchor.segmentId)
  if (!storedSource.ok) return storedSource
  const input = {
    source: storedSource.value,
    center,
    radius: editable.radius,
    gap: editable.gap,
    anchor: editable.anchor,
  }
  const construction = editable.alignment
    ? buildApproachingAvoidance({
        ...input,
        direction: corridorDirection(document, editable),
      })
    : buildConnectedAvoidance(input)
  if (!construction.ok) return construction
  if (construction.value.trims.some((trim) => !visible.has(trim.sourceSegmentId)))
    return { ok: false, error: '该朝向需要暂存的关闭边，请恢复闭合或选择可见路径方向。' }
  return { ok: true, value: { anchor: editable.anchor, alignment: editable.alignment } }
}

function patchAvoidanceForPort(value: CorridorAvoidance, patch: AvoidancePatch): CorridorAvoidance {
  return {
    ...value,
    anchor: patch.anchor ?? value.anchor,
    ...(patch.alignment ? { alignment: patch.alignment } : {}),
  }
}

export function avoidanceNormalPatch(
  document: SceneDocument,
  value: CorridorAvoidance,
): GeometryResult<AvoidancePatch> {
  const direction = corridorDirection(document, value)
  const result = followAvoidance(document, {
    ...value,
    alignment: { kind: 'normal', angle: (Math.atan2(direction.im, direction.re) * 180) / Math.PI },
  })
  if (!result.ok) return result
  return visibleAnchorPatch(document, result.value)
}
