import { arcExtrema, arcThrough } from '../../../lib/arc'
import { fromSvg, toSvg, type ComplexPoint } from '../../../lib/geometry'
import {
  exportSize,
  MAX_SCALE,
  MIN_SCALE,
  validViewport,
  type CanvasSize,
  type Viewport,
} from '../../../lib/viewport'
import { renderMath } from '../../../lib/math'
import { defaultLabel, type LabelSettings } from '../appearance'
import type { ContourState } from '../model'
import { sceneSegments } from './sceneObjects'
import { resolveScene, type ResolvedScene } from './resolvedScene'

export function canProjectScene(state: ContourState, view: Viewport): boolean {
  if (!validViewport(view)) return false
  const resolution = resolveScene(state)
  if (!resolution.ok) return false
  return canProjectResolvedScene(state, view, resolution.scene)
}

/** The caller must supply the scene constructed from this same candidate state. */
export function canProjectResolvedScene(
  state: ContourState,
  view: Viewport,
  scene: ResolvedScene,
): boolean {
  if (!validViewport(view)) return false
  const points: ComplexPoint[] = [...state.vertices, ...state.markers, ...state.formulas]
  points.push(...scene.points.values())
  for (const segment of [
    ...sceneSegments(state),
    ...scene.contourSegments,
    ...scene.connectionSegments,
  ]) {
    const start = scene.points.get(segment.startId),
      end = scene.points.get(segment.endId)
    if (!start || !end) return false
    if (segment.kind !== 'arc') continue
    const result = arcThrough(start, end, segment.through)
    if (!result.ok || !Number.isFinite(result.arc.radius * Math.max(view.scaleX, view.scaleY)))
      return false
    points.push(segment.through, ...arcExtrema(result.arc))
  }
  points.push(...scene.labels.map((label) => label.anchor))
  return points.every((point) => {
    const p = toSvg(point, view)
    return Number.isFinite(p.x) && Number.isFinite(p.y)
  })
}

export function fitScene(state: ContourState, size: CanvasSize = exportSize): Viewport | null {
  const resolution = resolveScene(state)
  if (!resolution.ok) return null
  const { scene } = resolution
  const padding = Math.min(96, Math.max(56, Math.min(size.width, size.height) * 0.14))
  const availableWidth = Math.max(1, size.width - 2 * padding)
  const availableHeight = Math.max(1, size.height - 2 * padding)
  const points: ComplexPoint[] = [...scene.points.values(), ...state.formulas]
  const labels: { point: ComplexPoint; label: LabelSettings; width: number; height: number }[] = []
  if (!points.length) return state.viewport
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
  for (const segment of [...scene.contourSegments, ...scene.connectionSegments]) {
    const start = scene.points.get(segment.startId)!
    const end = scene.points.get(segment.endId)!
    if (segment.kind === 'arc') {
      const result = arcThrough(start, end, segment.through)
      if (!result.ok) return null
      const arc = result.arc
      points.push(...arcExtrema(arc))
    }
  }
  for (const { anchor, value } of scene.labels) addLabel(anchor, value)
  const minRe = Math.min(...points.map((p) => p.re)),
    maxRe = Math.max(...points.map((p) => p.re))
  const minIm = Math.min(...points.map((p) => p.im)),
    maxIm = Math.max(...points.map((p) => p.im))
  const ratio = state.viewport.scaleY / state.viewport.scaleX
  const scaleX = Math.min(
    availableWidth / Math.max(1, maxRe - minRe),
    availableHeight / (Math.max(1, maxIm - minIm) * ratio),
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
    !canProjectResolvedScene(state, view, scene) ||
    labels.some((item) => item.width > availableWidth || item.height > availableHeight)
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
      availableWidth / Math.max(1, right - left),
      availableHeight / Math.max(1, bottom - top),
    )
    view = {
      ...view,
      centerRe: center.re,
      centerIm: center.im,
      scaleX: view.scaleX * factor,
      scaleY: view.scaleY * factor,
    }
    if (!canProjectResolvedScene(state, view, scene)) return null
    if (factor > 0.999) return view
  }
  return null
}
