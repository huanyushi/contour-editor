import type { LabelSettings, SelectionItem, StrokeStyle } from './appearance'
import type { AvoidanceAction } from './avoidanceModel'
import type { ContourState } from './model'
import { findSegment, segmentOrigin, resolvedScene, logicalSegmentId } from './sceneObjects'
import type { WorkspaceAction } from './workspace'
import { avoidanceDependencies, sourceBindingsIndex } from './avoidanceDependencies'
import { constructAvoidances } from './avoidanceConstructionTable'
import { pieceAppearance, type SourcePieceAction } from './sourcePieces'

export type SelectionWorkspaceEdit =
  | WorkspaceAction
  | SourcePieceAction
  | Extract<AvoidanceAction, { type: 'avoidanceLabel' | 'avoidanceStyle' }>

interface TranslationSources {
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
  const table = constructAvoidances(state)
  const index = sourceBindingsIndex(state)
  const addSegment = (id: string) => {
    const source = findSegment(state, id)
    if (!source) return
    segmentIds.add(source.id)
    pointIds.add(source.startId)
    pointIds.add(source.endId)
  }
  const binding = (a: ContourState['avoidances'][number]) => {
    const result = avoidanceDependencies(state, a.id, table.ok ? table.value : undefined)
    if (!result.ok) return
    result.value.sourceIds.forEach(addSegment)
    result.value.pointIds.forEach((id) => pointIds.add(id))
  }
  const segment = (id: string) => {
    addSegment(id)
    const related = new Set(index.get(id) ?? [])
    state.avoidances.filter((a) => related.has(a.id)).forEach(binding)
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
  if (origin?.kind === 'gap') {
    const source = findSegment(state, origin.sourceSegmentId)!
    const own = pieceAppearance(source, origin.piece)?.label
    return (
      own ??
      resolvedScene(state).labels.find((l) => l.target.id === logicalSegmentId(state, id))?.value ??
      (origin.piece.startAvoidanceId === null ? source.label : undefined)
    )
  }
  return origin?.kind === 'avoidance'
    ? state.avoidances.find((a) => a.id === origin.avoidanceId)?.partLabels?.[origin.part]
    : findSegment(state, origin?.sourceSegmentId ?? id)?.label
}

export function selectedSegmentStyle(state: ContourState, id: string): StrokeStyle | undefined {
  const origin = segmentOrigin(state, id)
  const source = findSegment(state, origin?.sourceSegmentId ?? id)
  if (!source) return undefined
  const override =
    origin?.kind === 'gap'
      ? pieceAppearance(source, origin.piece)?.style
      : origin?.kind === 'avoidance'
        ? state.avoidances.find((a) => a.id === origin.avoidanceId)?.partStyles?.[origin.part]
        : undefined
  if (origin?.kind === 'avoidance' && origin.parentAvoidanceId) {
    const parent = state.avoidances.find((a) => a.id === origin.parentAvoidanceId)
    const bank = origin.part === 'bank-entry' ? 'entry' : 'exit'
    return {
      ...state.appearance.stroke,
      ...source.style,
      ...parent?.partStyles?.[bank],
      ...override,
    }
  }
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
  if (origin.kind === 'gap') {
    const common = { sourceId: origin.sourceSegmentId, boundary: origin.piece }
    if (action.type === 'stroke')
      return { type: 'sourcePieceStyle', ...common, patch: action.patch }
    if (action.type === 'label') return { type: 'sourcePieceLabel', ...common, label: action.label }
  }
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
