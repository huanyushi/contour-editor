import type { ContourState } from '../model'
import {
  defaultLabel,
  defaultPointStyle,
  type LabelSettings,
  type Selection,
  type SelectionItem,
} from '../appearance'
import { segmentOrigin, findSegment } from '../scene/sceneObjects'
import { sourcePieceId } from '../sourcePieces'
import { selectedSegmentLabel, selectedSegmentStyle } from '../avoidance/avoidanceSelection'

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
  const stale = (id: string) => {
    const origin = id.startsWith('piece:') ? segmentOrigin(before, id) : undefined
    return removed.some(
      (a) =>
        id.startsWith(`avoid:${a.id}:`) ||
        (origin?.kind === 'gap' &&
          [origin.piece.startAvoidanceId, origin.piece.endAvoidanceId].includes(a.id)) ||
        (id.startsWith('gap:') &&
          (id.endsWith(`:before:${a.id}`) || id.endsWith(`:after:${a.id}`))),
    )
  }
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

/** Direction reversal changes boundary roles, not the physical selected object. */
export function reverseSourcePieceSelection(
  before: ContourState,
  candidate: ContourState,
): ContourState {
  const remapId = (id: string) => {
    const origin = segmentOrigin(before, id)
    if (origin?.kind !== 'gap') return id
    const old = findSegment(before, origin.sourceSegmentId)
    const current = findSegment(candidate, origin.sourceSegmentId)
    if (!old || !current || old.startId !== current.endId || old.endId !== current.startId)
      return id
    return sourcePieceId(current.id, {
      startAvoidanceId: origin.piece.endAvoidanceId,
      endAvoidanceId: origin.piece.startAvoidanceId,
    })
  }
  const remapItem = (item: SelectionItem): SelectionItem => {
    if (item.kind !== 'segment') return item
    const id = remapId(item.id)
    return id === item.id ? item : { ...item, id }
  }
  const selectedSegmentId = remapId(candidate.selectedSegmentId)
  let selection = candidate.selection
  if (selection.kind === 'multiple') {
    const original = selection
    const items = original.items.map(remapItem)
    if (items.some((item, index) => item !== original.items[index]))
      selection = { ...original, items }
  } else if (selection.kind !== 'none') selection = remapItem(selection)
  return selection === candidate.selection && selectedSegmentId === candidate.selectedSegmentId
    ? candidate
    : { ...candidate, selection, selectedSegmentId }
}

export function isSelected(selection: Selection, target: SelectionItem): boolean {
  return selectionItems(selection).some((item) => selectionKey(item) === selectionKey(target))
}

export function itemLabel(state: ContourState, item: SelectionItem): LabelSettings | undefined {
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
