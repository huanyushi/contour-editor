import { arcThrough } from './arc'
import type { ComplexPoint } from './geometry'

/** Canonical direction is shared by broadphase bounds and exact intersections. */
export function canonicalEdge<T extends { start: ComplexPoint; end: ComplexPoint }>(edge: T): T {
  return edge.start.re > edge.end.re ||
    (edge.start.re === edge.end.re && edge.start.im > edge.end.im)
    ? { ...edge, start: edge.end, end: edge.start }
    : edge
}

/** Fit before applying any viewport or pair-wide frame. Keep offsets local. */
export function edgeArcFrame(input: {
  start: ComplexPoint
  end: ComplexPoint
  through: ComplexPoint
}) {
  const edge = canonicalEdge(input)
  const relative = (p: ComplexPoint): ComplexPoint => ({
    re: p.re - edge.start.re,
    im: p.im - edge.start.im,
  })
  const end = relative(edge.end),
    through = relative(edge.through)
  const extent = Math.max(
    Math.abs(end.re),
    Math.abs(end.im),
    Math.abs(through.re),
    Math.abs(through.im),
  )
  if (!Number.isFinite(extent) || extent === 0) throw new Error('圆弧数值跨度无法稳定计算。')
  // Binary scaling introduces no extra rounding of the local coordinates. This
  // preserves the support of shallow arcs and translated endpoint contacts.
  const scale = 2 ** Math.floor(Math.log2(extent))
  const normalized = (p: ComplexPoint): ComplexPoint => ({ re: p.re / scale, im: p.im / scale })
  const result = arcThrough({ re: 0, im: 0 }, normalized(end), normalized(through))
  if (!result.ok) throw new Error(`圆弧数值计算失败：${result.error}`)
  return { origin: edge.start, scale, arc: result.arc }
}
