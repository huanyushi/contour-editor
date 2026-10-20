import type { ComplexPoint } from './geometry'

export function snapToInteger(
  point: ComplexPoint,
  pixelsPerUnit: number | { x: number; y: number },
  enabled: boolean,
): ComplexPoint {
  const scale =
    typeof pixelsPerUnit === 'number' ? { x: pixelsPerUnit, y: pixelsPerUnit } : pixelsPerUnit
  if (
    !enabled ||
    !Number.isFinite(scale.x) ||
    !Number.isFinite(scale.y) ||
    scale.x <= 0 ||
    scale.y <= 0
  )
    return point
  const nearest = { re: Math.round(point.re) || 0, im: Math.round(point.im) || 0 }
  return Math.hypot((nearest.re - point.re) * scale.x, (nearest.im - point.im) * scale.y) <= 8
    ? nearest
    : point
}
