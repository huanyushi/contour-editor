import type { ComplexPoint, SvgPoint } from './geometry'

export interface Viewport {
  centerRe: number
  centerIm: number
  scaleX: number
  scaleY: number
  locked: boolean
}
export interface CanvasSize {
  width: number
  height: number
}
export const exportSize: CanvasSize = { width: 800, height: 600 }

// Keep the existing projection origin while changing only the visible rectangle.
export function canvasBounds(size: CanvasSize = exportSize) {
  return {
    left: 400 - size.width / 2,
    top: 300 - size.height / 2,
    right: 400 + size.width / 2,
    bottom: 300 + size.height / 2,
  }
}
export interface AxesSettings {
  visible: boolean
  ticks: boolean
  color: string
  width: number
  arrow: 'latex' | 'triangle' | 'open' | 'none'
  arrowSize: number
}
export const MIN_SCALE = 0.01
export const MAX_SCALE = 4000
export const defaultViewport = (): Viewport => ({
  centerRe: 0,
  centerIm: 0,
  scaleX: 40,
  scaleY: 40,
  locked: true,
})
export const defaultAxes = (): AxesSettings => ({
  visible: true,
  ticks: true,
  color: '#7b898e',
  width: 1,
  arrow: 'latex',
  arrowSize: 10,
})
export function validViewport(view: Viewport): boolean {
  return (
    [view.centerRe, view.centerIm, view.scaleX, view.scaleY].every(Number.isFinite) &&
    Math.abs(view.centerRe) <= 1e12 &&
    Math.abs(view.centerIm) <= 1e12 &&
    view.scaleX >= MIN_SCALE &&
    view.scaleX <= MAX_SCALE &&
    view.scaleY >= MIN_SCALE &&
    view.scaleY <= MAX_SCALE &&
    typeof view.locked === 'boolean' &&
    (!view.locked || view.scaleX === view.scaleY)
  )
}
export function validAxes(axes: AxesSettings): boolean {
  return (
    typeof axes.visible === 'boolean' &&
    typeof axes.ticks === 'boolean' &&
    /^#[\da-f]{6}$/i.test(axes.color) &&
    Number.isFinite(axes.width) &&
    axes.width >= 0.5 &&
    axes.width <= 4 &&
    Number.isFinite(axes.arrowSize) &&
    axes.arrowSize >= 6 &&
    axes.arrowSize <= 20 &&
    ['latex', 'triangle', 'open', 'none'].includes(axes.arrow)
  )
}
export function zoomViewport(view: Viewport, anchor: SvgPoint, factor: number): Viewport {
  if (!Number.isFinite(factor) || factor <= 0) return view
  const ratio = Math.min(
    Math.max(factor, MIN_SCALE / view.scaleX, MIN_SCALE / view.scaleY),
    MAX_SCALE / view.scaleX,
    MAX_SCALE / view.scaleY,
  )
  const scaleX = view.scaleX * ratio
  const scaleY = view.scaleY * ratio
  return {
    ...view,
    scaleX,
    scaleY,
    centerRe: view.centerRe + (anchor.x - 400) * (1 / view.scaleX - 1 / scaleX),
    centerIm: view.centerIm - (anchor.y - 300) * (1 / view.scaleY - 1 / scaleY),
  }
}
export function panViewport(view: Viewport, dx: number, dy: number): Viewport {
  return {
    ...view,
    centerRe: view.centerRe - dx / view.scaleX,
    centerIm: view.centerIm + dy / view.scaleY,
  }
}
export function gridStep(scale: number, center = 0): number {
  const integerDigits = Math.max(1, Math.floor(Math.log10(Math.max(1, Math.abs(center)))) + 1)
  const decimals = Math.max(0, Math.ceil(Math.log10(scale / 40)))
  const ideal = Math.max(40, (integerDigits + decimals + 2) * 7) / scale
  const power = 10 ** Math.floor(Math.log10(ideal))
  const fraction = ideal / power
  return (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10) * power
}
export function ticks(min: number, max: number, step: number): number[] {
  if (![min, max, step].every(Number.isFinite) || step <= 0) return []
  const first = Math.ceil(min / step)
  const count = Math.min(200, Math.floor(max / step) - first + 1)
  const decimals = Math.max(0, Math.min(16, Math.ceil(-Math.log10(step))))
  return Array.from({ length: Math.max(0, count) }, (_, i) =>
    Number(((first + i) * step).toFixed(decimals)),
  )
}
export function formatTick(value: number, step: number): string {
  const decimals = Math.max(0, Math.min(16, Math.ceil(-Math.log10(step))))
  return String(Number(value.toFixed(decimals)))
}
export function viewBounds(
  view: Viewport,
  size: CanvasSize = exportSize,
): { min: ComplexPoint; max: ComplexPoint } {
  return {
    min: {
      re: view.centerRe - size.width / 2 / view.scaleX,
      im: view.centerIm - size.height / 2 / view.scaleY,
    },
    max: {
      re: view.centerRe + size.width / 2 / view.scaleX,
      im: view.centerIm + size.height / 2 / view.scaleY,
    },
  }
}
