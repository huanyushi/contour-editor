import type { ComplexPoint } from './geometry'
import { formatTick, gridStep, type Viewport } from './viewport'

export function nearestGridPoint(point: ComplexPoint, view: Viewport): ComplexPoint {
  const stepX = gridStep(view.scaleX, view.centerRe)
  const stepY = gridStep(view.scaleY, view.centerIm)
  return {
    re: Number(formatTick(Math.round(point.re / stepX) * stepX, stepX)),
    im: Number(formatTick(Math.round(point.im / stepY) * stepY, stepY)),
  }
}

export function snapToGrid(
  point: ComplexPoint,
  pixelsPerUnit: number | { x: number; y: number },
  enabled: boolean,
  view: Viewport,
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
  const nearest = nearestGridPoint(point, view)
  return Math.hypot((nearest.re - point.re) * scale.x, (nearest.im - point.im) * scale.y) <= 8
    ? nearest
    : point
}
