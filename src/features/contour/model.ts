import { isValidPoint, type ComplexPoint } from '../../lib/geometry'
import { arcThrough } from '../../lib/arc'
import { projectCapacityError } from '../project/format'
import { canProjectScene } from './sceneView'
import type { LabelSettings, PointStyle, StrokeStyle } from './appearance'
import { workspaceReducer, type WorkspaceAction, type WorkspaceState } from './workspace'
import { createRectangleState } from './templates'

export interface Vertex extends ComplexPoint {
  id: string
  label?: LabelSettings
  pointStyle?: PointStyle
}
interface SegmentEndpoints {
  id: string
  startId: string
  endId: string
  label?: LabelSettings
  style?: Partial<StrokeStyle>
}
export type LineSegment = SegmentEndpoints & { kind: 'line' }
export type CircularArcSegment = SegmentEndpoints & { kind: 'arc'; through: ComplexPoint }
export type PathSegment = LineSegment | CircularArcSegment

export interface ContourState extends WorkspaceState {
  vertices: Vertex[]
  /** Includes a retained closing segment even while the contour is open. */
  segments: PathSegment[]
  selectedId: string
  selectedSegmentId: string
  closed: boolean
  error: string
}

export type ContourAction =
  | { type: 'loadProject'; state: ContourState }
  | WorkspaceAction
  | { type: 'select' | 'selectSegment'; id: string }
  | { type: 'move' | 'moveThrough'; id: string; point: ComplexPoint }
  | { type: 'setArc'; id: string; through: ComplexPoint }
  | { type: 'setLine'; id: string }
  | { type: 'add'; vertex: Vertex }
  | { type: 'delete' | 'toggleClosed' | 'reverse' }

export function createInitialState(): ContourState {
  const state = createRectangleState()
  return { ...state, selection: { kind: 'vertex', id: state.selectedId } }
}

export function canClose(state: Pick<ContourState, 'vertices' | 'segments'>): boolean {
  return state.vertices.length >= 3 || state.segments.some((segment) => segment.kind === 'arc')
}

function acceptGeometry(previous: ContourState, candidate: ContourState): ContourState {
  const vertices = new Map(candidate.vertices.map((vertex) => [vertex.id, vertex]))
  for (const segment of candidate.segments) {
    if (segment.kind !== 'arc') continue
    const result = arcThrough(
      vertices.get(segment.startId)!,
      vertices.get(segment.endId)!,
      segment.through,
    )
    if (!result.ok) return { ...previous, error: result.error }
  }
  return { ...candidate, closed: candidate.closed && canClose(candidate), error: '' }
}

export function contourReducer(state: ContourState, action: ContourAction): ContourState {
  const next = reduceContour(state, action)
  if (
    next.vertices === state.vertices &&
    next.segments === state.segments &&
    next.markers === state.markers &&
    next.formulas === state.formulas &&
    next.appearance === state.appearance &&
    next.closed === state.closed &&
    next.snap === state.snap &&
    next.grid === state.grid &&
    next.handles === state.handles &&
    next.viewport === state.viewport &&
    next.axes === state.axes
  )
    return next
  if (!canProjectScene(next, next.viewport))
    return { ...state, error: '当前数值无法在此视图比例下安全绘制，请减小倍率或调整视图。' }
  const capacity = projectCapacityError(next)
  return capacity ? { ...state, error: capacity } : next
}

function reduceContour(state: ContourState, action: ContourAction): ContourState {
  switch (action.type) {
    case 'loadProject':
      return action.state
    case 'select':
      return state.vertices.some((p) => p.id === action.id)
        ? {
            ...state,
            selectedId: action.id,
            selection: { kind: 'vertex', id: action.id },
            error: '',
          }
        : state
    case 'selectSegment':
      return state.segments.some((s) => s.id === action.id)
        ? {
            ...state,
            selectedSegmentId: action.id,
            selection: { kind: 'segment', id: action.id },
            error: '',
          }
        : state
    case 'move':
      if (!isValidPoint(action.point)) return state
      return acceptGeometry(state, {
        ...state,
        vertices: state.vertices.map((p) => (p.id === action.id ? { ...p, ...action.point } : p)),
      })
    case 'moveThrough':
      return acceptGeometry(state, {
        ...state,
        segments: state.segments.map((s) =>
          s.id === action.id && s.kind === 'arc' ? { ...s, through: action.point } : s,
        ),
      })
    case 'setArc':
      return acceptGeometry(state, {
        ...state,
        segments: state.segments.map((s) =>
          s.id === action.id ? { ...s, kind: 'arc', through: action.through } : s,
        ),
      })
    case 'setLine':
      return acceptGeometry(state, {
        ...state,
        segments: state.segments.map((s) =>
          s.id === action.id
            ? {
                id: s.id,
                kind: 'line',
                startId: s.startId,
                endId: s.endId,
                ...(s.style ? { style: s.style } : {}),
                ...(s.label ? { label: s.label } : {}),
              }
            : s,
        ),
      })
    case 'add': {
      if (!isValidPoint(action.vertex) || state.vertices.some((p) => p.id === action.vertex.id))
        return state
      const closing = state.segments[state.segments.length - 1]
      return acceptGeometry(state, {
        ...state,
        vertices: [...state.vertices, action.vertex],
        selectedId: action.vertex.id,
        selection: { kind: 'vertex', id: action.vertex.id },
        segments: [
          ...state.segments.slice(0, -1),
          { id: closing.id, kind: 'line', startId: closing.startId, endId: action.vertex.id },
          {
            id: `edge-${action.vertex.id}`,
            kind: 'line',
            startId: action.vertex.id,
            endId: state.vertices[0].id,
          },
        ],
      })
    }
    case 'delete': {
      if (state.vertices.length <= 2) return state
      const index = state.vertices.findIndex((p) => p.id === state.selectedId)
      if (index < 0) return state
      const incoming = state.segments[(index + state.segments.length - 1) % state.segments.length]
      const outgoing = state.segments[index]
      const vertices = state.vertices.filter((p) => p.id !== state.selectedId)
      const segments = state.segments
        .filter((s) => s.id !== outgoing.id)
        .map((s): PathSegment =>
          s.id === incoming.id
            ? { id: s.id, kind: 'line', startId: s.startId, endId: outgoing.endId }
            : s,
        )
      return acceptGeometry(state, {
        ...state,
        vertices,
        segments,
        selectedId: vertices[Math.min(index, vertices.length - 1)].id,
        selection: { kind: 'vertex', id: vertices[Math.min(index, vertices.length - 1)].id },
        selectedSegmentId:
          state.selectedSegmentId === outgoing.id ? incoming.id : state.selectedSegmentId,
      })
    }
    case 'toggleClosed':
      return canClose(state) ? { ...state, closed: !state.closed, error: '' } : state
    case 'reverse': {
      const vertices = [...state.vertices].reverse()
      // n-1 active edges reverse first; the retained closing edge remains last.
      const segments = [
        ...state.segments.slice(0, -1).reverse(),
        state.segments[state.segments.length - 1],
      ].map((segment) => ({ ...segment, startId: segment.endId, endId: segment.startId }))
      return { ...state, vertices, segments, error: '' }
    }
    default:
      return workspaceReducer(state, action)
  }
}
