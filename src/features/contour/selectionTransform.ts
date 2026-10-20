import { isValidPoint, type ComplexPoint } from '../../lib/geometry'
import { LABEL_OFFSET_LIMIT } from './appearance'
import type { ContourState } from './model'
import { itemAnchor } from './selectionGeometry'
import { itemLabel, selectionItems } from './selectionModel'
import { workspaceReducer } from './workspace'
import { findPoint, findSegment, sceneSegments } from './sceneObjects'

export function translationAnchor(state: ContourState): ComplexPoint | undefined {
  for (const item of selectionItems(state.selection)) {
    if (item.kind === 'contour') return state.vertices[0]
    if (item.part === 'label') continue
    if (item.kind === 'segment') {
      const segment = findSegment(state, item.id)
      const point = segment ? findPoint(state, segment.startId) : undefined
      if (point) return point
    } else {
      const point = (
        item.kind === 'vertex'
          ? state.vertices
          : item.kind === 'marker'
            ? state.markers
            : state.formulas
      ).find((p) => p.id === item.id)
      if (point) return point
    }
  }
}

/** Translate from the immutable drag-start snapshot, never from the previous pointer move. */
export function translateSelection(from: ContourState, delta: ComplexPoint): ContourState {
  if (!isValidPoint(delta)) return { ...from, error: '平移距离超出有效范围。' }
  const items = selectionItems(from.selection)
  const vertices = new Set<string>(),
    segments = new Set<string>(),
    markers = new Set<string>(),
    formulas = new Set<string>()
  for (const item of items) {
    if (item.kind === 'contour') {
      from.vertices.forEach((v) => vertices.add(v.id))
      from.segments.forEach((s) => segments.add(s.id))
    } else if (item.part !== 'label') {
      ;(item.kind === 'vertex'
        ? vertices
        : item.kind === 'segment'
          ? segments
          : item.kind === 'marker'
            ? markers
            : formulas
      ).add(item.id)
    }
  }
  const vertexIds = new Set(from.vertices.map((v) => v.id))
  for (const segment of sceneSegments(from))
    if (segments.has(segment.id)) {
      for (const id of [segment.startId, segment.endId])
        (vertexIds.has(id) ? vertices : markers).add(id)
    }
  const move = <T extends ComplexPoint>(point: T): T => ({
    ...point,
    re: point.re + delta.re,
    im: point.im + delta.im,
  })
  let next: ContourState = {
    ...from,
    vertices: from.vertices.map((p) => (vertices.has(p.id) ? move(p) : p)),
    segments: from.segments.map((s) =>
      s.kind === 'arc' && (segments.has(s.id) || (vertices.has(s.startId) && vertices.has(s.endId)))
        ? { ...s, through: move(s.through) }
        : s,
    ),
    connections: from.connections.map((s) =>
      s.kind === 'arc' &&
      (segments.has(s.id) ||
        ((vertices.has(s.startId) || markers.has(s.startId)) &&
          (vertices.has(s.endId) || markers.has(s.endId))))
        ? { ...s, through: move(s.through) }
        : s,
    ),
    markers: from.markers.map((p) => (markers.has(p.id) ? move(p) : p)),
    formulas: from.formulas.map((p) => (formulas.has(p.id) ? move(p) : p)),
    error: '',
  }
  const dx = delta.re * from.viewport.scaleX,
    dy = -delta.im * from.viewport.scaleY
  for (const item of items) {
    if (item.kind === 'contour' || item.part !== 'label') continue
    const label = itemLabel(from, item),
      before = itemAnchor(from, item),
      after = itemAnchor(next, item)
    if (!label || !before || !after) continue
    const labelDx = Math.round((label.dx + dx - (after.x - before.x)) * 1000) / 1000
    const labelDy = Math.round((label.dy + dy - (after.y - before.y)) * 1000) / 1000
    if (Math.abs(labelDx) > LABEL_OFFSET_LIMIT || Math.abs(labelDy) > LABEL_OFFSET_LIMIT)
      return { ...from, error: '标签偏移超出有效范围，请减小拖动距离。' }
    if (labelDx !== label.dx || labelDy !== label.dy)
      next = workspaceReducer(next, {
        type: 'label',
        target: item,
        label: { ...label, dx: labelDx, dy: labelDy },
      })
  }
  return next
}
