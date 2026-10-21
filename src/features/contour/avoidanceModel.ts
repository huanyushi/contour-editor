import { constructAvoidance } from './avoidanceConstruction'
import type { ComplexPoint } from '../../lib/geometry'
import type { LabelSettings, StrokeStyle } from './appearance'
import type { Avoidance, AvoidancePart, MathematicalKind } from './avoidanceTypes'
import type { ContourAction, ContourState } from './model'
import { scenePoints, sceneSegments } from './sceneObjects'
import { cleanupRemovedAvoidanceSelection } from './selectionModel'

export type AvoidancePatch = Partial<Pick<Avoidance, 'radius' | 'side' | 'openingRatio'>>
export type AvoidanceAction =
  | { type: 'mathematicalKind'; id: string; value: MathematicalKind }
  | { type: 'addAvoidance'; avoidance: Avoidance }
  | { type: 'updateAvoidance'; id: string; patch: AvoidancePatch }
  | { type: 'removeAvoidance'; id: string }
  | { type: 'avoidanceStyle'; id: string; part: AvoidancePart; patch: Partial<StrokeStyle> }
  | { type: 'avoidanceLabel'; id: string; part: AvoidancePart; label: LabelSettings }

export function avoidanceReducer(state: ContourState, action: AvoidanceAction): ContourState {
  switch (action.type) {
    case 'mathematicalKind': {
      const marker = scenePoints(state).find((item) => item.id === action.id)
      if (!marker) return state
      if (!['ordinary', 'pole', 'isolated', 'branch'].includes(action.value))
        return { ...state, error: '标记数学类型无效。' }
      if (action.value === 'ordinary' && state.avoidances.some((a) => a.markerId === action.id))
        return { ...state, error: '请先取消该标记的绕行，再改为普通标记。' }
      if ((marker.mathematicalKind ?? 'ordinary') === action.value) return state
      const key = state.vertices.some((item) => item.id === action.id) ? 'vertices' : 'markers'
      return {
        ...state,
        [key]: state[key].map((item) =>
          item.id === action.id ? { ...item, mathematicalKind: action.value } : item,
        ),
        error: '',
      }
    }
    case 'addAvoidance': {
      const existing = state.avoidances.find(
        (a) =>
          a.markerId === action.avoidance.markerId &&
          a.targetSegmentId === action.avoidance.targetSegmentId &&
          a.exitSegmentId === action.avoidance.exitSegmentId,
      )
      const id = `avoid:${existing?.id ?? action.avoidance.id}:arc`
      return {
        ...state,
        avoidances: existing ? state.avoidances : [...state.avoidances, action.avoidance],
        selection: { kind: 'segment', id },
        selectedSegmentId: id,
        selectionSource: 'click',
        error: '',
      }
    }
    case 'removeAvoidance':
    case 'updateAvoidance':
    case 'avoidanceStyle':
    case 'avoidanceLabel': {
      if (!state.avoidances.some((a) => a.id === action.id)) return state
      const avoidances =
        action.type === 'removeAvoidance'
          ? state.avoidances.filter((a) => a.id !== action.id)
          : state.avoidances.map((a) => {
              if (a.id !== action.id) return a
              switch (action.type) {
                case 'updateAvoidance':
                  return { ...a, ...action.patch }
                case 'avoidanceStyle':
                  return {
                    ...a,
                    partStyles: {
                      ...a.partStyles,
                      [action.part]: { ...a.partStyles?.[action.part], ...action.patch },
                    },
                  }
                case 'avoidanceLabel':
                  return { ...a, partLabels: { ...a.partLabels, [action.part]: action.label } }
              }
            })
      return cleanupRemovedAvoidanceSelection(state, { ...state, avoidances, error: '' })
    }
  }
}

function swapEnds<T>(parts: Partial<Record<AvoidancePart, T>>): Partial<Record<AvoidancePart, T>> {
  // Omit absent keys rather than persisting undefined overrides.
  const { entry, exit, ...rest } = parts
  return {
    ...rest,
    ...(exit === undefined ? {} : { entry: exit }),
    ...(entry === undefined ? {} : { exit: entry }),
  }
}

const samePoint = (a: ComplexPoint, b: ComplexPoint) => a.re === b.re && a.im === b.im

/** Dependency maintenance only builds a candidate; contourReducer owns acceptance. */
export function reconcileAvoidanceDependencies(
  before: ContourState,
  candidate: ContourState,
  action: ContourAction,
): ContourState {
  const destructive =
    action.type === 'delete' ||
    action.type === 'deleteSegment' ||
    action.type === 'deleteSelection' ||
    (action.type === 'removeObject' && action.kind === 'marker')
  const sourceEdit =
    destructive ||
    action.type === 'move' ||
    action.type === 'moveObject' ||
    action.type === 'translateSelection' ||
    action.type === 'add' ||
    action.type === 'reverse' ||
    action.type === 'toggleClosed' ||
    action.type === 'connectPoints'
  if (!sourceEdit || !candidate.avoidances.length) return candidate

  const oldSegments = new Map(sceneSegments(before).map((s) => [s.id, s]))
  const newSegments = new Map(sceneSegments(candidate).map((s) => [s.id, s]))
  const oldPoints = new Map(scenePoints(before).map((p) => [p.id, p]))
  const newPoints = new Map(scenePoints(candidate).map((p) => [p.id, p]))
  const removedSegments = new Set([...oldSegments.keys()].filter((id) => !newSegments.has(id)))
  const liveMarkers = new Set(scenePoints(candidate).map((m) => m.id))
  const removedMarkers = new Set(
    scenePoints(before)
      .filter((m) => !liveMarkers.has(m.id))
      .map((m) => m.id),
  )
  let changed = false
  const avoidances: Avoidance[] = []
  for (const item of candidate.avoidances) {
    if (
      destructive &&
      (removedSegments.has(item.targetSegmentId) ||
        (item.exitSegmentId !== undefined && removedSegments.has(item.exitSegmentId)) ||
        removedMarkers.has(item.markerId))
    ) {
      changed = true
      continue
    }
    const oldSource = oldSegments.get(item.targetSegmentId)
    const source = newSegments.get(item.targetSegmentId)
    let next = item
    if (oldSource && source) {
      const reversed = oldSource.startId === source.endId && oldSource.endId === source.startId
      if (reversed) {
        next = {
          ...next,
          ...(next.exitSegmentId === undefined
            ? {}
            : {
                targetSegmentId: next.exitSegmentId,
                exitSegmentId: next.targetSegmentId,
              }),
          side: next.side === 'left' ? 'right' : 'left',
          ...(next.partStyles === undefined ? {} : { partStyles: swapEnds(next.partStyles) }),
          ...(next.partLabels === undefined ? {} : { partLabels: swapEnds(next.partLabels) }),
        }
      }
      const ids = [source.startId, source.endId, item.markerId]
      // A direction-only reversal must flip (and preserve) the saved preference,
      // even when an imported off-line marker currently lies on its other side.
      const coordinatesChanged =
        (!reversed && (oldSource.startId !== source.startId || oldSource.endId !== source.endId)) ||
        ids.some((id) => {
          const oldPoint = oldPoints.get(id),
            point = newPoints.get(id)
          return oldPoint && point && !samePoint(oldPoint, point)
        })
      if (coordinatesChanged && next.exitSegmentId === undefined && source.kind === 'line') {
        const result = constructAvoidance(candidate, next)
        // Invalid geometry is left intact for the shared final boundary to reject.
        if (result.ok && !result.value.geometry.onLine) {
          const side = result.value.defaultSide
          if (next.side !== side) next = { ...next, side }
        }
      }
    }
    changed ||= next !== item
    avoidances.push(next)
  }
  return changed
    ? cleanupRemovedAvoidanceSelection(before, { ...candidate, avoidances })
    : candidate
}
