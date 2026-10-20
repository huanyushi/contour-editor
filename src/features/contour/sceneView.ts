import { arcThrough, pointOnArc } from '../../lib/arc'
import { fromSvg, toSvg, type ComplexPoint } from '../../lib/geometry'
import {
  exportSize,
  MAX_SCALE,
  MIN_SCALE,
  validViewport,
  type CanvasSize,
  type Viewport,
} from '../../lib/viewport'
import { renderMath } from '../../lib/math'
import { defaultLabel, type LabelSettings } from './appearance'
import type { ContourState } from './model'

export function canProjectScene(state: ContourState, view: Viewport): boolean {
  if (!validViewport(view)) return false
  const points: ComplexPoint[] = [...state.vertices, ...state.markers, ...state.formulas]
  const vertices = new Map(state.vertices.map((point) => [point.id, point]))
  for (const segment of state.segments) {
    if (segment.kind !== 'arc') continue
    const result = arcThrough(
      vertices.get(segment.startId)!,
      vertices.get(segment.endId)!,
      segment.through,
    )
    if (!result.ok || !Number.isFinite(result.arc.radius * Math.max(view.scaleX, view.scaleY)))
      return false
    points.push(segment.through, pointOnArc(result.arc, 0.5))
  }
  return points.every((point) => {
    const p = toSvg(point, view)
    return Number.isFinite(p.x) && Number.isFinite(p.y)
  })
}

export function fitScene(state: ContourState, size: CanvasSize = exportSize): Viewport | null {
  const points: ComplexPoint[] = [...state.vertices, ...state.markers, ...state.formulas]
  const labels: { point: ComplexPoint; label: LabelSettings; width: number; height: number }[] = []
  const addLabel = (point: ComplexPoint, label: LabelSettings) => {
    if (!label.visible || !label.tex.trim()) return
    const math = renderMath(label.tex)
    labels.push({
      point,
      label,
      width: (math.width * label.size) / 16,
      height: (math.height * label.size) / 16,
    })
  }
  state.vertices.forEach((point, index) =>
    addLabel(point, point.label ?? defaultLabel(`z_{${index + 1}}`)),
  )
  ;[...state.markers, ...state.formulas].forEach((point) => addLabel(point, point.label))
  const vertices = new Map(state.vertices.map((point) => [point.id, point]))
  for (const segment of state.closed ? state.segments : state.segments.slice(0, -1)) {
    const start = vertices.get(segment.startId)!
    const end = vertices.get(segment.endId)!
    let middle = { re: start.re / 2 + end.re / 2, im: start.im / 2 + end.im / 2 }
    if (segment.kind === 'arc') {
      const result = arcThrough(start, end, segment.through)
      if (!result.ok) return null
      const arc = result.arc
      middle = pointOnArc(arc, 0.5)
      const tau = 2 * Math.PI
      for (const angle of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
        const distance =
          (((arc.sweep > 0 ? angle - arc.startAngle : arc.startAngle - angle) % tau) + tau) % tau
        if (distance <= Math.abs(arc.sweep) + 1e-10)
          points.push({
            re: arc.center.re + arc.radius * Math.cos(angle),
            im: arc.center.im + arc.radius * Math.sin(angle),
          })
      }
    }
    if (segment.label) addLabel(middle, segment.label)
  }
  const minRe = Math.min(...points.map((p) => p.re)),
    maxRe = Math.max(...points.map((p) => p.re))
  const minIm = Math.min(...points.map((p) => p.im)),
    maxIm = Math.max(...points.map((p) => p.im))
  const ratio = state.viewport.scaleY / state.viewport.scaleX
  const scaleX = Math.min(
    Math.max(1, size.width - 80) / Math.max(1, maxRe - minRe),
    Math.max(1, size.height - 80) / (Math.max(1, maxIm - minIm) * ratio),
    MAX_SCALE,
    MAX_SCALE / ratio,
  )
  let view: Viewport = {
    ...state.viewport,
    centerRe: minRe / 2 + maxRe / 2,
    centerIm: minIm / 2 + maxIm / 2,
    scaleX,
    scaleY: scaleX * ratio,
  }
  if (
    scaleX < MIN_SCALE ||
    !canProjectScene(state, view) ||
    labels.some((item) => item.width > size.width - 40 || item.height > size.height - 40)
  )
    return null
  for (let iteration = 0; iteration < 16; iteration++) {
    const projected = points.map((point) => toSvg(point, view))
    for (const item of labels) {
      const anchor = toSvg(item.point, view)
      projected.push(
        { x: anchor.x + item.label.dx, y: anchor.y + item.label.dy },
        { x: anchor.x + item.label.dx + item.width, y: anchor.y + item.label.dy + item.height },
      )
    }
    const left = Math.min(...projected.map((p) => p.x)),
      right = Math.max(...projected.map((p) => p.x))
    const top = Math.min(...projected.map((p) => p.y)),
      bottom = Math.max(...projected.map((p) => p.y))
    const center = fromSvg({ x: (left + right) / 2, y: (top + bottom) / 2 }, view)
    const factor = Math.min(
      1,
      Math.max(1, size.width - 60) / Math.max(1, right - left),
      Math.max(1, size.height - 60) / Math.max(1, bottom - top),
    )
    view = {
      ...view,
      centerRe: center.re,
      centerIm: center.im,
      scaleX: view.scaleX * factor,
      scaleY: view.scaleY * factor,
    }
    if (!canProjectScene(state, view)) return null
    if (factor > 0.999) return view
  }
  return null
}
