import {
  createHistory,
  historyReducer,
  type EditorAction,
  type EditorHistory,
} from '../contour/history'
import type { ContourState } from '../contour/model'
import { createWorkspaceState } from '../contour/workspace'
import { DEFAULT_PROJECT_NAME, normalizeProjectName } from './projectName'

export const MAX_CANVASES = 10
export const CANVAS_LIMIT_MESSAGE = '最多保存 10 张画布，请先删除不需要的画布。'

export interface CanvasEntry {
  id: string
  name: string
  history: EditorHistory
}
export interface CanvasWorkspace {
  canvases: CanvasEntry[]
  activeId: string
}
export type CanvasWorkspaceAction =
  | { type: 'edit'; id: string; action: EditorAction }
  | { type: 'activate'; id: string }
  | { type: 'add'; entry: CanvasEntry }
  | { type: 'rename'; id: string; name: string }
  | { type: 'remove'; id: string; replacement?: CanvasEntry }

export function createBlankCanvasState(): ContourState {
  return {
    ...createWorkspaceState(),
    vertices: [],
    segments: [],
    closed: false,
    selectedId: '',
    selectedSegmentId: '',
    selection: { kind: 'none' },
    error: '',
  }
}

export function createCanvasEntry(id: string, name: string, state: ContourState): CanvasEntry {
  return {
    id,
    name: normalizeProjectName(name) ?? DEFAULT_PROJECT_NAME,
    history: createHistory(state),
  }
}

export function committedState(history: EditorHistory): ContourState {
  return history.gesture?.before ?? history.present
}

function settled(entry: CanvasEntry): CanvasEntry {
  const present = committedState(entry.history)
  return {
    ...entry,
    history: {
      ...entry.history,
      gesture: null,
      present: { ...present, selection: { kind: 'none' }, selectionSource: 'click', error: '' },
    },
  }
}

export function canvasWorkspaceReducer(
  ws: CanvasWorkspace,
  action: CanvasWorkspaceAction,
): CanvasWorkspace {
  switch (action.type) {
    case 'edit': {
      if (action.id !== ws.activeId) return ws
      let changed = false
      const canvases = ws.canvases.map((entry) => {
        if (entry.id !== action.id) return entry
        const history = historyReducer(entry.history, action.action)
        if (history === entry.history) return entry
        changed = true
        return { ...entry, history }
      })
      return changed ? { ...ws, canvases } : ws
    }
    case 'rename':
      return {
        ...ws,
        canvases: ws.canvases.map((entry) =>
          entry.id === action.id
            ? { ...entry, name: normalizeProjectName(action.name) ?? DEFAULT_PROJECT_NAME }
            : entry,
        ),
      }
    case 'activate':
      if (action.id === ws.activeId || !ws.canvases.some((entry) => entry.id === action.id))
        return ws
      return {
        ...ws,
        activeId: action.id,
        canvases: ws.canvases.map((entry) =>
          entry.id === ws.activeId || entry.id === action.id ? settled(entry) : entry,
        ),
      }
    case 'add':
      if (
        ws.canvases.length >= MAX_CANVASES ||
        ws.canvases.some((entry) => entry.id === action.entry.id)
      )
        return ws
      return {
        activeId: action.entry.id,
        canvases: [
          ...ws.canvases.map((entry) => (entry.id === ws.activeId ? settled(entry) : entry)),
          settled(action.entry),
        ],
      }
    case 'remove': {
      const index = ws.canvases.findIndex((entry) => entry.id === action.id)
      if (index < 0) return ws
      if (ws.canvases.length === 1)
        return action.replacement
          ? { canvases: [settled(action.replacement)], activeId: action.replacement.id }
          : ws
      const canvases = ws.canvases.filter((entry) => entry.id !== action.id)
      const activeId =
        ws.activeId === action.id ? canvases[Math.min(index, canvases.length - 1)].id : ws.activeId
      return {
        activeId,
        canvases: canvases.map((entry) => (entry.id === activeId ? settled(entry) : entry)),
      }
    }
  }
}
