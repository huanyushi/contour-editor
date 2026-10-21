import { arcThrough } from '../../lib/arc'
import { renderMath } from '../../lib/math'
import {
  defaultAxes,
  defaultViewport,
  validAxes,
  validViewport,
  type Viewport,
  type AxesSettings,
} from '../../lib/viewport'
import type { ContourState, PathSegment, Vertex } from '../contour/model'
import { isSingleCycle, validTopology } from '../contour/pathTopology'
import { defaultStroke, validFill, type FillStyle } from '../contour/appearance'
import type { MarkerObject, SceneObject } from '../contour/workspace'
import { mathematicalKind, readAvoidances } from './avoidanceSchema'
import {
  bool,
  color,
  label,
  list,
  numeric,
  point,
  pointStyle,
  record,
  stableId,
  string,
  stroke,
} from './schema'
import { projectSceneError } from './validation'
import {
  MAX_PROJECT_BYTES,
  MAX_VERTICES,
  MAX_MARKERS,
  MAX_FORMULAS,
  MAX_CONNECTIONS,
  MAX_AVOIDANCES,
} from './format'
export { MAX_PROJECT_BYTES, serializeProject, type ProjectFile } from './format'

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
  if (root.version !== 1 && root.version !== 2 && root.version !== 3)
    throw new Error('不支持此项目文件版本，请使用版本 1、2 或 3。')
  const doc = record(root.document, '文档')
  const ids = new Set<string>()
  const readId = (value: unknown, path: string) => {
    const id = stableId(value, path)
    if (ids.has(id)) throw new Error(`${path} ID 重复：${id}`)
    ids.add(id)
    return id
  }
  const vertices = list(doc.vertices, '顶点', 0, MAX_VERTICES).map((value, index): Vertex => {
    const path = `顶点 ${index + 1}`
    const item = record(value, path)
    return {
      id: readId(item.id, path),
      ...point(item, path),
      ...(item.mathematicalKind === undefined
        ? {}
        : { mathematicalKind: mathematicalKind(item.mathematicalKind, path) }),
      ...(item.label === undefined ? {} : { label: label(item.label, `${path}标签`) }),
      ...(item.pointStyle === undefined
        ? {}
        : { pointStyle: pointStyle(item.pointStyle, `${path}样式`) }),
    }
  })
  const endpoints = new Map(vertices.map((vertex) => [vertex.id, vertex]))
  const readSegment = (value: unknown, path: string): PathSegment => {
    const item = record(value, path)
    const common = {
      id: readId(item.id, path),
      startId: string(item.startId, `${path}起点`, 80),
      endId: string(item.endId, `${path}终点`, 80),
      ...(item.label === undefined ? {} : { label: label(item.label, `${path}标签`) }),
      ...(item.style === undefined ? {} : { style: stroke(item.style, `${path}样式`, true) }),
    }
    const start = endpoints.get(common.startId),
      end = endpoints.get(common.endId)
    if (!start || !end || start.id === end.id) throw new Error(`${path} 的端点连接无效。`)
    if (item.kind === 'line') return { ...common, kind: 'line' }
    if (item.kind !== 'arc') throw new Error(`${path} 类型只能为 line 或 arc。`)
    const through = point(item.through, `${path}经过点`)
    const result = arcThrough(start, end, through)
    if (!result.ok) throw new Error(`${path}：${result.error}`)
    return { ...common, kind: 'arc', through }
  }
  const segments = list(doc.segments, '路径段', 0, vertices.length).map((value, index) =>
    readSegment(value, `路径段 ${index + 1}`),
  )
  if (!validTopology(vertices, segments)) throw new Error('路径段连接重复、存在分叉或局部环路。')
  const sceneObjects = (
    value: unknown,
    name: string,
    max: number,
    marker = false,
  ): MarkerObject[] =>
    list(value, name, 0, max).map((entry, index) => {
      const path = `${name} ${index + 1}`
      const item = record(entry, path)
      return {
        id: readId(item.id, path),
        ...point(item, path),
        label: label(item.label, `${path}标签`),
        pointStyle: pointStyle(item.pointStyle, `${path}点样式`),
        ...(marker && item.mathematicalKind !== undefined
          ? { mathematicalKind: mathematicalKind(item.mathematicalKind, path) }
          : {}),
      }
    })
  const markers = sceneObjects(doc.markers, '独立点', MAX_MARKERS, true)
  const formulas: SceneObject[] = sceneObjects(doc.formulas, '公式', MAX_FORMULAS)
  markers.forEach((marker) => endpoints.set(marker.id, marker))
  const rawConnections =
    doc.connections === undefined ? [] : list(doc.connections, '独立路径段', 0, MAX_CONNECTIONS)
  if (root.version === 1 && rawConnections.length) throw new Error('独立路径段需要项目文件版本 2。')
  const lines = new Set(
    segments.filter((s) => s.kind === 'line').map((s) => [s.startId, s.endId].sort().join(':')),
  )
  const connections = rawConnections.map((value, index) => {
    const path = `独立路径段 ${index + 1}`
    const segment = readSegment(value, path)
    const start = endpoints.get(segment.startId)!,
      end = endpoints.get(segment.endId)!
    if (start.re === end.re && start.im === end.im) throw new Error(`${path} 的端点位置不能相同。`)
    if (segment.kind === 'line') {
      const pair = [segment.startId, segment.endId].sort().join(':')
      if (lines.has(pair)) throw new Error(`${path} 的直线段连接重复。`)
      lines.add(pair)
    }
    return segment
  })
  const avoidances = readAvoidances(doc.avoidances, readId, MAX_AVOIDANCES)
  if (
    root.version !== 3 &&
    (avoidances.length ||
      [...vertices, ...markers].some((m) => (m.mathematicalKind ?? 'ordinary') !== 'ordinary'))
  )
    throw new Error('数学类型与绕行声明需要项目文件版本 3。')
  const appearance = record(doc.appearance, '整体样式')
  const view = record(doc.view, '视图')
  const closed = bool(doc.closed, '闭合状态')
  if (
    closed &&
    (!isSingleCycle({ vertices, segments }) ||
      (vertices.length < 3 && !segments.some((s) => s.kind === 'arc')))
  )
    throw new Error('闭合围道须为连续环路，两端点闭合需要至少一条有效圆弧。')
  const result: ContourState = {
    vertices,
    segments,
    connections,
    avoidances,
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
    selectedId: vertices[0]?.id ?? '',
    selectedSegmentId: segments[0]?.id ?? '',
    selection: { kind: 'contour' },
    selectionSource: 'click',
    error: '',
  }
  const error = projectSceneError(result)
  if (error) throw new Error(error)
  return result
}
