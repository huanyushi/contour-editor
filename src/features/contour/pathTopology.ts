import type { ContourState, PathSegment, Vertex } from './model'

type PathState = Pick<ContourState, 'vertices' | 'segments'>

/** Components are non-branching directed chains, with shared stable endpoint IDs. */
export function validTopology(vertices: Vertex[], segments: PathSegment[]): boolean {
  const ids = new Set(vertices.map((v) => v.id))
  const starts = new Set<string>(),
    ends = new Set<string>()
  for (const s of segments) {
    if (
      !ids.has(s.startId) ||
      !ids.has(s.endId) ||
      s.startId === s.endId ||
      starts.has(s.startId) ||
      ends.has(s.endId)
    )
      return false
    starts.add(s.startId)
    ends.add(s.endId)
  }
  if (isSingleCycle({ vertices, segments })) return true
  const outgoing = new Map(segments.map((s) => [s.startId, s.endId]))
  const complete = new Set<string>()
  for (const vertex of vertices) {
    const path = new Set<string>()
    let id = vertex.id
    while (!complete.has(id)) {
      if (path.has(id)) return false
      path.add(id)
      const next = outgoing.get(id)
      if (next === undefined) break
      id = next
    }
    for (const visited of path) complete.add(visited)
  }
  return true
}

export function isSingleCycle(state: PathState): boolean {
  if (state.vertices.length < 2 || state.segments.length !== state.vertices.length) return false
  const outgoing = new Map(state.segments.map((s) => [s.startId, s]))
  const start = state.vertices[0].id
  let id = start
  const visited = new Set<string>()
  while (!visited.has(id)) {
    visited.add(id)
    const edge = outgoing.get(id)
    if (!edge) return false
    id = edge.endId
  }
  return id === start && visited.size === state.vertices.length
}

export function singleChainEnds(state: PathState): { startId: string; endId: string } | null {
  if (state.vertices.length < 2 || state.segments.length !== state.vertices.length - 1) return null
  const incoming = new Set(state.segments.map((s) => s.endId))
  const start = state.vertices.find((v) => !incoming.has(v.id))
  if (!start) return null
  const outgoing = new Map(state.segments.map((s) => [s.startId, s]))
  const visited = new Set<string>()
  let id = start.id
  while (!visited.has(id)) {
    visited.add(id)
    const edge = outgoing.get(id)
    if (!edge)
      return visited.size === state.vertices.length ? { startId: start.id, endId: id } : null
    id = edge.endId
  }
  return null
}

/** Legacy open paths retain their last closing edge. Cut paths contain only actual surviving edges. */
export function activeSegments(
  state: Pick<ContourState, 'vertices' | 'segments' | 'closed'>,
): PathSegment[] {
  return !state.closed && isSingleCycle(state) ? state.segments.slice(0, -1) : state.segments
}
