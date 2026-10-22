import { isValidPoint, type ComplexPoint } from '../../lib/geometry'
import { LABEL_OFFSET_LIMIT } from './appearance'
import type { ContourState } from './model'
import { itemAnchor } from './selectionGeometry'
import { itemLabel, selectionItems } from './selectionModel'
import { workspaceReducer } from './workspace'
import { findPoint } from './sceneObjects'
import {
  translationSources,
  selectionWorkspaceAction,
  type SelectionWorkspaceEdit,
} from './avoidanceSelection'
import { resolveScene } from './resolvedScene'
import { isLegacyAvoidance } from './avoidanceTypes'

export function translationAnchor(state: ContourState): ComplexPoint | undefined {
  for (const item of selectionItems(state.selection)) {
    if (item.kind === 'contour') return state.vertices[0]
    if (item.part === 'label') continue
    if (item.kind === 'segment') {
      const sources = translationSources(state, [item])
      const point = findPoint(state, sources.pointIds.values().next().value ?? '')
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

/** Coordinates and labels use drag start; accepted sides retain off-line synchronization. */
export function translateSelection(
  from: ContourState,
  delta: ComplexPoint,
  accepted: ContourState = from,
): ContourState {
  if (!isValidPoint(delta)) return { ...from, error: '平移距离超出有效范围。' }
  const items = selectionItems(from.selection)
  const { pointIds, segmentIds: segments, formulaIds: formulas } = translationSources(from, items)
  const acceptedSides = new Map(
    accepted.avoidances.filter(isLegacyAvoidance).map((a) => [a.id, a.side]),
  )
  const move = <T extends ComplexPoint>(point: T): T => ({
    ...point,
    re: point.re + delta.re,
    im: point.im + delta.im,
  })
  let next: ContourState = {
    ...from,
    vertices: from.vertices.map((p) => (pointIds.has(p.id) ? move(p) : p)),
    segments: from.segments.map((s) =>
      s.kind === 'arc' && (segments.has(s.id) || (pointIds.has(s.startId) && pointIds.has(s.endId)))
        ? { ...s, through: move(s.through) }
        : s,
    ),
    connections: from.connections.map((s) =>
      s.kind === 'arc' && (segments.has(s.id) || (pointIds.has(s.startId) && pointIds.has(s.endId)))
        ? { ...s, through: move(s.through) }
        : s,
    ),
    markers: from.markers.map((p) => (pointIds.has(p.id) ? move(p) : p)),
    formulas: from.formulas.map((p) => (formulas.has(p.id) ? move(p) : p)),
    // Seed before resolving anchors, so label compensation uses the geometry acceptance keeps.
    avoidances: from.avoidances.map((a) => {
      if (!isLegacyAvoidance(a)) return a
      const side = acceptedSides.get(a.id) ?? a.side
      return side === a.side ? a : { ...a, side }
    }),
    error: '',
  }
  const dx = delta.re * from.viewport.scaleX,
    dy = -delta.im * from.viewport.scaleY
  // Candidates can have invalid source geometry. Only the reducer accepts the full scene.
  const resolved = resolveScene(next)
  if (!resolved.ok) return next
  const edits: SelectionWorkspaceEdit[] = []
  for (const item of items) {
    if (item.kind === 'contour' || item.part !== 'label') continue
    const label = itemLabel(from, item),
      before = itemAnchor(from, item),
      after = itemAnchor(next, item, resolved.scene)
    if (!label || !before || !after) continue
    const labelDx = Math.round((label.dx + dx - (after.x - before.x)) * 1000) / 1000
    const labelDy = Math.round((label.dy + dy - (after.y - before.y)) * 1000) / 1000
    if (Math.abs(labelDx) > LABEL_OFFSET_LIMIT || Math.abs(labelDy) > LABEL_OFFSET_LIMIT)
      return { ...from, error: '标签偏移超出有效范围，请减小拖动距离。' }
    if (labelDx !== label.dx || labelDy !== label.dy)
      edits.push(
        selectionWorkspaceAction(from, {
          type: 'label',
          target: item,
          label: { ...label, dx: labelDx, dy: labelDy },
        }),
      )
  }
  for (const edit of edits) next = workspaceReducer(next, edit, from)
  return next
}
