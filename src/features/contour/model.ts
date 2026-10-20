import { isValidPoint, type ComplexPoint } from '../../lib/geometry'
import { arcThrough } from '../../lib/arc'
import { projectCapacityError } from '../project/format'
import { canProjectScene } from './sceneView'
import type { LabelSettings, PointStyle, StrokeStyle } from './appearance'
import { workspaceReducer, type WorkspaceAction, type WorkspaceState } from './workspace'
import { createRectangleState } from './templates'
import { activeSegments, isSingleCycle, singleChainEnds } from './pathTopology'
import { deleteItems, selectionReducer, type SelectionAction } from './selectionModel'
import { translateSelection } from './selectionTransform'
import { findPoint, findSegment, scenePoints, sceneSegments } from './sceneObjects'

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
  /** Complete paths retain a closing edge while open; cut components contain only actual edges. */
  segments: PathSegment[]
  selectedId: string
  selectedSegmentId: string
  closed: boolean
  error: string
}

export type ContourAction =
  | { type: 'loadProject'; state: ContourState }
  | WorkspaceAction
  | SelectionAction
  | { type: 'translateSelection'; from: ContourState; delta: ComplexPoint }
  | { type: 'select' | 'selectSegment'; id: string }
  | { type: 'move' | 'moveThrough'; id: string; point: ComplexPoint }
  | { type: 'setArc'; id: string; through: ComplexPoint }
  | { type: 'setLine'; id: string }
  | { type: 'add'; vertex: Vertex }
  | { type: 'connectPoints'; startId: string; endId: string }
  | { type: 'deleteSegment'; id: string }
  | { type: 'delete' | 'toggleClosed' | 'reverse' }

export function createInitialState(): ContourState {
  const state = createRectangleState()
  return { ...state, selection: { kind: 'vertex', id: state.selectedId } }
}

export function canClose(state: Pick<ContourState, 'vertices' | 'segments'>): boolean {
  return (
    (isSingleCycle(state) || singleChainEnds(state) !== null) &&
    (state.vertices.length >= 3 || state.segments.some((segment) => segment.kind === 'arc'))
  )
}

function lineFactory(state: ContourState, extraId = '') {
  const used = new Set(
    [...scenePoints(state), ...sceneSegments(state), ...state.formulas].map((o) => o.id),
  )
  used.add(extraId)
  return (startId: string, endId: string, preferred: string): LineSegment => {
    let id = preferred
    for (let index = 0; used.has(id) || id.length > 80; index++) id = `edge-new-${index}`
    used.add(id)
    return { id, kind: 'line', startId, endId }
  }
}

function updateSegment(
  state: ContourState,
  id: string,
  update: (segment: PathSegment) => PathSegment,
): ContourState {
  const key = state.connections.some((s) => s.id === id) ? 'connections' : 'segments'
  return { ...state, [key]: state[key].map((s) => (s.id === id ? update(s) : s)) }
}

function acceptGeometry(previous: ContourState, candidate: ContourState): ContourState {
  const vertices = new Map(scenePoints(candidate).map((vertex) => [vertex.id, vertex]))
  const lines = new Set(
    candidate.segments
      .filter((s) => s.kind === 'line')
      .map((s) => [s.startId, s.endId].sort().join(':')),
  )
  for (const segment of candidate.connections) {
    const start = vertices.get(segment.startId),
      end = vertices.get(segment.endId)
    if (!start || !end || start.id === end.id || (start.re === end.re && start.im === end.im))
      return { ...previous, error: '独立路径段需要两个位置不同的现有端点。' }
    if (segment.kind === 'line') {
      const pair = [segment.startId, segment.endId].sort().join(':')
      if (lines.has(pair)) return { ...previous, error: '这两个端点之间已存在直线段。' }
      lines.add(pair)
    }
  }
  for (const segment of sceneSegments(candidate)) {
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
    next.connections === state.connections &&
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
    case 'translateSelection': {
      const moved = translateSelection(action.from, action.delta)
      if (moved.error) return { ...state, error: moved.error }
      return acceptGeometry(state, {
        ...state,
        vertices: moved.vertices,
        segments: moved.segments,
        connections: moved.connections,
        markers: moved.markers,
        formulas: moved.formulas,
      })
    }
    case 'selectMany':
    case 'toggleSelection':
    case 'clearSelection':
    case 'deleteSelection':
    case 'selectionStyle':
      return selectionReducer(state, action)
    case 'select':
      return state.vertices.some((p) => p.id === action.id)
        ? {
            ...state,
            selectedId: action.id,
            selection: { kind: 'vertex', id: action.id },
            selectionSource: 'click',
            error: '',
          }
        : state
    case 'selectSegment':
      return findSegment(state, action.id)
        ? {
            ...state,
            selectedSegmentId: action.id,
            selection: { kind: 'segment', id: action.id },
            selectionSource: 'click',
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
      return acceptGeometry(
        state,
        updateSegment(state, action.id, (s) =>
          s.kind === 'arc' ? { ...s, through: action.point } : s,
        ),
      )
    case 'setArc':
      if (!findSegment(state, action.id))
        return { ...state, error: '请先选择一条路径段，再指定圆弧经过点。' }
      return acceptGeometry(
        state,
        updateSegment(state, action.id, (s) => ({ ...s, kind: 'arc', through: action.through })),
      )
    case 'setLine':
      return acceptGeometry(
        state,
        updateSegment(state, action.id, (s) => ({
          id: s.id,
          kind: 'line',
          startId: s.startId,
          endId: s.endId,
          ...(s.style ? { style: s.style } : {}),
          ...(s.label ? { label: s.label } : {}),
        })),
      )
    case 'connectPoints': {
      const start = findPoint(state, action.startId),
        end = findPoint(state, action.endId)
      if (!start || !end || start.id === end.id || (start.re === end.re && start.im === end.im))
        return state
      const existing = sceneSegments(state).find(
        (s) =>
          s.kind === 'line' &&
          ((s.startId === start.id && s.endId === end.id) ||
            (s.startId === end.id && s.endId === start.id)),
      )
      if (existing) {
        const active = activeSegments(state)
        // Materialize a retained closing edge without closing or filling the contour.
        const next =
          !active.includes(existing) && !state.connections.includes(existing)
            ? { ...state, segments: active, connections: [...state.connections, existing] }
            : state
        return reduceContour(next, { type: 'selectSegment', id: existing.id })
      }
      const connection = lineFactory(state)(start.id, end.id, 'connection-0')
      return {
        ...state,
        connections: [...state.connections, connection],
        selectedSegmentId: connection.id,
        selection: { kind: 'segment', id: connection.id },
        selectionSource: 'click',
        error: '',
      }
    }
    case 'add': {
      if (!isValidPoint(action.vertex)) return state
      const existing = scenePoints(state).find(
        (p) => p.re === action.vertex.re && p.im === action.vertex.im,
      )
      if (existing)
        return workspaceReducer(state, {
          type: 'selectObject',
          selection: {
            kind: state.vertices.some((v) => v.id === existing.id) ? 'vertex' : 'marker',
            id: existing.id,
          },
        })
      if (
        !/^[a-zA-Z0-9_-]{1,80}$/.test(action.vertex.id) ||
        [...scenePoints(state), ...sceneSegments(state), ...state.formulas].some(
          (p) => p.id === action.vertex.id,
        )
      )
        return state
      const line = lineFactory(state, action.vertex.id)
      const closing = isSingleCycle(state) ? state.segments[state.segments.length - 1] : undefined
      const vertices = [...state.vertices, action.vertex]
      let segments = state.segments
      let added: PathSegment | undefined
      if (closing) {
        added = { id: closing.id, kind: 'line', startId: closing.startId, endId: action.vertex.id }
        segments = [
          ...segments.slice(0, -1),
          added,
          line(action.vertex.id, closing.endId, `edge-${action.vertex.id}`),
        ]
      } else if (state.vertices.length === 1) {
        added = line(state.vertices[0].id, action.vertex.id, `edge-${state.vertices[0].id}`)
        segments = [added, line(action.vertex.id, state.vertices[0].id, `edge-${action.vertex.id}`)]
      } else if (state.vertices.length) {
        const outgoing = new Set(activeSegments(state).map((s) => s.startId))
        const end =
          state.vertices.find((v) => v.id === state.selectedId && !outgoing.has(v.id)) ??
          [...state.vertices].reverse().find((v) => !outgoing.has(v.id))
        if (end) {
          added = line(end.id, action.vertex.id, `edge-${action.vertex.id}`)
          segments = [...segments, added]
        }
      }
      return acceptGeometry(state, {
        ...state,
        vertices,
        selectedId: action.vertex.id,
        selectedSegmentId: added?.id ?? state.selectedSegmentId,
        selection: { kind: 'vertex', id: action.vertex.id },
        selectionSource: 'click',
        segments,
      })
    }
    case 'delete':
      return deleteItems(state, [{ kind: 'vertex', id: state.selectedId }])
    case 'deleteSegment':
      return deleteItems(state, [{ kind: 'segment', id: action.id }])
    case 'toggleClosed': {
      if (!canClose(state)) return state
      if (isSingleCycle(state)) return { ...state, closed: !state.closed, error: '' }
      const ends = singleChainEnds(state)!
      const connection = state.connections.find(
        (s) =>
          s.kind === 'line' &&
          ((s.startId === ends.endId && s.endId === ends.startId) ||
            (s.startId === ends.startId && s.endId === ends.endId)),
      )
      const closing = connection
        ? connection.startId === ends.endId
          ? connection
          : { ...connection, startId: ends.endId, endId: ends.startId }
        : lineFactory(state)(ends.endId, ends.startId, 'edge-close')
      return acceptGeometry(state, {
        ...state,
        segments: [...state.segments, closing],
        connections: connection
          ? state.connections.filter((s) => s.id !== connection.id)
          : state.connections,
        closed: true,
        error: '',
      })
    }
    case 'reverse': {
      const vertices = [...state.vertices].reverse()
      // n-1 active edges reverse first; the retained closing edge remains last.
      const segments = (
        isSingleCycle(state)
          ? [...state.segments.slice(0, -1).reverse(), state.segments[state.segments.length - 1]]
          : [...state.segments].reverse()
      ).map((segment) => ({ ...segment, startId: segment.endId, endId: segment.startId }))
      return { ...state, vertices, segments, error: '' }
    }
    default:
      return action.type === 'moveObject'
        ? acceptGeometry(state, workspaceReducer(state, action))
        : workspaceReducer(state, action)
  }
}
