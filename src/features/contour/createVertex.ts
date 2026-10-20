import type { ComplexPoint } from '../../lib/geometry'
import type { ContourState, Vertex } from './model'

let nextVertexId = 0

// Restored projects can contain IDs from a previous session, including retained edges.
export function createVertex(point: ComplexPoint, state: ContourState): Vertex {
  const occupied = new Set(
    [...state.vertices, ...state.segments, ...state.markers, ...state.formulas].map(
      (item) => item.id,
    ),
  )
  let id: string
  do {
    id = `vertex-${nextVertexId++}`
  } while (occupied.has(id) || occupied.has(`edge-${id}`))
  return { ...point, id }
}
