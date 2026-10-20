import type { ContourState } from './model'
import {
  defaultLabel,
  defaultPointStyle,
  inRange,
  validColor,
  type Selection,
  type SelectionItem,
} from './appearance'
import { activeSegments, isSingleCycle } from './pathTopology'
import { workspaceReducer } from './workspace'
import { findSegment, sceneSegments } from './sceneObjects'

export interface SelectionStylePatch {
  color?: string
  width?: number
  radius?: number
  labelSize?: number
}
export type SelectionAction =
  | { type: 'selectMany'; items: SelectionItem[]; additive?: boolean; source?: 'click' | 'marquee' }
  | { type: 'toggleSelection'; item: SelectionItem }
  | { type: 'clearSelection' | 'deleteSelection' }
  | { type: 'selectionStyle'; patch: SelectionStylePatch }

export function selectionItems(selection: Selection): SelectionItem[] {
  return selection.kind === 'none'
    ? []
    : selection.kind === 'multiple'
      ? selection.items
      : [selection]
}

export function selectionKey(item: SelectionItem): string {
  return item.kind === 'contour' ? 'contour' : `${item.kind}:${item.id}:${item.part ?? ''}`
}

export function isSelected(selection: Selection, target: SelectionItem): boolean {
  return selectionItems(selection).some((item) => selectionKey(item) === selectionKey(target))
}

function exists(state: ContourState, item: SelectionItem): boolean {
  return item.kind === 'contour'
    ? state.vertices.length > 0
    : (item.kind === 'vertex'
        ? state.vertices
        : item.kind === 'segment'
          ? sceneSegments(state)
          : item.kind === 'marker'
            ? state.markers
            : state.formulas
      ).some((o) => o.id === item.id)
}

function selectItems(
  state: ContourState,
  items: SelectionItem[],
  source: 'click' | 'marquee' = 'click',
): ContourState {
  const unique = [
    ...new Map(
      items.filter((item) => exists(state, item)).map((item) => [selectionKey(item), item]),
    ).values(),
  ]
  const vertex = unique.find((item) => item.kind === 'vertex')
  const segment = unique.find((item) => item.kind === 'segment')
  return {
    ...state,
    selectionSource: source,
    selection:
      unique.length === 0
        ? { kind: 'none' }
        : unique.length === 1
          ? unique[0]
          : { kind: 'multiple', items: unique },
    ...(vertex?.kind === 'vertex' ? { selectedId: vertex.id } : {}),
    ...(segment?.kind === 'segment' ? { selectedSegmentId: segment.id } : {}),
    error: '',
  }
}

export function itemLabel(state: ContourState, item: SelectionItem) {
  if (item.kind === 'contour') return undefined
  if (item.kind === 'vertex') {
    const index = state.vertices.findIndex((v) => v.id === item.id)
    return index < 0 ? undefined : (state.vertices[index].label ?? defaultLabel(`z_{${index + 1}}`))
  }
  const object = (
    item.kind === 'segment'
      ? sceneSegments(state)
      : item.kind === 'marker'
        ? state.markers
        : state.formulas
  ).find((o) => o.id === item.id)
  return object?.label
}

export function itemColor(state: ContourState, item: SelectionItem): string | undefined {
  if (item.kind === 'contour') return state.appearance.stroke.color
  if (item.part === 'label' || item.kind === 'formula') return itemLabel(state, item)?.color
  if (item.kind === 'segment')
    return findSegment(state, item.id)?.style?.color ?? state.appearance.stroke.color
  return (
    (item.kind === 'vertex' ? state.vertices : state.markers).find((p) => p.id === item.id)
      ?.pointStyle?.color ?? defaultPointStyle().color
  )
}

function styleSelection(state: ContourState, patch: SelectionStylePatch): ContourState {
  if (
    (patch.color !== undefined && !validColor(patch.color)) ||
    (patch.width !== undefined && !inRange(patch.width, 0.5, 8)) ||
    (patch.radius !== undefined && !inRange(patch.radius, 2, 10)) ||
    (patch.labelSize !== undefined && !inRange(patch.labelSize, 10, 40))
  )
    return { ...state, error: '批量外观设置超出有效范围。' }
  let next = state
  for (const item of selectionItems(state.selection)) {
    if (!exists(state, item)) continue
    if (item.kind !== 'contour' && (item.part === 'label' || item.kind === 'formula')) {
      const label = itemLabel(state, item)
      if (label)
        next = workspaceReducer(next, {
          type: 'label',
          target: item,
          label: {
            ...label,
            ...(patch.color !== undefined ? { color: patch.color } : {}),
            ...(patch.labelSize !== undefined ? { size: patch.labelSize } : {}),
          },
        })
    } else if (item.kind === 'segment' || item.kind === 'contour') {
      const stroke = {
        ...(patch.color !== undefined ? { color: patch.color } : {}),
        ...(patch.width !== undefined ? { width: patch.width } : {}),
      }
      if (Object.keys(stroke).length) {
        if (item.kind === 'segment')
          next = workspaceReducer(next, { type: 'stroke', id: item.id, patch: stroke })
        else {
          next = workspaceReducer(next, { type: 'stroke', patch: stroke })
          next = {
            ...next,
            segments: next.segments.map((s) => ({ ...s, style: { ...s.style, ...stroke } })),
          }
        }
      }
    } else {
      const point = {
        ...(patch.color !== undefined ? { color: patch.color } : {}),
        ...(patch.radius !== undefined ? { radius: patch.radius } : {}),
      }
      if (Object.keys(point).length)
        next = workspaceReducer(next, { type: 'pointStyle', target: item, patch: point })
    }
  }
  return next
}

export function deleteItems(state: ContourState, items: SelectionItem[]): ContourState {
  const selected = items.filter((item) => exists(state, item))
  if (!selected.length) return state
  const contour = selected.some((item) => item.kind === 'contour')
  const ids = (kind: 'vertex' | 'segment' | 'marker' | 'formula') =>
    new Set(
      selected
        .filter((item) => item.kind === kind && item.part !== 'label')
        .map((item) => (item.kind === 'contour' ? '' : item.id)),
    )
  const verticesToDelete = ids('vertex'),
    edgesToDelete = ids('segment')
  let next = state
  for (const item of selected) {
    if (item.kind === 'contour' || item.part !== 'label') continue
    const label = itemLabel(state, item)
    if (label?.visible)
      next = workspaceReducer(next, {
        type: 'label',
        target: item,
        label: { ...label, visible: false },
      })
  }
  const geometryChanged =
    contour || verticesToDelete.size > 0 || next.segments.some((s) => edgesToDelete.has(s.id))
  const vertices = contour
    ? []
    : verticesToDelete.size
      ? next.vertices.filter((v) => !verticesToDelete.has(v.id))
      : next.vertices
  const segments = contour
    ? []
    : geometryChanged
      ? activeSegments(next).filter(
          (s) =>
            !edgesToDelete.has(s.id) &&
            !verticesToDelete.has(s.startId) &&
            !verticesToDelete.has(s.endId),
        )
      : next.segments
  const markers = ids('marker'),
    formulas = ids('formula')
  const remainingPoints = new Set(
    [...vertices, ...next.markers.filter((m) => !markers.has(m.id))].map((p) => p.id),
  )
  const connections = next.connections.filter(
    (s) =>
      !edgesToDelete.has(s.id) && remainingPoints.has(s.startId) && remainingPoints.has(s.endId),
  )
  return {
    ...next,
    vertices,
    segments,
    connections,
    markers: markers.size ? next.markers.filter((o) => !markers.has(o.id)) : next.markers,
    formulas: formulas.size ? next.formulas.filter((o) => !formulas.has(o.id)) : next.formulas,
    closed: next.closed && (!geometryChanged || isSingleCycle({ vertices, segments })),
    selectedId: vertices.some((v) => v.id === next.selectedId)
      ? next.selectedId
      : (vertices[0]?.id ?? ''),
    selectedSegmentId: [...segments, ...connections].some((s) => s.id === next.selectedSegmentId)
      ? next.selectedSegmentId
      : (segments[0]?.id ?? connections[0]?.id ?? ''),
    selection: { kind: 'none' },
    selectionSource: 'click',
    error: '',
  }
}

export function selectionReducer(state: ContourState, action: SelectionAction): ContourState {
  switch (action.type) {
    case 'selectMany':
      return selectItems(
        state,
        [...(action.additive ? selectionItems(state.selection) : []), ...action.items],
        action.source,
      )
    case 'toggleSelection': {
      const items = selectionItems(state.selection)
      return selectItems(
        state,
        isSelected(state.selection, action.item)
          ? items.filter((item) => selectionKey(item) !== selectionKey(action.item))
          : [...items, action.item],
      )
    }
    case 'clearSelection':
      return { ...state, selection: { kind: 'none' }, selectionSource: 'click', error: '' }
    case 'deleteSelection':
      return deleteItems(state, selectionItems(state.selection))
    case 'selectionStyle':
      return styleSelection(state, action.patch)
  }
}
