import { edgeArcFrame } from './edgeArcFrame'
import type { ComplexPoint } from './geometry'
import { buildApproachingAvoidance } from './approachingAvoidance'
import {
  buildConnectedAvoidance,
  edgeParameter,
  edgePointAt,
  type GeometryResult,
  type SourceAnchor,
  type SourceChain,
} from './connectedAvoidanceGeometry'

/** Invert one real bank/source contact, keeping radius and total spacing fixed. */
export function anchorForConnectedPort(input: {
  source: SourceChain
  center: ComplexPoint
  radius: number
  gap: number
  point: ComplexPoint
  outward: -1 | 1
}): GeometryResult<SourceAnchor> {
  const { center, point, gap, radius, outward } = input
  const dx = point.re - center.re,
    dy = point.im - center.im
  const distance = Math.hypot(dx, dy)
  if (!Number.isFinite(distance) || distance <= radius || !(gap > 0 && gap < 2 * radius))
    return { ok: false, error: '该接入位置无法保持当前半径和两岸间距。' }
  const sine = outward * (gap / distance / 2)
  const cosine = Math.sqrt((1 - sine) * (1 + sine))
  const direction = {
    re: (dx / distance) * cosine + (dy / distance) * sine,
    im: (dy / distance) * cosine - (dx / distance) * sine,
  }
  const anchor = anchorForConnectedDirection({ ...input, direction })
  if (!anchor.ok) return anchor
  const built = buildConnectedAvoidance({ ...input, anchor: anchor.value })
  if (!built.ok) return built
  const bank =
    built.value.banks.entry.outward === outward ? built.value.banks.entry : built.value.banks.exit
  const actual = built.value.banks.entry.outward === outward ? bank.start : bank.end
  const tolerance =
    1e-8 * radius +
    16 *
      Number.EPSILON *
      Math.max(Math.abs(point.re), Math.abs(point.im), Math.abs(center.re), Math.abs(center.im))
  return Math.hypot(actual.re - point.re, actual.im - point.im) <= tolerance
    ? anchor
    : { ok: false, error: '该接入位置无法在所选有限路径上保持平行连接。' }
}

/** Find an actual source anchor for a requested ray; no independent angle is persisted. */
export function anchorForConnectedDirection(input: {
  source: SourceChain
  center: ComplexPoint
  radius: number
  gap: number
  direction: ComplexPoint
  approaching?: boolean
}): GeometryResult<SourceAnchor> {
  const invalid = (): GeometryResult<SourceAnchor> => ({
    ok: false,
    error: '该朝向无法与所选有限路径形成有效绕行，请调整朝向、半径或间距。',
  })
  try {
    const { source, center, radius, gap, direction } = input
    const length = Math.hypot(direction.re, direction.im)
    if (!Number.isFinite(length) || length === 0 || !(radius > 0 && gap > 0 && gap < 2 * radius))
      return invalid()
    const d = { re: direction.re / length, im: direction.im / length }
    const local = (p: ComplexPoint): ComplexPoint => {
      const x = (p.re - center.re) / radius,
        y = (p.im - center.im) / radius
      return { re: x * d.re + y * d.im, im: -x * d.im + y * d.re }
    }
    const candidates: { anchor: SourceAnchor; x: number }[] = []
    for (const sourceEdge of source.edges) {
      const e = sourceEdge.edge
      const edge = {
        ...e,
        start: local(e.start),
        end: local(e.end),
        ...(e.kind === 'arc' ? { through: local(e.through) } : {}),
      }
      let contacts: ComplexPoint[] = []
      if (edge.kind === 'line') {
        const delta = edge.end.im - edge.start.im
        if (delta === 0) continue
        const t = -edge.start.im / delta
        if (t >= -1e-9 && t <= 1 + 1e-9) contacts = [edgePointAt(edge, Math.max(0, Math.min(1, t)))]
      } else {
        const { origin, scale, arc } = edgeArcFrame(edge)
        const cx = origin.re + scale * arc.center.re,
          cy = origin.im + scale * arc.center.im
        const r = scale * arc.radius
        if (Math.abs(cy) >= r) continue
        const span = Math.sqrt((r - Math.abs(cy)) * (r + Math.abs(cy)))
        contacts = [
          { re: cx - span, im: 0 },
          { re: cx + span, im: 0 },
        ]
      }
      for (const contact of contacts) {
        const t = edgeParameter(edge, contact)
        if (t < -1e-9 || t > 1 + 1e-9 || (input.approaching ? contact.re < -1e-9 : contact.re <= 1))
          continue
        const anchor: SourceAnchor =
          t <= 1e-9 || t >= 1 - 1e-9
            ? {
                kind: 'vertex',
                segmentId: sourceEdge.id,
                vertexId: t <= 1e-9 ? sourceEdge.startId : sourceEdge.endId,
              }
            : { kind: 'segment', segmentId: sourceEdge.id, t }
        candidates.push({ anchor, x: contact.re })
      }
    }
    candidates.sort((a, b) => a.x - b.x)
    for (const { anchor } of candidates) {
      const construction = input.approaching
        ? buildApproachingAvoidance({ source, center, radius, gap, anchor, direction: d })
        : buildConnectedAvoidance({ source, center, radius, gap, anchor })
      if (!construction.ok) continue
      return { ok: true, value: anchor }
    }
    return invalid()
  } catch {
    return invalid()
  }
}
