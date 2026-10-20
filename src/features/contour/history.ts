import { contourReducer, createInitialState, type ContourAction, type ContourState } from './model'
import { defaultLabel, defaultPointStyle, type LabelSettings } from './appearance'
import { canProjectScene } from './sceneView'
import { projectCapacityError } from '../project/format'

export type GestureOwner = 'canvas' | 'slider-pointer' | 'slider-keyboard' | 'generic'
export type EditorAction =
  | ContourAction
  | { type: 'undo' | 'redo' }
  | { type: 'beginGesture' | 'endGesture'; owner?: GestureOwner }
export interface EditorHistory {
  present: ContourState
  past: ContourState[]
  future: ContourState[]
  /** Before the active pointer/slider interaction, or null when idle. */
  gesture: { before: ContourState; owner: GestureOwner } | null
}

const HISTORY_LIMIT = 100
export function createHistory(initial = createInitialState()): EditorHistory {
  return { present: initial, past: [], future: [], gesture: null }
}

function documentFields(state: ContourState) {
  return [
    state.vertices,
    state.segments,
    state.markers,
    state.formulas,
    state.appearance,
    state.closed,
  ]
}

function changedDocument(before: ContourState, after: ContourState): boolean {
  const a = documentFields(before)
  const b = documentFields(after)
  if (a.every((value, index) => value === b[index])) return false
  // Reducer actions can produce fresh arrays for an unchanged coordinate. Compare
  // only serializable document data, excluding selection, errors and view options.
  const fingerprint = (state: ContourState) =>
    JSON.stringify(
      [
        state.vertices.map((vertex) => ({
          ...vertex,
          pointStyle: { ...defaultPointStyle(), ...vertex.pointStyle },
        })),
        ...documentFields(state).slice(1),
      ],
      (_key, value: unknown) =>
        value && typeof value === 'object' && !Array.isArray(value)
          ? Object.fromEntries(
              Object.entries(value).sort(([left], [right]) => left.localeCompare(right)),
            )
          : value,
    )
  return fingerprint(before) !== fingerprint(after)
}

function restored(snapshot: ContourState, current: ContourState): ContourState {
  const result = {
    ...snapshot,
    snap: current.snap,
    grid: current.grid,
    handles: current.handles,
    viewport: current.viewport,
    axes: current.axes,
    error: '',
  }
  // Normally keep the user's camera. An extreme historical scene may not be
  // projectable at the current zoom, or fit the file budget with its view options.
  if (!canProjectScene(result, result.viewport) || projectCapacityError(result))
    return { ...snapshot, error: '为安全恢复作品，视图已恢复到该历史步骤的设置。' }
  return result
}

function push(past: ContourState[], state: ContourState): ContourState[] {
  return [...past, state].slice(-HISTORY_LIMIT)
}

function restoreImplicitLabels(before: ContourState, present: ContourState): ContourState {
  const originals = new Map(before.vertices.map((point) => [point.id, point]))
  let changed = false
  const vertices = present.vertices.map((point, index) => {
    const original = originals.get(point.id)
    if (!original || original.label || !point.label) return point
    const expected = defaultLabel(`z_{${index + 1}}`)
    if (
      !(Object.keys(expected) as (keyof LabelSettings)[]).every(
        (key) => point.label![key] === expected[key],
      )
    )
      return point
    const copy = { ...point }
    delete copy.label
    changed = true
    return copy
  })
  return changed ? { ...present, vertices } : present
}

export function historyReducer(history: EditorHistory, action: EditorAction): EditorHistory {
  switch (action.type) {
    case 'beginGesture':
      return history.gesture
        ? history
        : { ...history, gesture: { before: history.present, owner: action.owner ?? 'generic' } }
    case 'endGesture': {
      if (!history.gesture || history.gesture.owner !== (action.owner ?? 'generic')) return history
      const present = restoreImplicitLabels(history.gesture.before, history.present)
      return changedDocument(history.gesture.before, present)
        ? {
            ...history,
            present,
            past: push(history.past, history.gesture.before),
            future: [],
            gesture: null,
          }
        : { ...history, present, gesture: null }
    }
    case 'undo': {
      if (history.gesture || !history.past.length) return history
      const previous = history.past[history.past.length - 1]
      return {
        present: restored(previous, history.present),
        past: history.past.slice(0, -1),
        future: [...history.future, history.present],
        gesture: null,
      }
    }
    case 'redo': {
      if (history.gesture || !history.future.length) return history
      const next = history.future[history.future.length - 1]
      return {
        present: restored(next, history.present),
        past: push(history.past, history.present),
        future: history.future.slice(0, -1),
        gesture: null,
      }
    }
    default: {
      const present = contourReducer(history.present, action)
      if (present === history.present) return history
      if (history.gesture || !changedDocument(history.present, present))
        return { ...history, present }
      return { present, past: push(history.past, history.present), future: [], gesture: null }
    }
  }
}
