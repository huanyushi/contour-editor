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
import { workspaceReducer, type WorkspaceAction } from './workspace'
import { segmentOrigin } from './sceneObjects'
import {
  selectedSegmentLabel,
  selectedSegmentStyle,
  selectionWorkspaceAction,
  type SelectionWorkspaceEdit,
} from './avoidanceSelection'

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

/** Only lifecycle cleanup here; generated-object selection mapping belongs to its consumers. */
export function cleanupRemovedAvoidanceSelection(
  before: ContourState,
  candidate: ContourState,
): ContourState {
  const live = new Set(candidate.avoidances.map((a) => a.id))
  const removed = before.avoidances.filter((a) => !live.has(a.id))
  if (!removed.length) return candidate
  const stale = (id: string) =>
    removed.some(
      (a) =>
        id.startsWith(`avoid:${a.id}:`) ||
        id === `gap:${a.targetSegmentId}:before:${a.id}` ||
        id === `gap:${a.targetSegmentId}:after:${a.id}` ||
        (a.exitSegmentId !== undefined &&
          (id === `gap:${a.exitSegmentId}:before:${a.id}` ||
            id === `gap:${a.exitSegmentId}:after:${a.id}`)),
    )
  const items = selectionItems(candidate.selection)
  const kept = items.filter((item) => item.kind === 'contour' || !stale(item.id))
  const selection =
    kept.length === items.length
      ? candidate.selection
      : kept.length === 0
        ? { kind: 'none' as const }
        : kept.length === 1
          ? kept[0]
          : { kind: 'multiple' as const, items: kept }
  return {
    ...candidate,
    selection,
    selectedSegmentId: stale(candidate.selectedSegmentId) ? '' : candidate.selectedSegmentId,
  }
}

export function selectionKey(item: SelectionItem): string {
  return item.kind === 'contour' ? 'contour' : `${item.kind}:${item.id}:${item.part ?? ''}`
}

export function isSelected(selection: Selection, target: SelectionItem): boolean {
  return selectionItems(selection).some((item) => selectionKey(item) === selectionKey(target))
}

function exists(state: ContourState, item: SelectionItem): boolean {
  if (item.kind === 'segment') return !!segmentOrigin(state, item.id)
  return item.kind === 'contour'
    ? state.vertices.length > 0
    : (item.kind === 'vertex'
        ? state.vertices
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
  if (item.kind === 'segment') return selectedSegmentLabel(state, item.id)
  if (item.kind === 'vertex') {
    const index = state.vertices.findIndex((v) => v.id === item.id)
    return index < 0 ? undefined : (state.vertices[index].label ?? defaultLabel(`z_{${index + 1}}`))
  }
  const object = (item.kind === 'marker' ? state.markers : state.formulas).find(
    (o) => o.id === item.id,
  )
  return object?.label
}

export function itemColor(state: ContourState, item: SelectionItem): string | undefined {
  if (item.kind === 'contour') return state.appearance.stroke.color
  if (item.part === 'label' || item.kind === 'formula') return itemLabel(state, item)?.color
  if (item.kind === 'segment') return selectedSegmentStyle(state, item.id)?.color
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
  const edits: SelectionWorkspaceEdit[] = []
  const edit = (action: WorkspaceAction) => edits.push(selectionWorkspaceAction(state, action))
  let contourStroke = false
  for (const item of selectionItems(state.selection)) {
    if (!exists(state, item)) continue
    if (item.kind !== 'contour' && (item.part === 'label' || item.kind === 'formula')) {
      const label = itemLabel(state, item)
      if (label)
        edit({
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
        if (item.kind === 'segment') edit({ type: 'stroke', id: item.id, patch: stroke })
        else {
          edit({ type: 'stroke', patch: stroke })
          contourStroke = true
        }
      }
    } else {
      const point = {
        ...(patch.color !== undefined ? { color: patch.color } : {}),
        ...(patch.radius !== undefined ? { radius: patch.radius } : {}),
      }
      if (Object.keys(point).length) edit({ type: 'pointStyle', target: item, patch: point })
    }
  }
  const next = edits.reduce(
    (candidate, action) => workspaceReducer(candidate, action, state),
    state,
  )
  return contourStroke
    ? {
        ...next,
        segments: next.segments.map((s) => ({
          ...s,
          style: {
            ...s.style,
            ...(patch.color !== undefined ? { color: patch.color } : {}),
            ...(patch.width !== undefined ? { width: patch.width } : {}),
          },
        })),
      }
    : next
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
    edgesToDelete = new Set<string>(),
    bindingsToDelete = new Set<string>()
  for (const id of ids('segment')) {
    const origin = segmentOrigin(state, id)!
    if (origin.kind === 'avoidance') bindingsToDelete.add(origin.avoidanceId)
    else edgesToDelete.add(origin.sourceSegmentId)
  }
  const labelEdits: SelectionWorkspaceEdit[] = []
  for (const item of selected) {
    if (item.kind === 'contour' || item.part !== 'label') continue
    const label = itemLabel(state, item)
    if (label?.visible)
      labelEdits.push(
        selectionWorkspaceAction(state, {
          type: 'label',
          target: item,
          label: { ...label, visible: false },
        }),
      )
  }
  const next = labelEdits.reduce(
    (candidate, action) => workspaceReducer(candidate, action, state),
    state,
  )
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
  const liveSegments = new Set([...segments, ...connections].map((s) => s.id))
  const avoidances = next.avoidances.filter(
    (a) =>
      !bindingsToDelete.has(a.id) &&
      liveSegments.has(a.targetSegmentId) &&
      (a.exitSegmentId === undefined || liveSegments.has(a.exitSegmentId)) &&
      remainingPoints.has(a.markerId),
  )
  return {
    ...next,
    vertices,
    segments,
    connections,
    avoidances: avoidances.length === next.avoidances.length ? next.avoidances : avoidances,
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
