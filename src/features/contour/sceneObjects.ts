import type { ContourState, PathSegment, Vertex } from './model'
import { activeSegments } from './pathTopology'
import {
  resolveScene,
  type ResolvedScene,
  type ResolvedSegment,
  type SegmentOrigin,
} from './resolvedScene'

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

const resolutionCache = new WeakMap<ContourState, ResolvedScene>()

/** Only accepted immutable states belong here; candidates should use resolveScene. */
export function resolvedScene(state: ContourState): ResolvedScene {
  const cached = resolutionCache.get(state)
  if (cached) return cached
  const result = resolveScene(state)
  if (!result.ok) throw new Error(`resolvedScene invariant：${result.error}`)
  resolutionCache.set(state, result.scene)
  return result.scene
}

export function findResolvedPoint(state: ContourState, id: string): Vertex | undefined {
  return resolvedScene(state).points.get(id)
}

export function findResolvedSegment(state: ContourState, id: string): ResolvedSegment | undefined {
  const scene = resolvedScene(state)
  return (
    scene.contourSegments.find((segment) => segment.id === id) ??
    scene.connectionSegments.find((segment) => segment.id === id)
  )
}

/** Includes retained source IDs and ownership of omitted zero-length connectors. */
export function segmentOrigin(state: ContourState, id: string): SegmentOrigin | undefined {
  return resolvedScene(state).origins.get(id)
}
