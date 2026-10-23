import { arcThrough, type CircularArc } from '../../../lib/arc'
import { toSvg, type SvgPoint } from '../../../lib/geometry'
import type { LabelSettings } from '../appearance'
import type { ContourState, PathSegment } from '../model'
import type { ResolvedScene } from './resolvedScene'
import { resolvedScene } from './sceneObjects'
import { arrowObjectId, buildPathArrow, type PathArrowGeometry } from './arrowGeometry'

export interface SegmentGeometry {
  segment: PathSegment
  path: string
  command: string
  arc?: CircularArc
  arrow?: PathArrowGeometry
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
      return { segment, arc, command, path: `${move} ${command}` }
    }
    const command = `L ${q.x} ${q.y}`
    return { segment, command, path: `${move} ${command}` }
  })
  const byId = new Map(segments.map((geometry) => [geometry.segment.id, geometry]))
  const objects = new Map<string, typeof all>()
  for (const segment of all) {
    const key = arrowObjectId(segment)
    const chain = objects.get(key) ?? []
    chain.push(segment)
    objects.set(key, chain)
  }
  for (const chain of objects.values()) {
    const first = chain[0]
    const result = buildPathArrow(
      chain,
      scene.points,
      viewport,
      { ...view.appearance.stroke, ...first.style },
      first.arrowPosition ?? 0.5,
    )
    if (result) byId.get(result.segmentId)!.arrow = result.arrow
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
