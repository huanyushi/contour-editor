import { arcExtrema, pointOnArc } from '../../lib/arc'
import { fromSvg, toSvg, type SvgPoint } from '../../lib/geometry'
import { renderMath } from '../../lib/math'
import {
  canvasBounds,
  exportSize,
  formatTick,
  gridStep,
  MIN_SCALE,
  ticks,
  validViewport,
  viewBounds,
  type CanvasSize,
} from '../../lib/viewport'
import { defaultLabel, defaultPointStyle, type LabelSettings } from '../contour/appearance'
import type { ContourState } from '../contour/model'
import { buildContourGeometry } from '../contour/pathGeometry'
import { findPoint } from '../contour/sceneObjects'
import type { ExportOptions } from './export'

const MAX_BASE_SIDE = 2400
const layoutError = () =>
  new Error('无法在安全尺寸内完整导出图形，请缩短标签、减小标签偏移或调整图形范围。')

interface Bounds {
  left: number
  top: number
  right: number
  bottom: number
}

function union(bounds: Bounds[]): Bounds | null {
  if (!bounds.length) return null
  if (bounds.some((b) => !Object.values(b).every(Number.isFinite)))
    throw new Error('导出图形的坐标和尺寸必须为有限数值。')
  return bounds.reduce((a, b) => ({
    left: Math.min(a.left, b.left),
    right: Math.max(a.right, b.right),
    top: Math.min(a.top, b.top),
    bottom: Math.max(a.bottom, b.bottom),
  }))
}

function pointBounds(point: SvgPoint, radius: number): Bounds {
  return {
    left: point.x - radius,
    right: point.x + radius,
    top: point.y - radius,
    bottom: point.y + radius,
  }
}

function mathSize(tex: string, size: number): CanvasSize {
  const math = renderMath(tex)
  if (math.error) throw new Error(math.error)
  const width = (math.width * size) / 16
  const height = (math.height * size) / 16
  if (![width, height].every(Number.isFinite) || width < 0 || height < 0) throw layoutError()
  return { width, height }
}

/** Export-only bounds: no hit targets, selection rings, or through-point controls. */
function contentBounds(state: ContourState, options: ExportOptions): Bounds | null {
  const bounds: Bounds[] = []
  const addLabel = (point: SvgPoint, label: LabelSettings) => {
    if (!label.visible || !label.tex.trim()) return
    const { width, height } = mathSize(label.tex, label.size)
    bounds.push({
      left: point.x + label.dx,
      top: point.y + label.dy,
      right: point.x + label.dx + width,
      bottom: point.y + label.dy + height,
    })
  }
  for (const { segment, arc, arrow } of buildContourGeometry(state).segments) {
    const start = toSvg(findPoint(state, segment.startId)!, state.viewport)
    const end = toSvg(findPoint(state, segment.endId)!, state.viewport)
    const style = { ...state.appearance.stroke, ...segment.style }
    const points = arc ? arcExtrema(arc).map((p) => toSvg(p, state.viewport)) : [start, end]
    bounds.push(...points.map((point) => pointBounds(point, style.width / 2)))
    // The 12px direction line plus its user-space marker can extend past a
    // short segment's geometry. This envelope also covers diagonal arrows.
    if (arrow && style.arrows) bounds.push(pointBounds(arrow.point, 15 + style.width / 2))
    if (segment.label) {
      const middle = arc
        ? toSvg(pointOnArc(arc, 0.5), state.viewport)
        : { x: start.x / 2 + end.x / 2, y: start.y / 2 + end.y / 2 }
      addLabel(middle, segment.label)
    }
  }
  state.vertices.forEach((vertex, index) => {
    const point = toSvg(vertex, state.viewport)
    if (options.endpoints)
      bounds.push(pointBounds(point, (vertex.pointStyle ?? defaultPointStyle()).radius + 0.5))
    addLabel(point, vertex.label ?? defaultLabel(`z_{${index + 1}}`))
  })
  for (const marker of state.markers) {
    const point = toSvg(marker, state.viewport)
    bounds.push(pointBounds(point, marker.pointStyle.radius))
    addLabel(point, marker.label)
  }
  for (const formula of state.formulas) addLabel(toSvg(formula, state.viewport), formula.label)
  return union(bounds)
}

/** Axes are viewport decorations, not infinite content. Keep their math names
 * inside the independent canvas, including unusually wide/tall custom names. */
function axesSize(state: ContourState, initial: CanvasSize): CanvasSize {
  const re = mathSize(state.axes.reLabel, 20)
  const im = mathSize(state.axes.imLabel, 20)
  let size = { width: Math.max(initial.width, 112), height: Math.max(initial.height, 112) }
  const view = state.viewport
  const origin = toSvg({ re: 0, im: 0 }, view)
  const stepX = gridStep(view.scaleX, view.centerRe)
  const stepY = gridStep(view.scaleY, view.centerIm)
  for (let i = 0; i < 32; i++) {
    if (Math.max(size.width, size.height) > MAX_BASE_SIDE) throw layoutError()
    const { left, top, right, bottom } = canvasBounds(size)
    const showX = origin.y >= top && origin.y <= bottom
    const showY = origin.x >= left && origin.x <= right
    const minWidth = Math.ceil(Math.max(showX ? re.width + 44 : 0, showY ? im.width + 44 : 0))
    const minHeight = Math.ceil(showY ? im.height + 48 : 0)
    if (size.width < minWidth || size.height < minHeight) {
      size = { width: Math.max(size.width, minWidth), height: Math.max(size.height, minHeight) }
      continue
    }
    const text: Bounds[] = []
    const addText = (x: number, y: number, width: number, height: number) => {
      text.push({ left: x, top: y, right: x + width, bottom: y + height })
    }
    // Placement matches AxesLayer; extending the canvas can introduce a new
    // edge tick, so remeasure until every visible decoration is contained.
    if (showX)
      addText(
        Math.max(left + 20, right - re.width - 20),
        origin.y > top + 40 ? origin.y - 26 : origin.y + 12,
        re.width,
        re.height,
      )
    if (showY)
      addText(
        Math.max(
          left + 20,
          origin.x + 14 + im.width > right - 20 ? origin.x - im.width - 14 : origin.x + 14,
        ),
        top + 22,
        im.width,
        im.height,
      )
    if (state.axes.ticks) {
      const visible = viewBounds(view, size)
      if (showX) {
        for (const n of ticks(visible.min.re, visible.max.re, stepX)) {
          const x = toSvg({ re: n, im: 0 }, view).x
          if (n === 0 || x <= left + 24 || x >= right - 30) continue
          // Conservative Georgia 11px digit metrics, without requiring a DOM.
          const width = formatTick(n, stepX).length * 7
          const baseline = origin.y > bottom - 30 ? origin.y - 10 : origin.y + 18
          addText(x - width / 2, baseline - 11, width, 14)
        }
      }
      if (showY) {
        for (const n of ticks(visible.min.im, visible.max.im, stepY)) {
          const y = toSvg({ re: 0, im: n }, view).y
          if (n === 0 || y <= top + 35 || y >= bottom - 24) continue
          const width = formatTick(n, stepY).length * 7
          addText(origin.x < left + 35 ? origin.x + 9 : origin.x - 9 - width, y - 7, width, 14)
        }
      }
      if (showX && showY) addText(origin.x - 12, origin.y + 7, 7, 14)
    }
    const bounds = union(text)
    if (!bounds) return size
    const dx = Math.max(0, left - bounds.left + 2, bounds.right - right + 2)
    const dy = Math.max(0, top - bounds.top + 2, bounds.bottom - bottom + 2)
    if (!dx && !dy) return size
    size = { width: Math.ceil(size.width + dx * 2), height: Math.ceil(size.height + dy * 2) }
  }
  throw layoutError()
}

export interface ExportLayout {
  state: ContourState
  size: CanvasSize
}

/** Preserve current scales and axis ratio in an export snapshot. Large geometry
 * is shrunk and remeasured without scaling fixed-pixel text or label offsets. */
export function computeExportLayout(state: ContourState, options: ExportOptions): ExportLayout {
  let scene: ContourState = {
    ...state,
    viewport: { ...state.viewport },
    axes: { ...state.axes, visible: options.axes },
    selection: { kind: 'none' },
    handles: false,
  }
  if (options.region === 'view') return { state: scene, size: { ...exportSize } }
  if (!validViewport(scene.viewport)) throw layoutError()
  const padding = options.axes ? 56 : 24
  const dimensions = (bounds: Bounds): CanvasSize => ({
    // One extra pixel on either side absorbs fractional rounding of glyphs.
    width: Math.ceil(bounds.right - bounds.left + 2 * padding + 2),
    height: Math.ceil(bounds.bottom - bounds.top + 2 * padding + 2),
  })
  let bounds = contentBounds(scene, options)
  if (!bounds)
    return { state: scene, size: options.axes ? axesSize(scene, exportSize) : { ...exportSize } }
  for (let iteration = 0; iteration < 64; iteration++) {
    bounds = contentBounds(scene, options)!
    let size = dimensions(bounds)
    if (Math.max(size.width, size.height) <= MAX_BASE_SIDE) {
      const center = fromSvg(
        { x: bounds.left / 2 + bounds.right / 2, y: bounds.top / 2 + bounds.bottom / 2 },
        scene.viewport,
      )
      scene = {
        ...scene,
        viewport: { ...scene.viewport, centerRe: center.re, centerIm: center.im },
      }
      if (!validViewport(scene.viewport)) throw layoutError()
      if (options.axes) size = axesSize(scene, size)
      if (Math.max(size.width, size.height) > MAX_BASE_SIDE) throw layoutError()
      return { state: scene, size }
    }
    const factor = Math.max(
      Math.min(
        (MAX_BASE_SIDE - 2 * padding - 4) / (bounds.right - bounds.left),
        (MAX_BASE_SIDE - 2 * padding - 4) / (bounds.bottom - bounds.top),
        0.8,
      ),
      MIN_SCALE / scene.viewport.scaleX,
      MIN_SCALE / scene.viewport.scaleY,
    )
    if (factor >= 1) throw layoutError()
    scene = {
      ...scene,
      viewport: {
        ...scene.viewport,
        scaleX: scene.viewport.scaleX * factor,
        scaleY: scene.viewport.scaleY * factor,
      },
    }
    if (!validViewport(scene.viewport)) throw layoutError()
  }
  throw layoutError()
}
