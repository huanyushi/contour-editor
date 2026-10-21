import { arcThrough } from './arc'
import type { AvoidanceGeometry } from './avoidanceGeometry'
import { canonicalEdge, edgeArcFrame } from './edgeArcFrame'
import { isValidPoint, type ComplexPoint } from './geometry'
import { intersectEdges, type GeometricEdge } from './geometryIntersections'

export interface PathAvoidanceResultValue {
  mode: 'arc' | 'corner'
  geometry: AvoidanceGeometry
  /** Directed fraction on the source arc, or on the incoming corner edge. */
  entryT: number
  /** Directed fraction on the source arc, or on the outgoing corner edge. */
  exitT: number
  /** Side selecting the shorter of the two pole-circle arcs. */
  defaultSide: 'left' | 'right'
}

export type PathAvoidanceResult =
  { ok: true; value: PathAvoidanceResultValue } | { ok: false; error: string }

type Side = 'left' | 'right'
type CircleInput = { center: ComplexPoint; radius: number; side: Side }
type CircleHit = { point: ComplexPoint; offset: ComplexPoint }
const TAU = 2 * Math.PI
const EPSILON = 1e-9
const positiveAngle = (angle: number) => ((angle % TAU) + TAU) % TAU
const distance = (a: ComplexPoint, b: ComplexPoint) => Math.hypot(a.re - b.re, a.im - b.im)

function relative(point: ComplexPoint, origin: ComplexPoint): ComplexPoint {
  return { re: point.re - origin.re, im: point.im - origin.im }
}

function localEdge<T extends GeometricEdge>(edge: T, origin: ComplexPoint): T {
  return {
    ...edge,
    start: relative(edge.start, origin),
    end: relative(edge.end, origin),
    ...(edge.kind === 'arc' ? { through: relative(edge.through, origin) } : {}),
  }
}

function inWorld(value: PathAvoidanceResultValue, center: ComplexPoint): PathAvoidanceResult {
  const restore = (point: ComplexPoint): ComplexPoint => ({
    re: center.re + point.re,
    im: center.im + point.im,
  })
  const g = value.geometry
  const entry = restore(g.entry)
  const exit = restore(g.exit)
  const through = restore(g.through)
  // Persisted arcs use these three points. Check representability without using
  // the rounded world-space fit to replace the exact pole center or radius.
  const representable = arcThrough(entry, exit, through)
  if (!representable.ok) throw new Error(`绕行圆弧在当前坐标精度下无法表示：${representable.error}`)
  // Only output-coordinate rounding may relax pole-relative precision. A large
  // source origin is not a world ULP budget for a small circle near (0, 0).
  const worldUlp =
    Number.EPSILON *
    Math.max(
      ...[center, entry, exit, through].flatMap((point) => [
        Math.abs(point.re),
        Math.abs(point.im),
      ]),
    )
  const tolerance = EPSILON * g.arc.radius + 4 * worldUlp
  if (
    distance(representable.arc.center, center) > tolerance ||
    Math.abs(representable.arc.radius - g.arc.radius) > tolerance
  )
    throw new Error('绕行圆弧在当前坐标精度下无法保持指定圆心和半径。')
  return {
    ok: true,
    value: {
      ...value,
      geometry: {
        ...g,
        entryBase: entry,
        entry,
        exit,
        exitBase: exit,
        through,
        arc: { ...g.arc, center: { ...center } },
      },
    },
  }
}

/** Keep the small-circle radical-axis offsets before adding any large origin. */
function arcCircleOffsets(
  edge: Extract<GeometricEdge, { kind: 'arc' }>,
  center: ComplexPoint,
  radius: number,
): ComplexPoint[] {
  const { origin, scale, arc } = edgeArcFrame(edge)
  const dx = arc.center.re - (center.re - origin.re) / scale
  const dy = arc.center.im - (center.im - origin.im) / scale
  const d = Math.hypot(dx, dy)
  if (d === 0) return [] // Coincident supports are handled by the finite intersector.
  const r = radius / scale
  const anchorPole = r <= arc.radius
  const small = Math.min(r, arc.radius)
  const large = Math.max(r, arc.radius)
  // Factor the difference of squares in its well-conditioned regime, as in
  // geometryIntersections. Solve on the smaller circle in unit-radius space.
  const along =
    d > large / 2
      ? small / (2 * d) + ((d - large) / small) * (0.5 + large / (2 * d))
      : d / (2 * small) + ((small - large) / d) * (0.5 + large / (2 * small))
  if (!Number.isFinite(along)) throw new Error('绕行圆与源圆弧的数值尺度无法稳定解析。')
  const ux = (anchorPole ? dx : -dx) / d
  const uy = (anchorPole ? dy : -dy) / d
  const offsets: ComplexPoint[] = []
  for (const sign of [-1, 1]) {
    const result = intersectEdges(
      {
        kind: 'arc',
        start: { re: -1, im: 0 },
        end: { re: 1, im: 0 },
        through: { re: 0, im: sign },
      },
      { kind: 'line', start: { re: along, im: -2 }, end: { re: along, im: 2 } },
    )
    if (result.kind !== 'points') continue
    for (const point of result.points) {
      const x = point.re * ux - point.im * uy
      const y = point.re * uy + point.im * ux
      const offset = anchorPole
        ? { re: radius * x, im: radius * y }
        : { re: (dx + arc.radius * x) * scale, im: (dy + arc.radius * y) * scale }
      if (offsets.every((previous) => distance(offset, previous) / radius > EPSILON))
        offsets.push(offset)
    }
  }
  return offsets
}

function validateCircle({ center, radius, side }: CircleInput) {
  if (!isValidPoint(center)) throw new Error('绕行圆心必须是可绘制的有限坐标。')
  if (!Number.isFinite(radius) || radius <= 0) throw new Error('绕行半径必须是有限正数。')
  if (side !== 'left' && side !== 'right') throw new Error('绕行方向必须为左侧或右侧。')
  if (
    !isValidPoint({ re: center.re + radius, im: center.im + radius }) ||
    !isValidPoint({ re: center.re - radius, im: center.im - radius })
  )
    throw new Error('绕行圆超出安全绘制范围。')
}

/** Fit in the edge's own frame, then restore the caller's traversal direction. */
function edgeMeasure(edge: GeometricEdge) {
  const points = [edge.start, edge.end, ...(edge.kind === 'arc' ? [edge.through] : [])]
  if (!points.every(isValidPoint)) throw new Error('源路径必须使用可绘制的有限坐标。')
  if (edge.kind === 'line') {
    const dx = edge.end.re - edge.start.re
    const dy = edge.end.im - edge.start.im
    const length = Math.hypot(dx, dy)
    if (!Number.isFinite(length) || length === 0) throw new Error('源线段端点不能重合。')
    return {
      length,
      parameter: (point: ComplexPoint) =>
        ((point.re - edge.start.re) / length) * (dx / length) +
        ((point.im - edge.start.im) / length) * (dy / length),
      point: (t: number) => ({ re: edge.start.re + dx * t, im: edge.start.im + dy * t }),
    }
  }
  const { origin, scale, arc } = edgeArcFrame(edge)
  const reversed = origin !== edge.start
  const startAngle = arc.startAngle + (reversed ? arc.sweep : 0)
  const sweep = reversed ? -arc.sweep : arc.sweep
  const length = arc.radius * scale * Math.abs(sweep)
  if (!Number.isFinite(length)) throw new Error('源圆弧长度无法稳定表示。')
  return {
    length,
    parameter: (point: ComplexPoint) => {
      const angle = Math.atan2(
        (point.im - origin.im) / scale - arc.center.im,
        (point.re - origin.re) / scale - arc.center.re,
      )
      const progress = positiveAngle(Math.sign(sweep) * (angle - startAngle))
      return progress / Math.abs(sweep)
    },
    point: (t: number) => {
      const angle = startAngle + sweep * t
      return {
        re: origin.re + (arc.center.re + arc.radius * Math.cos(angle)) * scale,
        im: origin.im + (arc.center.im + arc.radius * Math.sin(angle)) * scale,
      }
    },
  }
}

/** Two exact semicircles cover the pole circle, including their shared seam. */
function circleHits(edge: GeometricEdge, center: ComplexPoint, radius: number): CircleHit[] {
  const start = { re: center.re - radius, im: center.im }
  const end = { re: center.re + radius, im: center.im }
  const points: ComplexPoint[] = []
  for (const sign of [-1, 1]) {
    const result = intersectEdges(edge, {
      kind: 'arc',
      start,
      end,
      through: { re: center.re, im: center.im + sign * radius },
    })
    if (result.kind === 'overlap') throw new Error('源圆弧不能与绕行圆重合。')
    if (result.kind === 'points') {
      for (const point of result.points) {
        if (points.every((previous) => distance(point, previous) / radius > EPSILON))
          points.push(point)
      }
    }
  }
  if (edge.kind === 'line')
    return points.map((point) => ({ point, offset: relative(point, center) }))
  if (points.length === 0) return []
  const offsets = arcCircleOffsets(edge, center, radius)
  if (offsets.length === 0) throw new Error('绕行圆交点无法在半径尺度上稳定解析。')
  return points.map((point) => {
    const approximate = relative(point, center)
    const offset = offsets.reduce((nearest, candidate) =>
      distance(candidate, approximate) < distance(nearest, approximate) ? candidate : nearest,
    )
    return {
      point: { re: center.re + offset.re, im: center.im + offset.im },
      offset,
    }
  })
}

function requireOutside(point: ComplexPoint, center: ComplexPoint, radius: number) {
  if (!(distance(point, center) / radius > 1 + EPSILON))
    throw new Error('绕行半径过大，源路径外端点必须严格位于绕行圆外。')
}

function geometry(
  entry: ComplexPoint,
  exit: ComplexPoint,
  input: CircleInput,
  footprint: readonly [number, number],
  projectedCenter = footprint[0] / 2 + footprint[1] / 2,
) {
  // Geometry points remain pole-relative until inWorld adds the original pole.
  const { radius, side } = input
  const center = { re: 0, im: 0 }
  const ax = entry.re / radius
  const ay = entry.im / radius
  const bx = exit.re / radius
  const by = exit.im / radius
  if (distance(entry, exit) / radius <= EPSILON) throw new Error('绕行需要两个不同的裁剪端点。')
  const shortSweep = Math.atan2(ax * by - ay * bx, ax * bx + ay * by)
  const defaultSide: Side = shortSweep < 0 ? 'left' : 'right'
  // A clockwise arc bulges left of its directed entry→exit chord; CCW bulges right.
  const sweep =
    side === 'left'
      ? shortSweep > 0
        ? shortSweep - TAU
        : shortSweep
      : shortSweep < 0
        ? shortSweep + TAU
        : shortSweep
  const startAngle = Math.atan2(ay, ax)
  const middle = startAngle + sweep / 2
  const width = distance(entry, exit)
  const result: AvoidanceGeometry = {
    entryBase: entry,
    entry,
    exit,
    exitBase: exit,
    through: {
      re: center.re + radius * Math.cos(middle),
      im: center.im + radius * Math.sin(middle),
    },
    arc: { center: { ...center }, radius, startAngle, sweep },
    projectedCenter,
    signedDistance: 0,
    preferredOpeningWidth: width,
    actualOpeningWidth: width,
    footprint,
    onLine: true,
  }
  return { geometry: result, defaultSide }
}

function failed(error: unknown): PathAvoidanceResult {
  return { ok: false, error: error instanceof Error ? error.message : '绕行几何无法稳定计算。' }
}

export function buildArcAvoidance(input: {
  source: Extract<GeometricEdge, { kind: 'arc' }>
  center: ComplexPoint
  radius: number
  side: 'left' | 'right'
}): PathAvoidanceResult {
  try {
    validateCircle(input)
    // The source's canonical origin preserves the same local differences used by
    // edgeArcFrame, including shallow arcs. Do not round center ± radius in world
    // space, or refit a shallow source after subtracting a distant pole center.
    const origin = canonicalEdge(input.source).start
    const local = {
      ...input,
      source: localEdge(input.source, origin),
      center: relative(input.center, origin),
    }
    const { source, center, radius } = local
    const measure = edgeMeasure(source)
    requireOutside(source.start, center, radius)
    requireOutside(source.end, center, radius)
    const hits = circleHits(source, center, radius)
      .map((hit) => ({ ...hit, t: measure.parameter(hit.point) }))
      .sort((a, b) => a.t - b.t)
    if (hits.length !== 2) throw new Error('源圆弧必须与绕行圆有两个不同的有限交点。')
    const [entry, exit] = hits
    if (!(entry.t > 0 && exit.t < 1 && entry.t < exit.t))
      throw new Error('绕行裁剪区间必须严格位于源圆弧内部。')
    if (!(distance(measure.point((entry.t + exit.t) / 2), center) / radius < 1 - EPSILON))
      throw new Error('裁剪区间必须位于绕行圆内，不能仅相切。')
    return inWorld(
      {
        mode: 'arc',
        ...geometry(entry.offset, exit.offset, local, [
          entry.t * measure.length,
          exit.t * measure.length,
        ]),
        entryT: entry.t,
        exitT: exit.t,
      },
      input.center,
    )
  } catch (error) {
    return failed(error)
  }
}

export function buildCornerAvoidance(input: {
  incoming: GeometricEdge
  outgoing: GeometricEdge
  center: ComplexPoint
  radius: number
  side: 'left' | 'right'
}): PathAvoidanceResult {
  try {
    validateCircle(input)
    const origin = input.center
    const local = {
      ...input,
      incoming: localEdge(input.incoming, origin),
      outgoing: localEdge(input.outgoing, origin),
      center: { re: 0, im: 0 },
    }
    const { incoming, outgoing, center, radius } = local
    const before = edgeMeasure(incoming)
    const after = edgeMeasure(outgoing)
    if (distance(incoming.end, center) !== 0 || distance(outgoing.start, center) !== 0)
      throw new Error('角点必须是进入段终点和离开段起点。')
    requireOutside(incoming.start, center, radius)
    requireOutside(outgoing.end, center, radius)
    const entries = circleHits(incoming, center, radius)
      .map((hit) => ({ ...hit, t: before.parameter(hit.point) }))
      .sort((a, b) => a.t - b.t)
    const exits = circleHits(outgoing, center, radius)
      .map((hit) => ({ ...hit, t: after.parameter(hit.point) }))
      .sort((a, b) => a.t - b.t)
    const entry = entries.at(-1)
    const exit = exits[0]
    if (!entry || !exit || !(entry.t > 0 && entry.t < 1 && exit.t > 0 && exit.t < 1))
      throw new Error('角点两侧必须各有一个可用的有限裁剪交点。')
    return inWorld(
      {
        mode: 'corner',
        ...geometry(
          entry.offset,
          exit.offset,
          local,
          [entry.t * before.length, before.length],
          before.length,
        ),
        entryT: entry.t,
        exitT: exit.t,
      },
      input.center,
    )
  } catch (error) {
    return failed(error)
  }
}
