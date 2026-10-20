import { arcThrough, pointOnArc, tangentOnArc, type CircularArc } from '../../lib/arc'
import { toSvg, type SvgPoint } from '../../lib/geometry'
import type { ContourState, PathSegment } from './model'

export interface SegmentGeometry {
  segment: PathSegment
  path: string
  command: string
  arc?: CircularArc
  arrow?: { point: SvgPoint; tangent: SvgPoint }
}

export function buildContourGeometry(state: ContourState): {
  path: string
  segments: SegmentGeometry[]
} {
  const vertices = new Map(state.vertices.map((vertex) => [vertex.id, vertex]))
  const active = state.closed ? state.segments : state.segments.slice(0, -1)
  const segments = active.map((segment): SegmentGeometry => {
    const start = vertices.get(segment.startId)!
    const end = vertices.get(segment.endId)!
    const p = toSvg(start, state.viewport)
    const q = toSvg(end, state.viewport)
    const move = `M ${p.x} ${p.y}`
    if (segment.kind === 'arc') {
      const result = arcThrough(start, end, segment.through)
      if (!result.ok) throw new Error(`Invalid contour invariant: ${result.error}`)
      const arc = result.arc
      const rx = arc.radius * state.viewport.scaleX
      const ry = arc.radius * state.viewport.scaleY
      const command = `A ${rx} ${ry} 0 ${Math.abs(arc.sweep) > Math.PI ? 1 : 0} ${arc.sweep > 0 ? 0 : 1} ${q.x} ${q.y}`
      const tangent = tangentOnArc(arc, 0.5)
      const tx = tangent.re * state.viewport.scaleX,
        ty = -tangent.im * state.viewport.scaleY
      const length = Math.hypot(tx, ty)
      return {
        segment,
        arc,
        command,
        path: `${move} ${command}`,
        arrow:
          Math.min(rx, ry) * Math.abs(arc.sweep) >= 20
            ? {
                point: toSvg(pointOnArc(arc, 0.5), state.viewport),
                tangent: { x: tx / length, y: ty / length },
              }
            : undefined,
      }
    }
    const scale = Math.max(1, Math.abs(p.x), Math.abs(p.y), Math.abs(q.x), Math.abs(q.y))
    const dx = q.x / scale - p.x / scale
    const dy = q.y / scale - p.y / scale
    const length = Math.hypot(dx, dy)
    const command = `L ${q.x} ${q.y}`
    return {
      segment,
      command,
      path: `${move} ${command}`,
      arrow:
        length > 0 && length >= 20 / scale
          ? {
              point: { x: p.x / 2 + q.x / 2, y: p.y / 2 + q.y / 2 },
              tangent: { x: dx / length, y: dy / length },
            }
          : undefined,
    }
  })
  const start = toSvg(state.vertices[0], state.viewport)
  return {
    path: `M ${start.x} ${start.y} ${segments.map((s) => s.command).join(' ')}${state.closed ? ' Z' : ''}`,
    segments,
  }
}
