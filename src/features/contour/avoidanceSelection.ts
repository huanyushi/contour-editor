import type { LabelSettings, SelectionItem, StrokeStyle } from './appearance'
import type { AvoidanceAction } from './avoidanceModel'
import type { ContourState } from './model'
import { findSegment, segmentOrigin } from './sceneObjects'
import type { WorkspaceAction } from './workspace'

export type SelectionWorkspaceEdit =
  WorkspaceAction | Extract<AvoidanceAction, { type: 'avoidanceLabel' | 'avoidanceStyle' }>

export interface TranslationSources {
  pointIds: ReadonlySet<string>
  segmentIds: ReadonlySet<string>
  formulaIds: ReadonlySet<string>
}

/** Collect only explicit dependencies; shared points update other bindings naturally. */
export function translationSources(
  state: ContourState,
  items: SelectionItem[],
): TranslationSources {
  const pointIds = new Set<string>(),
    segmentIds = new Set<string>(),
    formulaIds = new Set<string>()
  const addSegment = (id: string) => {
    const source = findSegment(state, id)
    if (!source) return
    segmentIds.add(source.id)
    pointIds.add(source.startId)
    pointIds.add(source.endId)
  }
  const binding = (a: ContourState['avoidances'][number]) => {
    addSegment(a.targetSegmentId)
    if (a.exitSegmentId !== undefined) addSegment(a.exitSegmentId)
    pointIds.add(a.markerId)
  }
  const segment = (id: string) => {
    addSegment(id)
    state.avoidances
      .filter((a) => a.targetSegmentId === id || a.exitSegmentId === id)
      .forEach(binding)
  }
  for (const item of items) {
    if (item.kind === 'contour') {
      state.vertices.forEach((p) => pointIds.add(p.id))
      state.segments.forEach((s) => segment(s.id))
    } else if (item.part !== 'label') {
      if (item.kind === 'segment') {
        const origin = segmentOrigin(state, item.id)
        if (origin?.kind === 'avoidance') {
          binding(state.avoidances.find((a) => a.id === origin.avoidanceId)!)
        } else if (origin) segment(origin.sourceSegmentId)
      } else if (item.kind === 'formula') formulaIds.add(item.id)
      else pointIds.add(item.id)
    }
  }
  return { pointIds, segmentIds, formulaIds }
}

export function selectedSegmentLabel(state: ContourState, id: string): LabelSettings | undefined {
  const origin = segmentOrigin(state, id)
  return origin?.kind === 'avoidance'
    ? state.avoidances.find((a) => a.id === origin.avoidanceId)?.partLabels?.[origin.part]
    : findSegment(state, origin?.sourceSegmentId ?? id)?.label
}

export function selectedSegmentStyle(state: ContourState, id: string): StrokeStyle | undefined {
  const origin = segmentOrigin(state, id)
  const source = findSegment(state, origin?.sourceSegmentId ?? id)
  if (!source) return undefined
  const override =
    origin?.kind === 'avoidance'
      ? state.avoidances.find((a) => a.id === origin.avoidanceId)?.partStyles?.[origin.part]
      : undefined
  return { ...state.appearance.stroke, ...source.style, ...override }
}

/** Resolve once against the accepted snapshot, before a batch can break its dependencies. */
export function selectionWorkspaceAction(
  state: ContourState,
  action: WorkspaceAction,
): SelectionWorkspaceEdit {
  const id =
    action.type === 'stroke'
      ? action.id
      : action.type === 'label' && action.target.kind === 'segment'
        ? action.target.id
        : undefined
  if (!id) return action
  const origin = segmentOrigin(state, id)
  if (!origin) return action
  if (action.type === 'label' && action.target.kind === 'segment')
    return origin.kind === 'avoidance'
      ? { type: 'avoidanceLabel', id: origin.avoidanceId, part: origin.part, label: action.label }
      : { ...action, target: { ...action.target, id: origin.sourceSegmentId } }
  if (action.type === 'stroke')
    return origin.kind === 'avoidance'
      ? { type: 'avoidanceStyle', id: origin.avoidanceId, part: origin.part, patch: action.patch }
      : { ...action, id: origin.sourceSegmentId }
  return action
}
