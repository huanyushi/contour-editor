import { arcThrough, pointOnArc, tangentOnArc, type CircularArc } from '../../lib/arc'
import { toSvg, type SvgPoint } from '../../lib/geometry'
import type { LabelSettings } from './appearance'
import type { ContourState, PathSegment } from './model'
import type { ResolvedScene } from './resolvedScene'
import { resolvedScene } from './sceneObjects'

export interface SegmentGeometry {
  segment: PathSegment
  path: string
  command: string
  arc?: CircularArc
  arrow?: { point: SvgPoint; tangent: SvgPoint }
}

export interface ProjectedSegmentLabel {
  target: { kind: 'segment'; id: string; part: 'label' }
  point: SvgPoint
  value: LabelSettings
}

export interface ContourGeometry {
  path: string
  segments: SegmentGeometry[]
  labels: ProjectedSegmentLabel[]
}

export function buildContourGeometry(state: ContourState): ContourGeometry {
  return buildSceneGeometry(resolvedScene(state), state)
}

export function buildSceneGeometry(
  scene: ResolvedScene,
  view: Pick<ContourState, 'viewport' | 'closed' | 'appearance'>,
): ContourGeometry {
  const { viewport } = view
  const all = [...scene.contourSegments, ...scene.connectionSegments]
  const measures = new Map<
    string,
    {
      length: number
      visibleLength: number
      arrowAt: (t: number) => NonNullable<SegmentGeometry['arrow']>
    }
  >()
  const segments = all.map((segment): SegmentGeometry => {
    const start = scene.points.get(segment.startId)!
    const end = scene.points.get(segment.endId)!
    const p = toSvg(start, viewport)
    const q = toSvg(end, viewport)
    const move = `M ${p.x} ${p.y}`
    if (segment.kind === 'arc') {
      const result = arcThrough(start, end, segment.through)
      if (!result.ok) throw new Error(`Invalid contour invariant: ${result.error}`)
      const arc = segment.resolvedArc ?? result.arc
      const rx = arc.radius * viewport.scaleX
      const ry = arc.radius * viewport.scaleY
      const command = `A ${rx} ${ry} 0 ${Math.abs(arc.sweep) > Math.PI ? 1 : 0} ${arc.sweep > 0 ? 0 : 1} ${q.x} ${q.y}`
      measures.set(segment.id, {
        length: arc.radius * Math.abs(arc.sweep),
        visibleLength: Math.min(rx, ry) * Math.abs(arc.sweep),
        arrowAt: (t) => {
          const tangent = tangentOnArc(arc, t)
          const tx = tangent.re * viewport.scaleX
          const ty = -tangent.im * viewport.scaleY
          const length = Math.hypot(tx, ty)
          return {
            point: toSvg(pointOnArc(arc, t), viewport),
            tangent: { x: tx / length, y: ty / length },
          }
        },
      })
      return { segment, arc, command, path: `${move} ${command}` }
    }
    // Normalize before subtracting: opposite finite screen coordinates can
    // have an overflowing difference, while their direction remains drawable.
    const scale = Math.max(1, Math.abs(p.x), Math.abs(p.y), Math.abs(q.x), Math.abs(q.y))
    const dx = q.x / scale - p.x / scale
    const dy = q.y / scale - p.y / scale
    const length = Math.hypot(dx, dy)
    measures.set(segment.id, {
      length: Math.hypot(end.re - start.re, end.im - start.im),
      visibleLength: length * scale,
      arrowAt: (t) => ({
        point: { x: p.x * (1 - t) + q.x * t, y: p.y * (1 - t) + q.y * t },
        tangent: { x: dx / length, y: dy / length },
      }),
    })
    const command = `L ${q.x} ${q.y}`
    return { segment, command, path: `${move} ${command}` }
  })
  const byId = new Map(segments.map((geometry) => [geometry.segment.id, geometry]))
  for (const chain of scene.chains.values()) {
    let remaining = chain.reduce((sum, part) => sum + measures.get(part.id)!.length, 0) / 2
    const visibleLength = chain.reduce((sum, part) => sum + measures.get(part.id)!.visibleLength, 0)
    // Compute the default on the full logical chain, without moving it when
    // another part overrides its arrows. An overridden recipient opts out.
    for (const part of chain) {
      const measure = measures.get(part.id)!
      if (remaining <= measure.length) {
        if (visibleLength >= 20 && measure.length > 0 && part.arrowOverride === undefined)
          byId.get(part.id)!.arrow = measure.arrowAt(remaining / measure.length)
        break
      }
      remaining -= measure.length
    }
    for (const part of chain) {
      const measure = measures.get(part.id)!
      if (part.arrowOverride === true && measure.visibleLength >= 20 && measure.length > 0)
        byId.get(part.id)!.arrow = measure.arrowAt(0.5)
    }
  }
  const contourIds = new Set(scene.contourSegments.map((segment) => segment.id))
  const contour = segments.filter((geometry) => contourIds.has(geometry.segment.id))
  const outgoing = new Map(contour.map((geometry) => [geometry.segment.startId, geometry]))
  const incoming = new Set(scene.contourSegments.map((segment) => segment.endId))
  const visited = new Set<string>()
  const paths: string[] = []
  const trace = (first: SegmentGeometry) => {
    const start = toSvg(scene.points.get(first.segment.startId)!, viewport)
    const commands: string[] = []
    let current: SegmentGeometry | undefined = first
    let endId = first.segment.startId
    while (current && !visited.has(current.segment.id)) {
      visited.add(current.segment.id)
      commands.push(current.command)
      endId = current.segment.endId
      current = outgoing.get(endId)
    }
    paths.push(
      `M ${start.x} ${start.y} ${commands.join(' ')}${view.closed && endId === first.segment.startId ? ' Z' : ''}`,
    )
  }
  for (const geometry of contour) if (!incoming.has(geometry.segment.startId)) trace(geometry)
  for (const geometry of contour) if (!visited.has(geometry.segment.id)) trace(geometry)
  return {
    path: paths.join(' '),
    segments,
    labels: scene.labels.map(({ target, anchor, value }) => ({
      target,
      point: toSvg(anchor, viewport),
      value,
    })),
  }
}
