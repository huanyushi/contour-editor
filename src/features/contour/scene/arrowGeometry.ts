import {
  arcExtrema,
  arcThrough,
  pointOnArc,
  tangentOnArc,
  type CircularArc,
} from '../../../lib/arc'
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
  const length = (a: number, b: number): number => {
    if (!arc) return norm * ((b - a) * scale)
    const count = Math.max(1, Math.ceil(Math.abs(arc.sweep * (b - a)) / (Math.PI / 8)))
    let result = 0
    for (let i = 0; i < count; i++) {
      const half = (b - a) / count / 2,
        mid = a + (2 * i + 1) * half
      for (let j = 0; j < nodes.length; j++) {
        const angle = arc.startAngle + arc.sweep * (mid + half * nodes[j])
        result +=
          factors[j] *
          Math.hypot(
            arc.radius * view.scaleX * Math.sin(angle),
            arc.radius * view.scaleY * Math.cos(angle),
          ) *
          (half * Math.abs(arc.sweep))
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
  const total = length(0, 1)
  const advance = (end: number, pixels: number): number => {
    if (!arc) return Math.min(end, pixels / total)
    if (length(0, end) <= pixels) return end
    let lo = 0,
      hi = end
    for (let i = 0; i < 44; i++) {
      const delta = (lo + hi) / 2
      if (length(end - delta, end) < pixels) lo = delta
      else hi = delta
    }
    return (lo + hi) / 2
  }
  const minimumTip = (pixels: number): number => {
    if (!arc) return Math.min(1, pixels / total)
    let lo = 0,
      hi = 1
    for (let i = 0; i < 44; i++) {
      const mid = (lo + hi) / 2
      if (length(0, mid) < pixels) lo = mid
      else hi = mid
    }
    return hi
  }
  const path = (a: number, b: number): string => {
    const start = point(a),
      end = point(b)
    return (
      `M ${start.x} ${start.y} ` +
      (arc
        ? `A ${arc.radius * view.scaleX} ${arc.radius * view.scaleY} 0 ${Math.abs(arc.sweep * (b - a)) > Math.PI ? 1 : 0} ${arc.sweep > 0 ? 0 : 1} ${end.x} ${end.y}`
        : `L ${end.x} ${end.y}`)
    )
  }
  const extrema = (a: number, b: number) =>
    arc
      ? arcExtrema({
          ...arc,
          startAngle: arc.startAngle + arc.sweep * a,
          sweep: arc.sweep * (b - a),
        }).map((p) => toSvg(p, view))
      : [point(a), point(b)]
  return { point, tangent, total, advance, minimumTip, path, extrema }
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
  const start = Math.max(0, t - m.advance(t, Math.max(12, style.arrowSize * 1.2)))
  const point = m.point(t),
    tangent = m.tangent(t)
  const extent = m.extrema(start, t)
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
      path: m.path(start, t),
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
