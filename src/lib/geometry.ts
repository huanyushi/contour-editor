import { defaultViewport, type Viewport } from './viewport'

export interface ComplexPoint {
  re: number
  im: number
}
export interface SvgPoint {
  x: number
  y: number
}

export function toSvg(point: ComplexPoint, view: Viewport = defaultViewport()): SvgPoint {
  return {
    x: 400 + (point.re - view.centerRe) * view.scaleX,
    y: 300 - (point.im - view.centerIm) * view.scaleY,
  }
}

export function fromSvg(point: SvgPoint, view: Viewport = defaultViewport()): ComplexPoint {
  return {
    re: (point.x - 400) / view.scaleX + view.centerRe,
    im: (300 - point.y) / view.scaleY + view.centerIm,
  }
}

// Keep both mathematical coordinates and their rendered values finite.
export function isValidPoint(point: ComplexPoint): boolean {
  const svg = toSvg(point)
  return [point.re, point.im, svg.x, svg.y].every(Number.isFinite)
}
