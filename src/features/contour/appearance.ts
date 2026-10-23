export type SelectionItem =
  | { kind: 'vertex' | 'segment' | 'marker' | 'formula'; id: string; part?: 'label' }
  | { kind: 'contour' }
export type Selection =
  SelectionItem | { kind: 'multiple'; items: SelectionItem[] } | { kind: 'none' }
export const LABEL_OFFSET_LIMIT = 2000
export interface LabelSettings {
  tex: string
  dx: number
  dy: number
  size: number
  color: string
  visible: boolean
}
export type ArrowShape = 'latex' | 'triangle' | 'open'
export interface StrokeStyle {
  color: string
  width: number
  dash: 'solid' | 'dashed' | 'dotted'
  arrows: boolean
  arrowShape: ArrowShape
  arrowSize: number
}
export interface FillStyle {
  mode: 'none' | 'solid' | 'hatch'
  color: string
  opacity: number
  angle: number
  spacing: number
}
export interface PointStyle {
  color: string
  radius: number
}
export const defaultLabel = (tex = ''): LabelSettings => ({
  tex,
  dx: 12,
  dy: -24,
  size: 16,
  color: '#202a30',
  visible: true,
})
export const defaultStroke = (): StrokeStyle => ({
  color: '#263238',
  width: 2,
  dash: 'solid',
  arrows: true,
  arrowShape: 'triangle',
  arrowSize: 10,
})
export const defaultFill = (): FillStyle => ({
  mode: 'solid',
  color: '#66777c',
  opacity: 0.18,
  angle: 45,
  spacing: 10,
})
export const defaultPointStyle = (): PointStyle => ({ color: '#263238', radius: 4 })
export const validColor = (color: string): boolean => /^#[\da-f]{6}$/i.test(color)
export const inRange = (value: number, min: number, max: number): boolean =>
  Number.isFinite(value) && value >= min && value <= max
export const validStroke = (style: StrokeStyle): boolean =>
  validColor(style.color) &&
  inRange(style.width, 0.5, 8) &&
  ['solid', 'dashed', 'dotted'].includes(style.dash) &&
  typeof style.arrows === 'boolean' &&
  ['latex', 'triangle', 'open'].includes(style.arrowShape) &&
  inRange(style.arrowSize, 6, 20)
export const validFill = (style: FillStyle): boolean =>
  validColor(style.color) &&
  ['none', 'solid', 'hatch'].includes(style.mode) &&
  inRange(style.opacity, 0, 1) &&
  inRange(style.angle, -180, 180) &&
  inRange(style.spacing, 4, 30)
export const dashArray = (style: StrokeStyle): string | undefined =>
  style.dash === 'dashed'
    ? `${style.width * 4} ${style.width * 3}`
    : style.dash === 'dotted'
      ? `0 ${style.width * 3}`
      : undefined
