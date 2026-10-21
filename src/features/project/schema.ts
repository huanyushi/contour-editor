import { isValidPoint, type ComplexPoint } from '../../lib/geometry'
import { renderMath } from '../../lib/math'
import {
  defaultStroke,
  LABEL_OFFSET_LIMIT,
  inRange,
  validColor,
  validStroke,
  type LabelSettings,
  type PointStyle,
  type StrokeStyle,
} from '../contour/appearance'

export function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${path} 必须是对象。`)
  return value as Record<string, unknown>
}
export function list(value: unknown, path: string, min: number, max: number): unknown[] {
  if (!Array.isArray(value) || value.length < min || value.length > max)
    throw new Error(`${path} 数量须在 ${min}–${max} 之间。`)
  return value
}
export function numeric(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new Error(`${path} 必须是有限数值。`)
  return value
}
export function bool(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${path} 必须是布尔值。`)
  return value
}
export function string(value: unknown, path: string, max = 2000): string {
  if (typeof value !== 'string' || value.length > max)
    throw new Error(`${path} 必须是长度不超过 ${max} 的文字。`)
  return value
}
export function stableId(value: unknown, path: string): string {
  const id = string(value, `${path} ID`, 80)
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error(`${path} ID 格式无效。`)
  return id
}
export function point(value: unknown, path: string): ComplexPoint {
  const item = record(value, path)
  const p = { re: numeric(item.re, `${path}.re`), im: numeric(item.im, `${path}.im`) }
  if (!isValidPoint(p)) throw new Error(`${path} 超出有限绘图坐标范围。`)
  return p
}
export function color(value: unknown, path: string): string {
  const result = string(value, path, 7)
  if (!validColor(result)) throw new Error(`${path} 需要 #RRGGBB 颜色。`)
  return result
}
export function label(value: unknown, path: string): LabelSettings {
  const item = record(value, path)
  const result: LabelSettings = {
    tex: string(item.tex, `${path}.tex`),
    dx: numeric(item.dx, `${path}.dx`),
    dy: numeric(item.dy, `${path}.dy`),
    size: numeric(item.size, `${path}.size`),
    color: color(item.color, `${path}.color`),
    visible: bool(item.visible, `${path}.visible`),
  }
  if (
    !inRange(result.dx, -LABEL_OFFSET_LIMIT, LABEL_OFFSET_LIMIT) ||
    !inRange(result.dy, -LABEL_OFFSET_LIMIT, LABEL_OFFSET_LIMIT) ||
    !inRange(result.size, 10, 40)
  )
    throw new Error(`${path} 标签位置或字号超出范围。`)
  const rendering = renderMath(result.tex)
  if (rendering.error) throw new Error(`${path}：${rendering.error}`)
  return result
}
export function pointStyle(value: unknown, path: string): PointStyle {
  const item = record(value, path)
  const result = {
    color: color(item.color, `${path}.color`),
    radius: numeric(item.radius, `${path}.radius`),
  }
  if (!inRange(result.radius, 2, 10)) throw new Error(`${path} 点半径须在 2–10 之间。`)
  return result
}
export function stroke(value: unknown, path: string, partial = false): Partial<StrokeStyle> {
  const item = record(value, path)
  const result: Partial<StrokeStyle> = {}
  if (!partial || item.color !== undefined) result.color = color(item.color, `${path}.color`)
  if (!partial || item.width !== undefined) result.width = numeric(item.width, `${path}.width`)
  if (!partial || item.arrows !== undefined) result.arrows = bool(item.arrows, `${path}.arrows`)
  if (!partial || item.dash !== undefined) {
    if (item.dash !== 'solid' && item.dash !== 'dashed' && item.dash !== 'dotted')
      throw new Error(`${path} 线型无效。`)
    result.dash = item.dash
  }
  if (!validStroke({ ...defaultStroke(), ...result })) throw new Error(`${path} 线条样式超出范围。`)
  return result
}
