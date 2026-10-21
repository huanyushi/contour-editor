import type { ComplexPoint } from '../../lib/geometry'
import type { ResolvedScene } from './resolvedScene'

export interface AvoidanceRadiusHandle {
  avoidanceId: string
  end: 'entry' | 'exit'
  point: ComplexPoint
  center: ComplexPoint
}

/** Only visible generated arcs contribute handles, not retained hidden bindings. */
export function avoidanceRadiusHandles(scene: ResolvedScene): AvoidanceRadiusHandle[] {
  return [...scene.contourSegments, ...scene.connectionSegments].flatMap((segment) => {
    const origin = segment.origin
    if (origin.kind !== 'avoidance' || origin.part !== 'arc' || !segment.resolvedArc) return []
    const center = segment.resolvedArc.center
    return [
      {
        avoidanceId: origin.avoidanceId,
        end: 'entry',
        point: scene.points.get(segment.startId)!,
        center,
      },
      {
        avoidanceId: origin.avoidanceId,
        end: 'exit',
        point: scene.points.get(segment.endId)!,
        center,
      },
    ]
  })
}
