import { arcExtrema, arcThrough } from '../../../lib/arc'
import type { ContourState } from '../model'
import { sourceEdge } from './avoidanceConstruction'
import type { ComplexPoint } from '../../../lib/geometry'

/** Mathematical source scale only: never labels, generated detours or viewport zoom. */
export function defaultAvoidanceRadius(state: ContourState): number {
  const existing = state.avoidances.find(
    (a) => a.kind !== 'bank-clearance' && Number.isFinite(a.radius) && a.radius > 0,
  )
  if (existing) return existing.radius
  const points: ComplexPoint[] = [...state.vertices]
  for (const source of [...state.segments, ...state.connections]) {
    const edge = sourceEdge(state, source)
    points.push(edge.start, edge.end)
    if (edge.kind === 'arc') {
      const fitted = arcThrough(edge.start, edge.end, edge.through)
      if (fitted.ok) points.push(...arcExtrema(fitted.arc))
    }
  }
  if (!points.length) return 0.4
  const span = Math.hypot(
    Math.max(...points.map((p) => p.re)) - Math.min(...points.map((p) => p.re)),
    Math.max(...points.map((p) => p.im)) - Math.min(...points.map((p) => p.im)),
  )
  const radius = Number((span / 20).toPrecision(1))
  return Number.isFinite(radius) && radius > 0 ? radius : 0.4
}
