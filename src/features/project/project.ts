import { arcThrough } from '../../lib/arc'
import { isValidPoint, type ComplexPoint } from '../../lib/geometry'
import { renderMath } from '../../lib/math'
import {
  defaultAxes,
  defaultViewport,
  validAxes,
  validViewport,
  type Viewport,
  type AxesSettings,
} from '../../lib/viewport'
import { canProjectScene } from '../contour/sceneView'
import { canClose, type ContourState, type PathSegment, type Vertex } from '../contour/model'
import {
  defaultStroke,
  LABEL_OFFSET_LIMIT,
  inRange,
  validColor,
  validFill,
  validStroke,
  type FillStyle,
  type LabelSettings,
  type PointStyle,
  type StrokeStyle,
} from '../contour/appearance'
import type { SceneObject } from '../contour/workspace'
import {
  MAX_PROJECT_BYTES,
  MAX_VERTICES,
  MAX_MARKERS,
  MAX_FORMULAS,
  projectCapacityError,
} from './format'
export { MAX_PROJECT_BYTES, serializeProject, type ProjectFile } from './format'

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${path} 必须是对象。`)
  return value as Record<string, unknown>
}
function list(value: unknown, path: string, min: number, max: number): unknown[] {
  if (!Array.isArray(value) || value.length < min || value.length > max)
    throw new Error(`${path} 数量须在 ${min}–${max} 之间。`)
  return value
}
function numeric(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new Error(`${path} 必须是有限数值。`)
  return value
}
function bool(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${path} 必须是布尔值。`)
  return value
}
function string(value: unknown, path: string, max = 2000): string {
  if (typeof value !== 'string' || value.length > max)
    throw new Error(`${path} 必须是长度不超过 ${max} 的文字。`)
  return value
}
function point(value: unknown, path: string): ComplexPoint {
  const item = record(value, path)
  const p = { re: numeric(item.re, `${path}.re`), im: numeric(item.im, `${path}.im`) }
  if (!isValidPoint(p)) throw new Error(`${path} 超出有限绘图坐标范围。`)
  return p
}
function color(value: unknown, path: string): string {
  const result = string(value, path, 7)
  if (!validColor(result)) throw new Error(`${path} 需要 #RRGGBB 颜色。`)
  return result
}
function label(value: unknown, path: string): LabelSettings {
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
function pointStyle(value: unknown, path: string): PointStyle {
  const item = record(value, path)
  const result = {
    color: color(item.color, `${path}.color`),
    radius: numeric(item.radius, `${path}.radius`),
  }
  if (!inRange(result.radius, 2, 10)) throw new Error(`${path} 点半径须在 2–10 之间。`)
  return result
}
function stroke(value: unknown, path: string, partial = false): Partial<StrokeStyle> {
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
function fill(value: unknown): FillStyle {
  const item = record(value, '填充')
  if (item.mode !== 'none' && item.mode !== 'solid' && item.mode !== 'hatch')
    throw new Error('填充形式无效。')
  const result: FillStyle = {
    mode: item.mode,
    color: color(item.color, '填充颜色'),
    opacity: numeric(item.opacity, '填充不透明度'),
    angle: numeric(item.angle, '填充角度'),
    spacing: numeric(item.spacing, '填充间距'),
  }
  if (!validFill(result)) throw new Error('填充属性超出范围。')
  return result
}

function viewport(value: unknown): Viewport {
  if (value === undefined) return defaultViewport()
  const item = record(value, '视图比例')
  const view = {
    centerRe: numeric(item.centerRe, '视图中心实部'),
    centerIm: numeric(item.centerIm, '视图中心虚部'),
    scaleX: numeric(item.scaleX, '横轴比例'),
    scaleY: numeric(item.scaleY, '纵轴比例'),
    locked: bool(item.locked, '比例锁定'),
  }
  if (!validViewport(view)) throw new Error('视图范围或比例无效。')
  return view
}
function axes(value: unknown): AxesSettings {
  if (value === undefined) return defaultAxes()
  const item = record(value, '坐标轴')
  const arrow = item.arrow
  if (arrow !== 'latex' && arrow !== 'triangle' && arrow !== 'open' && arrow !== 'none')
    throw new Error('坐标轴箭头类型无效。')
  const result: AxesSettings = {
    reLabel: item.reLabel === undefined ? defaultAxes().reLabel : string(item.reLabel, '实轴标签'),
    imLabel: item.imLabel === undefined ? defaultAxes().imLabel : string(item.imLabel, '虚轴标签'),
    visible: bool(item.visible, '坐标轴显示'),
    ticks: bool(item.ticks, '刻度数字'),
    color: color(item.color, '坐标轴颜色'),
    width: numeric(item.width, '坐标轴线宽'),
    arrow,
    arrowSize: numeric(item.arrowSize, '坐标轴箭头大小'),
  }
  if (!validAxes(result)) throw new Error('坐标轴样式无效。')
  for (const tex of [result.reLabel, result.imLabel]) {
    const rendering = renderMath(tex)
    if (rendering.error) throw new Error(`坐标轴标签：${rendering.error}`)
  }
  return result
}

/** Parse into fresh validated objects; never trust JSON as a domain-state cast. */
export function parseProject(text: string): ContourState {
  if (new TextEncoder().encode(text).byteLength > MAX_PROJECT_BYTES)
    throw new Error('项目文件不能超过 2 MB。')
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('项目文件不是有效的 JSON。')
  }
  const root = record(parsed, '项目文件')
  if (root.format !== 'complex-contour-editor')
    throw new Error('这不是 Complex Contour Editor 项目文件。')
  if (root.version !== 1) throw new Error('不支持此项目文件版本，请使用版本 1。')
  const doc = record(root.document, '文档')
  const ids = new Set<string>()
  const readId = (value: unknown, path: string) => {
    const id = string(value, `${path} ID`, 80)
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error(`${path} ID 格式无效。`)
    if (ids.has(id)) throw new Error(`${path} ID 重复：${id}`)
    ids.add(id)
    return id
  }
  const vertices = list(doc.vertices, '顶点', 2, MAX_VERTICES).map((value, index): Vertex => {
    const path = `顶点 ${index + 1}`
    const item = record(value, path)
    return {
      id: readId(item.id, path),
      ...point(item, path),
      ...(item.label === undefined ? {} : { label: label(item.label, `${path}标签`) }),
      ...(item.pointStyle === undefined
        ? {}
        : { pointStyle: pointStyle(item.pointStyle, `${path}样式`) }),
    }
  })
  const segments = list(doc.segments, '路径段', vertices.length, vertices.length).map(
    (value, index): PathSegment => {
      const path = `路径段 ${index + 1}`
      const item = record(value, path)
      const common = {
        id: readId(item.id, path),
        startId: string(item.startId, `${path}起点`, 80),
        endId: string(item.endId, `${path}终点`, 80),
        ...(item.label === undefined ? {} : { label: label(item.label, `${path}标签`) }),
        ...(item.style === undefined ? {} : { style: stroke(item.style, `${path}样式`, true) }),
      }
      if (
        common.startId !== vertices[index].id ||
        common.endId !== vertices[(index + 1) % vertices.length].id
      )
        throw new Error(`${path} 的端点连接与顶点顺序不一致。`)
      if (item.kind === 'line') return { ...common, kind: 'line' }
      if (item.kind !== 'arc') throw new Error(`${path} 类型只能为 line 或 arc。`)
      const through = point(item.through, `${path}经过点`)
      const result = arcThrough(vertices[index], vertices[(index + 1) % vertices.length], through)
      if (!result.ok) throw new Error(`${path}：${result.error}`)
      return { ...common, kind: 'arc', through }
    },
  )
  const sceneObjects = (value: unknown, name: string, max: number): SceneObject[] =>
    list(value, name, 0, max).map((entry, index) => {
      const path = `${name} ${index + 1}`
      const item = record(entry, path)
      return {
        id: readId(item.id, path),
        ...point(item, path),
        label: label(item.label, `${path}标签`),
        pointStyle: pointStyle(item.pointStyle, `${path}点样式`),
      }
    })
  const markers = sceneObjects(doc.markers, '独立点', MAX_MARKERS)
  const formulas = sceneObjects(doc.formulas, '公式', MAX_FORMULAS)
  const appearance = record(doc.appearance, '整体样式')
  const view = record(doc.view, '视图')
  const closed = bool(doc.closed, '闭合状态')
  if (closed && !canClose({ vertices, segments }))
    throw new Error('两端点闭合围道需要至少一条有效圆弧。')
  const result: ContourState = {
    vertices,
    segments,
    markers,
    formulas,
    closed,
    appearance: {
      stroke: { ...defaultStroke(), ...stroke(appearance.stroke, '默认线条') },
      fill: fill(appearance.fill),
    },
    snap: bool(view.snap, '吸附'),
    grid: bool(view.grid, '网格'),
    handles: bool(view.handles, '手柄'),
    viewport: viewport(view.viewport),
    axes: axes(view.axes),
    selectedId: vertices[0].id,
    selectedSegmentId: segments[0].id,
    selection: { kind: 'contour' },
    error: '',
  }
  const capacity = projectCapacityError(result)
  if (capacity) throw new Error(capacity)
  if (!canProjectScene(result, result.viewport))
    throw new Error('项目对象无法在所存视图中安全绘制。')
  return result
}
