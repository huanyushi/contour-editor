import type { ComplexPoint } from '../../lib/geometry'
import { arcThrough } from '../../lib/arc'
import {
  nearestPath,
  nearestPathPoint,
  type PathGeometry,
  type PathProjection,
  type PathScreenMetric,
} from '../../lib/pathSnap'
import type { ContourState } from './model'
import { scenePoints, visibleSceneSegments } from './sceneObjects'

/** A snapshot of editable source geometry, deliberately independent of resolved avoidance parts. */
export type SourceSnapPath = PathGeometry & {
  id: string
  startId: string
  endId: string
  origin: 'contour' | 'connection'
}

/** Find nearby lattice points on the finite path, not on its chord or extension. */
export function snapPathInteger(
  raw: ComplexPoint,
  hit: PathProjection & { path: PathGeometry },
  metric: PathScreenMetric,
  enabled: boolean,
): ComplexPoint {
  if (!enabled) return hit.point
  // Membership is translation-invariant: a huge coordinate on one axis must
  // never enlarge the permitted error on the other axis.
  const local = (point: ComplexPoint): ComplexPoint => ({
    re: point.re - hit.path.start.re,
    im: point.im - hit.path.start.im,
  })
  const localPath: PathGeometry = {
    ...hit.path,
    start: { re: 0, im: 0 },
    end: local(hit.path.end),
    ...(hit.path.kind === 'arc' ? { through: local(hit.path.through) } : {}),
  }
  let best = hit.point
  let distance = 8
  const consider = (point: ComplexPoint) => {
    const candidate = { re: Math.round(point.re) || 0, im: Math.round(point.im) || 0 }
    const re = candidate.re - raw.re,
      im = candidate.im - raw.im
    const d = Math.hypot(metric.a * re + metric.c * im, metric.b * re + metric.d * im)
    if (d > distance) return
    const onPath = nearestPathPoint(localPath, local(candidate), { a: 1, b: 0, c: 0, d: 1 })
    if (!onPath || onPath.distance > 1e-9) return
    best = candidate
    distance = d
  }
  consider(raw)
  consider(hit.point)
  const determinant = metric.a * metric.d - metric.b * metric.c
  if (!Number.isFinite(determinant) || determinant === 0) return best
  const rx = (8 * Math.hypot(metric.d, metric.c)) / Math.abs(determinant)
  const ry = (8 * Math.hypot(metric.b, metric.a)) / Math.abs(determinant)
  const path = hit.path
  const arc = path.kind === 'arc' ? arcThrough(path.start, path.end, path.through) : null
  if (arc && !arc.ok) return best
  const dx = path.end.re - path.start.re,
    dy = path.end.im - path.start.im
  // Slice by one integer coordinate and solve the curve, avoiding a 2-D grid scan.
  const axis =
    path.kind === 'line' ? (Math.abs(dx) >= Math.abs(dy) ? 're' : 'im') : rx <= ry ? 're' : 'im'
  const other = axis === 're' ? 'im' : 're'
  const at = (value: number, perpendicular: number): ComplexPoint =>
    axis === 're' ? { re: value, im: perpendicular } : { re: perpendicular, im: value }
  const radius = axis === 're' ? rx : ry
  const lo = Math.ceil(raw[axis] - radius),
    hi = Math.floor(raw[axis] + radius)
  // Path projection remains responsive even under nearly singular CSS transforms.
  if (!Number.isSafeInteger(lo) || !Number.isSafeInteger(hi) || hi - lo > 10000) return best
  for (let value = lo; value <= hi; value++) {
    if (path.kind === 'line') {
      const delta = path.end[axis] - path.start[axis]
      if (delta === 0) continue
      const t = (value - path.start[axis]) / delta
      if (t < 0 || t > 1) continue
      consider(at(value, path.start[other] + t * (path.end[other] - path.start[other])))
    } else if (arc?.ok) {
      const offset = value - arc.arc.center[axis]
      if (Math.abs(offset) > arc.arc.radius) continue
      const span = Math.sqrt(
        Math.max(0, (arc.arc.radius - Math.abs(offset)) * (arc.arc.radius + Math.abs(offset))),
      )
      for (const sign of [-1, 1]) consider(at(value, arc.arc.center[other] + sign * span))
    }
  }
  return best
}

export function sourceSnapPaths(state: ContourState, excludedPointId?: string): SourceSnapPath[] {
  const points = new Map(scenePoints(state).map((point) => [point.id, point]))
  const connections = new Set(state.connections.map((segment) => segment.id))
  return visibleSceneSegments(state).flatMap((segment): SourceSnapPath[] => {
    // Moving a connection's own endpoint would otherwise move the constraint itself.
    if (segment.startId === excludedPointId || segment.endId === excludedPointId) return []
    const start = points.get(segment.startId),
      end = points.get(segment.endId)
    if (!start || !end) return []
    return [
      {
        ...segment,
        ...(segment.kind === 'arc' ? { through: { ...segment.through } } : {}),
        start: { re: start.re, im: start.im },
        end: { re: end.re, im: end.im },
        origin: connections.has(segment.id) ? 'connection' : 'contour',
      },
    ]
  })
}

export function captureMarkerPath(
  paths: readonly SourceSnapPath[],
  point: ComplexPoint,
  metric: PathScreenMetric,
): SourceSnapPath[] | null {
  const hit = nearestPath(paths, point, metric, 8)
  if (!hit) return null
  if (hit.path.origin === 'connection') return [hit.path]
  const endpoints = new Map<string, SourceSnapPath[]>()
  for (const path of paths) {
    if (path.origin !== 'contour') continue
    for (const id of [path.startId, path.endId]) {
      const neighbors = endpoints.get(id) ?? []
      neighbors.push(path)
      endpoints.set(id, neighbors)
    }
  }
  const component = new Set<SourceSnapPath>([hit.path])
  for (const path of component) {
    for (const id of [path.startId, path.endId]) {
      for (const neighbor of endpoints.get(id) ?? []) component.add(neighbor)
    }
  }
  return paths.filter((path) => component.has(path))
}
