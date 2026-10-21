import { arcThrough, pointOnArc } from './arc'
import type { ComplexPoint } from './geometry'

export type PathGeometry = {
  start: ComplexPoint
  end: ComplexPoint
} & ({ kind: 'line' } | { kind: 'arc'; through: ComplexPoint })

/** Linear map from mathematical displacements to CSS screen pixels. */
export interface PathScreenMetric {
  a: number
  b: number
  c: number
  d: number
}

export interface PathProjection {
  point: ComplexPoint
  t: number
  distance: number
}

export function nearestPathPoint(
  path: PathGeometry,
  point: ComplexPoint,
  metric: PathScreenMetric,
): PathProjection | null {
  const screen = (re: number, im: number) => ({
    x: metric.a * re + metric.c * im,
    y: metric.b * re + metric.d * im,
  })
  const projection = (candidate: ComplexPoint, t: number): PathProjection => {
    const delta = screen(candidate.re - point.re, candidate.im - point.im)
    return { point: candidate, t, distance: Math.hypot(delta.x, delta.y) }
  }
  if (path.kind === 'line') {
    const dx = path.end.re - path.start.re,
      dy = path.end.im - path.start.im
    const delta = screen(dx, dy)
    const length = Math.hypot(delta.x, delta.y)
    if (!Number.isFinite(length) || length === 0) return null
    const offset = screen(point.re - path.start.re, point.im - path.start.im)
    const t = Math.max(
      0,
      Math.min(
        1,
        (offset.x / length) * (delta.x / length) + (offset.y / length) * (delta.y / length),
      ),
    )
    return projection(
      t === 0
        ? path.start
        : t === 1
          ? path.end
          : {
              re: path.start.re + t * dx,
              im: path.start.im + t * dy,
            },
      t,
    )
  }
  const result = arcThrough(path.start, path.end, path.through)
  if (!result.ok) return null
  const arc = result.arc
  const u = screen(arc.radius, 0),
    v = screen(0, arc.radius)
  const w = screen(arc.center.re - point.re, arc.center.im - point.im)
  const scale = Math.max(
    Math.abs(u.x),
    Math.abs(u.y),
    Math.abs(v.x),
    Math.abs(v.y),
    Math.abs(w.x),
    Math.abs(w.y),
  )
  if (!Number.isFinite(scale) || scale === 0) return null
  const dot = (a: typeof u, b: typeof u) =>
    (a.x / scale) * (b.x / scale) + (a.y / scale) * (b.y / scale)
  const a = dot(w, v),
    b = dot(w, u),
    c = dot(v, v) - dot(u, u),
    d = dot(u, v)
  let best = projection(path.start, 0)
  const consider = (candidate: PathProjection) => {
    if (candidate.distance < best.distance) best = candidate
  }
  consider(projection(path.end, 1))
  // Stationary points of squared screen distance are a quartic in tan(angle / 2).
  // Two bounded charts cover the whole circle, including the chart's point at infinity.
  // This solves the actual projected ellipse; it never replaces an arc with chords.
  for (const sign of [1, -1]) {
    const roots = polynomialRoots([
      sign * a + d,
      -2 * sign * b + 2 * c,
      -6 * d,
      -2 * sign * b - 2 * c,
      -sign * a + d,
    ])
    for (const root of roots) {
      const angle = 2 * Math.atan(root) + (sign === 1 ? 0 : Math.PI)
      const tau = 2 * Math.PI
      const travel = (((Math.sign(arc.sweep) * (angle - arc.startAngle)) % tau) + tau) % tau
      const t = travel / Math.abs(arc.sweep)
      if (t > 0 && t < 1) consider(projection(pointOnArc(arc, t), t))
    }
  }
  return best
}

export function nearestPath<T extends PathGeometry>(
  paths: readonly T[],
  point: ComplexPoint,
  metric: PathScreenMetric,
  maxDistance = Infinity,
): (PathProjection & { path: T }) | null {
  let best: (PathProjection & { path: T }) | null = null
  for (const path of paths) {
    const hit = nearestPathPoint(path, point, metric)
    if (hit && hit.distance <= maxDistance && (!best || hit.distance < best.distance))
      best = { ...hit, path }
  }
  return best
}

/** Isolate all real roots in [-1, 1] using the derivative's monotone intervals. */
function polynomialRoots(input: number[]): number[] {
  const magnitude = Math.max(...input.map(Math.abs))
  if (magnitude === 0) return [0]
  const coefficients = input.map((n) => n / magnitude)
  while (coefficients.length > 1 && coefficients.at(-1) === 0) coefficients.pop()
  if (coefficients.length === 1) return []
  if (coefficients.length === 2) {
    const root = -coefficients[0] / coefficients[1]
    return root >= -1 && root <= 1 ? [root] : []
  }
  const evaluate = (x: number) =>
    coefficients.reduceRight((value, coefficient) => value * x + coefficient, 0)
  const critical = polynomialRoots(coefficients.slice(1).map((n, i) => n * (i + 1)))
  const bounds = [-1, ...critical, 1]
  const roots = bounds.filter((x) => Math.abs(evaluate(x)) <= 1e-14)
  for (let i = 1; i < bounds.length; i++) {
    let lo = bounds[i - 1],
      hi = bounds[i]
    const left = evaluate(lo)
    if (left * evaluate(hi) >= 0) continue
    for (let step = 0; step < 55; step++) {
      const mid = (lo + hi) / 2
      if (evaluate(mid) * left > 0) lo = mid
      else hi = mid
    }
    roots.push((lo + hi) / 2)
  }
  return roots.sort((a, b) => a - b)
}
