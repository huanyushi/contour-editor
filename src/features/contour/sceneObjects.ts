import type { ContourState, PathSegment, Vertex } from './model'
import { activeSegments } from './pathTopology'

/** Formulas have anchors, but are not connectable scene points. */
export function scenePoints(state: ContourState): Vertex[] {
  return [...state.vertices, ...state.markers]
}

export function findPoint(state: ContourState, id: string): Vertex | undefined {
  return (
    state.vertices.find((point) => point.id === id) ??
    state.markers.find((point) => point.id === id)
  )
}

/** Includes the contour's retained closing edge, even while the contour is open. */
export function sceneSegments(state: ContourState): PathSegment[] {
  return [...state.segments, ...state.connections]
}

export function visibleSceneSegments(state: ContourState): PathSegment[] {
  return [...activeSegments(state), ...state.connections]
}

export function findSegment(state: ContourState, id: string): PathSegment | undefined {
  return (
    state.segments.find((segment) => segment.id === id) ??
    state.connections.find((segment) => segment.id === id)
  )
}
