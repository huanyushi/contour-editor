import { Arc, Circle, Line, Point, Segment, Utils, Vector } from '@flatten-js/core'
import { canonicalEdge, edgeArcFrame } from './edgeArcFrame'
import type { ComplexPoint } from './geometry'

export type GeometricEdge = {
  start: ComplexPoint
  end: ComplexPoint
} & ({ kind: 'line' } | { kind: 'arc'; through: ComplexPoint })

export type IntersectionResult =
  { kind: 'none' } | { kind: 'points'; points: ComplexPoint[] } | { kind: 'overlap' }

const EPSILON = 1e-9
type Shape = Segment | Arc
type LocalFrame = {
  point: (base: ComplexPoint, offset?: ComplexPoint, offsetScale?: number) => Point
  length: (value: number, valueScale: number) => number
}

function toShapes(edge: GeometricEdge, frame: LocalFrame): Shape[] {
  edge = canonicalEdge(edge)
  const start = frame.point(edge.start),
    end = frame.point(edge.end)
  if (
    start.x === end.x &&
    start.y === end.y &&
    (edge.start.re !== edge.end.re || edge.start.im !== edge.end.im)
  )
    throw new Error('路径数值尺度差异过大，公共坐标系无法分辨端点。')
  if (edge.kind === 'line') return [new Segment(start, end)]
  const fitted = edgeArcFrame(edge)
  const { center, radius, startAngle, sweep } = fitted.arc
  const localCenter = frame.point(fitted.origin, center, fitted.scale)
  const localRadius = frame.length(radius, fitted.scale)
  if (!Number.isFinite(localRadius) || localRadius <= 0)
    throw new Error('圆弧数值半径无法在公共坐标系中表示。')
  // Intersection has no traversal direction. Canonical CCW arcs with nonnegative
  // starts avoid contains() mistaking a tiny clockwise sweep at zero for 2π.
  const ccwStart = sweep > 0 ? startAngle : startAngle + sweep
  const angle = ((ccwStart % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
  // Flatten also compares angular sweeps with its absolute global tolerance.
  // Exact half-turn/branch-cut subdivisions keep a nearly-full arc finite and
  // prevent valid tiny intervals crossing zero from being interpreted as 2π.
  const pieces: Arc[] = []
  const finish = angle + Math.abs(sweep)
  for (let from = angle; from < finish;) {
    const to = Math.min(finish, (Math.floor(from / Math.PI) + 1) * Math.PI)
    const turn = from >= 2 * Math.PI ? 2 * Math.PI : 0
    pieces.push(new Arc(localCenter, localRadius, from - turn, to - turn, true))
    from = to
  }
  return pieces
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function unique(points: Point[], epsilon: number): Point[] {
  return points.filter((p, index) =>
    points.slice(0, index).every((previous) => distance(p, previous) > epsilon),
  )
}

function sameSupport(a: Shape, b: Shape, epsilon: number): boolean {
  if (a instanceof Arc && b instanceof Arc)
    return distance(a.pc, b.pc) <= epsilon && Math.abs(a.r - b.r) <= epsilon
  if (a instanceof Segment && b instanceof Segment) {
    const ax = (a.end.x - a.start.x) / a.length
    const ay = (a.end.y - a.start.y) / a.length
    const bx = (b.end.x - b.start.x) / b.length
    const by = (b.end.y - b.start.y) / b.length
    // Endpoint proximity to the longer line alone can hide a short tilted edge.
    // Compare directions as angles, then check support distances in both orders.
    return (
      Math.abs(ax * by - ay * bx) <= EPSILON &&
      [b.start, b.end].every(
        (p) => Math.abs(ax * (p.y - a.start.y) - ay * (p.x - a.start.x)) <= epsilon,
      ) &&
      [a.start, a.end].every(
        (p) => Math.abs(bx * (p.y - b.start.y) - by * (p.x - b.start.x)) <= epsilon,
      )
    )
  }
  return false
}

function sharedInterval(a: Shape, b: Shape, epsilon: number): boolean {
  let pieces: Shape[] = [a]
  // Exact subdivision at the other edge's boundaries, never polyline sampling.
  // Each resulting open interval is wholly inside or outside b on a common support.
  for (const boundary of [b.start, b.end]) {
    pieces = pieces.flatMap((piece) =>
      piece.contains(boundary)
        ? piece.split(boundary).filter((part): part is Shape => part != null)
        : [piece],
    )
  }
  return pieces.some((piece) => piece.length > epsilon && b.contains(piece.middle()))
}

function arcArcCandidates(first: Arc, second: Arc, units: number): Point[] {
  // Always anchor on the smaller circle, with a deterministic tie break.
  if (
    first.r > second.r ||
    (first.r === second.r &&
      (first.pc.x > second.pc.x || (first.pc.x === second.pc.x && first.pc.y > second.pc.y)))
  )
    [first, second] = [second, first]
  const dx = second.pc.x - first.pc.x,
    dy = second.pc.y - first.pc.y
  const d = Math.hypot(dx, dy)
  if (d === 0) return [] // Distinct concentric supports (coincident handled above).
  // Radical-axis distance in small-radius units:
  // a/r = (r² + d² - R²)/(2dr).
  // Near the larger boundary factor d²-R²; near concentric supports instead
  // factor r²-R². Each avoids cancellation in its own conditioning regime.
  // In both cases the library computes the chord on the small circle, not R²-a².
  const along =
    d > second.r / 2
      ? first.r / (2 * d) + ((d - second.r) / first.r) * (0.5 + second.r / (2 * d))
      : d / (2 * first.r) + ((first.r - second.r) / d) * (0.5 + second.r / (2 * first.r))
  if (!Number.isFinite(along)) throw new Error('圆弧数值尺度差异过大，无法稳定计算交点。')
  // Let Flatten solve a conditioned circle/line pair, then restore the common
  // frame. Its tolerance now acts at the small circle's scale, without mutation.
  const circle = new Circle(new Point(0, 0), units)
  const chord = new Line(new Point(along * units, 0), new Vector(1, 0))
  const ratio = first.r / units,
    ux = dx / d,
    uy = dy / d
  return circle
    .intersect(chord)
    .map(
      (p) =>
        new Point(
          first.pc.x + (p.x * ux - p.y * uy) * ratio,
          first.pc.y + (p.x * uy + p.y * ux) * ratio,
        ),
    )
}

/** Intersect finite mathematical edges in one shared, translation-free local frame. */
export function intersectEdges(a: GeometricEdge, b: GeometricEdge): IntersectionResult {
  const points = [a.start, a.end, b.start, b.end]
  if (a.kind === 'arc') points.push(a.through)
  if (b.kind === 'arc') points.push(b.through)
  // A canonical origin makes swapping edges or reversing endpoints numerically identical.
  const origin = [...points].sort((p, q) => p.re - q.re || p.im - q.im)[0]
  const scale = Math.max(
    ...points.flatMap((p) => [Math.abs(p.re - origin.re), Math.abs(p.im - origin.im)]),
  )
  if (!Number.isFinite(scale)) throw new Error('路径数值跨度过大，无法稳定计算交点。')
  // Two coincident point-edges have a real contact, not a 0/0 frame.
  if (scale === 0) return { kind: 'points', points: [{ ...origin }] }
  // Flatten's absolute distance tolerance is not the project's relative tolerance.
  // Reserve headroom for its contains/split predicates without changing global state.
  const units = Math.max(1, (16 * Utils.getTolerance()) / EPSILON)
  const epsilon = EPSILON * units
  const frame: LocalFrame = {
    // Subtract the common origin before adding an edge-relative fitted offset;
    // never construct and then subtract a rounded world-space circle center.
    point: (base, offset, offsetScale = 1) => {
      const x = ((base.re - origin.re + (offset?.re ?? 0) * offsetScale) / scale) * units
      const y = ((base.im - origin.im + (offset?.im ?? 0) * offsetScale) / scale) * units
      if (!Number.isFinite(x) || !Number.isFinite(y))
        throw new Error('路径数值坐标无法在公共坐标系中表示。')
      return new Point(x, y)
    },
    length: (value, valueScale) => ((value * valueScale) / scale) * units,
  }
  const firstPieces = toShapes(a, frame)
  const secondPieces = toShapes(b, frame)
  const intersections: Point[] = []
  for (const first of firstPieces) {
    for (const second of secondPieces) {
      if (sameSupport(first, second, epsilon)) {
        if (sharedInterval(first, second, epsilon)) return { kind: 'overlap' }
        intersections.push(
          ...[first.start, first.end, second.start, second.end].filter(
            (p) => first.contains(p) && second.contains(p),
          ),
        )
      } else {
        const candidates =
          first instanceof Arc && second instanceof Arc
            ? arcArcCandidates(first, second, units)
            : first.intersect(second)
        // The nearly-parallel fallback checks dimensionless t/u against the
        // global tolerance. Recheck finite membership in distance units.
        intersections.push(...candidates.filter((p) => first.contains(p) && second.contains(p)))
      }
    }
  }
  const distinct = unique(intersections, epsilon)
  return distinct.length === 0
    ? { kind: 'none' }
    : {
        kind: 'points',
        points: distinct
          .sort((p, q) => p.x - q.x || p.y - q.y)
          .map((p) => ({
            re: origin.re + (p.x / units) * scale,
            im: origin.im + (p.y / units) * scale,
          })),
      }
}
