import { arcThrough, pointOnArc, tangentOnArc, type CircularArc } from '../../../lib/arc'
import { toSvg, type ComplexPoint, type SvgPoint } from '../../../lib/geometry'
import { nearestPathPoint, type PathScreenMetric } from '../../../lib/pathSnap'
import type { Viewport } from '../../../lib/viewport'
import type { StrokeStyle } from '../appearance'
import type { Vertex } from '../model'
import { sourcePieceId } from '../sourcePieces'
import type { ResolvedScene, ResolvedSegment } from './resolvedScene'

export interface ArrowBounds {
  left: number
  top: number
  right: number
  bottom: number
}
export interface PathArrowGeometry {
  point: SvgPoint
  tangent: SvgPoint
  path: string
  objectId: string
  position: number
  bounds: ArrowBounds
}

export function arrowObjectId(segment: ResolvedSegment): string {
  const origin = segment.origin
  return origin.kind === 'avoidance'
    ? `avoid:${origin.avoidanceId}:${origin.part}`
    : origin.kind === 'gap'
      ? sourcePieceId(origin.sourceSegmentId, origin.piece)
      : segment.id
}

export function arrowChain(scene: ResolvedScene, id: string): readonly ResolvedSegment[] {
  const all = [...scene.contourSegments, ...scene.connectionSegments]
  const fragment = all.find((s) => s.id === id)
  const key = fragment ? arrowObjectId(fragment) : id
  return all.filter((s) => arrowObjectId(s) === key)
}

function fittedArc(
  segment: ResolvedSegment,
  points: ReadonlyMap<string, Vertex>,
): CircularArc | undefined {
  if (segment.kind !== 'arc') return undefined
  if (segment.resolvedArc) return segment.resolvedArc
  const fit = arcThrough(points.get(segment.startId)!, points.get(segment.endId)!, segment.through)
  if (!fit.ok) throw new Error(fit.error)
  return fit.arc
}

function mathematicalLength(segment: ResolvedSegment, points: ReadonlyMap<string, Vertex>): number {
  const arc = fittedArc(segment, points)
  if (arc) return arc.radius * Math.abs(arc.sweep)
  const p = points.get(segment.startId)!,
    q = points.get(segment.endId)!
  return Math.hypot(q.re - p.re, q.im - p.im)
}

function weights(chain: readonly ResolvedSegment[], points: ReadonlyMap<string, Vertex>) {
  const lengths = chain.map((s) => mathematicalLength(s, points))
  const scale = Math.max(...lengths)
  return lengths.map((length) =>
    scale === Infinity ? Number(length === Infinity) : length / (scale || 1),
  )
}

// Five-point Gauss integration on short angular intervals. Only measurement is
// numerical: drawing always uses the exact SVG ellipse, never sampled chords.
const nodes = [0, -0.5384693101056831, 0.5384693101056831, -0.906179845938664, 0.906179845938664]
const factors = [
  0.5688888888888889, 0.4786286704993665, 0.4786286704993665, 0.2369268850561891,
  0.2369268850561891,
]

function measure(segment: ResolvedSegment, points: ReadonlyMap<string, Vertex>, view: Viewport) {
  const p = toSvg(points.get(segment.startId)!, view),
    q = toSvg(points.get(segment.endId)!, view)
  const arc = fittedArc(segment, points)
  const point = (t: number): SvgPoint =>
    t === 0
      ? p
      : t === 1
        ? q
        : arc
          ? toSvg(pointOnArc(arc, t), view)
          : { x: p.x * (1 - t) + q.x * t, y: p.y * (1 - t) + q.y * t }
  const scale = Math.max(1, Math.abs(p.x), Math.abs(p.y), Math.abs(q.x), Math.abs(q.y))
  const dx = q.x / scale - p.x / scale,
    dy = q.y / scale - p.y / scale
  const norm = Math.hypot(dx, dy)
  const arcLength = (angle: number, sweep: number): number => {
    if (!arc) return 0
    const count = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 8)))
    let result = 0
    for (let i = 0; i < count; i++) {
      const half = sweep / count / 2,
        mid = angle + (2 * i + 1) * half
      for (let j = 0; j < nodes.length; j++) {
        const theta = mid + half * nodes[j]
        result +=
          factors[j] *
          Math.hypot(
            arc.radius * view.scaleX * Math.sin(theta),
            arc.radius * view.scaleY * Math.cos(theta),
          ) *
          Math.abs(half)
      }
    }
    return result
  }
  const tangent = (t: number): SvgPoint => {
    if (!arc) return { x: dx / norm, y: dy / norm }
    const v = tangentOnArc(arc, t),
      x = v.re * view.scaleX,
      y = -v.im * view.scaleY
    const n = Math.hypot(x, y)
    return { x: x / n, y: y / n }
  }
  const total = arc ? arcLength(arc.startAngle, arc.sweep) : norm * scale
  // Solve local angular travel, bounded by the minimum screen speed. Halving
  // [0, 1] a fixed number of times magnifies roundoff at huge screen radii.
  const travel = (angle: number, maximum: number, pixels: number, direction: number): number => {
    if (!arc) return Math.min(maximum, pixels / total)
    const sweep = direction * arc.sweep
    if (arcLength(angle, sweep * maximum) <= pixels) return maximum
    let lo = 0,
      hi = Math.min(
        maximum,
        pixels / arc.radius / Math.min(view.scaleX, view.scaleY) / Math.abs(sweep),
      )
    for (let i = 0; i < 80; i++) {
      const delta = (lo + hi) / 2
      const distance = arcLength(angle, sweep * delta)
      if (Math.abs(distance - pixels) <= 1e-7 || delta === lo || delta === hi) return delta
      if (distance < pixels) lo = delta
      else hi = delta
    }
    return (lo + hi) / 2
  }
  const minimumTip = (pixels: number): number => {
    if (!arc) return Math.min(1, pixels / total)
    return travel(arc.startAngle, 1, pixels, 1)
  }
  const shaft = (t: number, pixels: number) => {
    const end = point(t)
    if (!arc) {
      const start = point(Math.max(0, t - Math.min(t, pixels / total)))
      return { path: `M ${start.x} ${start.y} L ${end.x} ${end.y}`, extent: [start, end] }
    }
    const angle = arc.startAngle + arc.sweep * t
    const delta = travel(angle, t, pixels, -1)
    const sweep = arc.sweep * delta
    // Difference identities retain small displacements without subtracting
    // nearly equal world coordinates or global path parameters.
    const before = (turn: number): SvgPoint => {
      const sine = Math.sin(turn),
        cosineMinusOne = -2 * Math.sin(turn / 2) ** 2
      return {
        x:
          end.x +
          arc.radius * view.scaleX * (Math.cos(angle) * cosineMinusOne + Math.sin(angle) * sine),
        y:
          end.y -
          arc.radius * view.scaleY * (Math.sin(angle) * cosineMinusOne - Math.cos(angle) * sine),
      }
    }
    const start = delta === t ? p : before(sweep)
    const extent = [start, end]
    for (const cardinal of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
      const tau = Math.PI * 2
      const turn = (((Math.sign(sweep) * (angle - cardinal)) % tau) + tau) % tau
      if (turn <= Math.abs(sweep)) extent.push(before(Math.sign(sweep) * turn))
    }
    // Browsers can collapse A commands with enormous radii and minute angles
    // to an empty path. A tangent-matched cubic retains the curvature here;
    // at |sweep| < 1e-4 its approximation error is far below a screen pixel.
    let command: string
    if (Math.abs(sweep) < 1e-4) {
      const k = (4 / 3) * Math.tan(sweep / 4)
      const rx = arc.radius * view.scaleX,
        ry = arc.radius * view.scaleY
      command = `C ${start.x - rx * k * Math.sin(angle - sweep)} ${start.y - ry * k * Math.cos(angle - sweep)} ${end.x + rx * k * Math.sin(angle)} ${end.y + ry * k * Math.cos(angle)} ${end.x} ${end.y}`
    } else {
      command = `A ${arc.radius * view.scaleX} ${arc.radius * view.scaleY} 0 ${Math.abs(sweep) > Math.PI ? 1 : 0} ${arc.sweep > 0 ? 0 : 1} ${end.x} ${end.y}`
    }
    return {
      path: `M ${start.x} ${start.y} ${command}`,
      extent,
    }
  }
  return { point, tangent, total, minimumTip, shaft }
}

export function buildPathArrow(
  chain: readonly ResolvedSegment[],
  points: ReadonlyMap<string, Vertex>,
  viewport: Viewport,
  style: StrokeStyle,
  position: number,
): { segmentId: string; arrow: PathArrowGeometry } | null {
  if (!chain.length || !style.arrows) return null
  const measures = chain.map((s) => measure(s, points, viewport))
  if (measures.reduce((sum, m) => sum + m.total, 0) < 20) return null
  const lengths = weights(chain, points),
    total = lengths.reduce((a, b) => a + b, 0)
  let offset = 0
  let best: { index: number; t: number; position: number; distance: number } | null = null
  for (let index = 0; index < chain.length; index++) {
    const m = measures[index],
      weight = lengths[index]
    if (weight > 0 && m.total >= style.arrowSize) {
      const t = Math.max(
        m.minimumTip(style.arrowSize),
        Math.min(1, (position * total - offset) / weight),
      )
      const actual = (offset + t * weight) / total
      const distance = Math.abs(actual - position)
      if (!best || distance < best.distance) best = { index, t, position: actual, distance }
    }
    offset += weight
  }
  if (!best) return null
  const m = measures[best.index],
    t = best.t
  const shaft = m.shaft(t, Math.max(12, style.arrowSize * 1.2))
  const point = m.point(t),
    tangent = m.tangent(t)
  const extent = shaft.extent
  // The common marker viewBox has its tip at 0, a 10-unit body and ±4 wings.
  for (const x of [-style.arrowSize, 0])
    for (const y of [-style.arrowSize * 0.4, style.arrowSize * 0.4])
      extent.push({
        x: point.x + x * tangent.x - y * tangent.y,
        y: point.y + x * tangent.y + y * tangent.x,
      })
  const pad = Math.max(style.width / 2, style.arrowSize * 0.06)
  const bounds = {
    left: Math.min(...extent.map((p) => p.x)) - pad,
    right: Math.max(...extent.map((p) => p.x)) + pad,
    top: Math.min(...extent.map((p) => p.y)) - pad,
    bottom: Math.max(...extent.map((p) => p.y)) + pad,
  }
  return {
    segmentId: chain[best.index].id,
    arrow: {
      point,
      tangent,
      path: shaft.path,
      objectId: arrowObjectId(chain[0]),
      position: best.position,
      bounds,
    },
  }
}

export function projectArrowPosition(
  chain: readonly ResolvedSegment[],
  points: ReadonlyMap<string, Vertex>,
  point: ComplexPoint,
  metric: PathScreenMetric,
): number | null {
  const lengths = weights(chain, points),
    total = lengths.reduce((a, b) => a + b, 0)
  if (!total) return null
  let offset = 0,
    bestDistance = Infinity,
    position: number | null = null
  chain.forEach((s, index) => {
    const endpoints = { start: points.get(s.startId)!, end: points.get(s.endId)! }
    const hit = nearestPathPoint(
      s.kind === 'arc'
        ? { ...endpoints, kind: 'arc', through: s.through, resolvedArc: s.resolvedArc }
        : { ...endpoints, kind: 'line' },
      point,
      metric,
    )
    if (hit && hit.distance < bestDistance) {
      position = (offset + lengths[index] * hit.t) / total
      bestDistance = hit.distance
    }
    offset += lengths[index]
  })
  return position
}
