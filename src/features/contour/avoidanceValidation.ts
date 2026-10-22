import { arcExtrema } from '../../lib/arc'
import { constructAvoidances } from './avoidanceConstructionTable'
import { edgeArcFrame } from '../../lib/edgeArcFrame'
import type { ComplexPoint } from '../../lib/geometry'
import { intersectEdges, type GeometricEdge } from '../../lib/geometryIntersections'
import {
  resolveScene,
  type ResolvedSegment,
  type SceneDocument,
  type SceneResolution,
} from './resolvedScene'

const EPSILON = 1e-9

interface BoxedEdge {
  segment: ResolvedSegment
  edge: GeometricEdge
  minRe: number
  maxRe: number
  minIm: number
  maxIm: number
}

export function validateAvoidances(document: SceneDocument): SceneResolution {
  const resolution = resolveScene(document)
  if (!resolution.ok) return resolution
  const { scene } = resolution
  const footprints = new Map<string, { id: string; start: number; end: number }[]>()
  // These are source constraints, including on retained hidden closing edges.
  const table = constructAvoidances(document)
  if (!table.ok) return table
  for (const parent of table.value.parents.values()) {
    for (const interval of parent.occupancy) {
      const group = footprints.get(interval.sourceSegmentId) ?? []
      group.push({ id: parent.id, start: interval.startT, end: interval.endT })
      footprints.set(interval.sourceSegmentId, group)
    }
  }
  for (const child of table.value.clearances.values()) {
    for (const cut of child.cuts) {
      const key = `两岸 ${child.parentAvoidanceId}:${cut.bank}`
      const group = footprints.get(key) ?? []
      group.push({ id: child.id, start: cut.startT, end: cut.endT })
      footprints.set(key, group)
    }
  }
  for (const [sourceId, group] of footprints) {
    const tolerance = EPSILON
    group.sort((a, b) => a.start - b.start)
    for (let index = 1; index < group.length; index++) {
      const previous = group[index - 1],
        current = group[index]
      if (current.start - previous.end <= tolerance)
        return {
          ok: false,
          error: `源路径 ${sourceId} 上的绕行 ${previous.id} 与 ${current.id} 范围重叠或过于接近，请减小半径或移动奇点。`,
        }
    }
  }

  const segments = [...scene.contourSegments, ...scene.connectionSegments]
  if (!segments.some((s) => s.origin.kind === 'avoidance')) return resolution
  const boxes: BoxedEdge[] = []
  for (const segment of segments) {
    const start = scene.points.get(segment.startId)!,
      end = scene.points.get(segment.endId)!
    const edge: GeometricEdge =
      segment.kind === 'arc'
        ? { kind: 'arc', start, end, through: segment.through }
        : { kind: 'line', start, end }
    try {
      boxes.push({ segment, edge, ...edgeBounds(edge) })
    } catch (error) {
      return numericalFailure(describe(segment), error)
    }
  }
  boxes.sort((a, b) => a.minRe - b.minRe)

  // Only generated parts query the boxes; ordinary-source pairs never reach the
  // exact intersector. Deduplicate generated/generated pairs by their sorted index.
  for (let index = 0; index < boxes.length; index++) {
    const first = boxes[index]
    if (first.segment.origin.kind !== 'avoidance') continue
    for (let other = 0; other < boxes.length; other++) {
      const second = boxes[other]
      if (second.minRe > first.maxRe) break
      if (other === index || (second.segment.origin.kind === 'avoidance' && other < index)) continue
      if (second.maxRe < first.minRe || second.minIm > first.maxIm || second.maxIm < first.minIm)
        continue
      let intersection
      try {
        intersection = intersectEdges(first.edge, second.edge)
      } catch (error) {
        return numericalFailure(`${describe(first.segment)} 与 ${describe(second.segment)}`, error)
      }
      if (intersection.kind === 'none') continue
      if (intersection.kind === 'points') {
        const sharedIds = [first.segment.startId, first.segment.endId].filter(
          (id) => id === second.segment.startId || id === second.segment.endId,
        )
        const tolerance = contactTolerance(first.edge, second.edge)
        if (
          intersection.points.every((point) =>
            sharedIds.some((id) => {
              const joint = scene.points.get(id)!
              return Math.hypot(point.re - joint.re, point.im - joint.im) <= tolerance
            }),
          )
        )
          continue
      }
      // An overlap is never exempt, even if both ends have shared IDs.
      return {
        ok: false,
        error: `${describe(first.segment)} 与 ${describe(second.segment)} 相交、相切或重叠，请调整绕行半径或奇点位置。`,
      }
    }
  }
  return resolution
}

function numericalFailure(context: string, error: unknown): SceneResolution {
  return {
    ok: false,
    error: `${context} 的数值安全检查失败，无法可靠判断相交；请调整坐标尺度或绕行参数。${error instanceof Error ? error.message : ''}`,
  }
}

function describe(segment: ResolvedSegment): string {
  const origin = segment.origin
  return origin.kind === 'avoidance'
    ? `绕行 ${origin.avoidanceId}（源路径 ${origin.sourceSegmentId}，部件 ${origin.part}）`
    : `源路径 ${origin.sourceSegmentId}（部件 ${segment.id}）`
}

function edgeBounds(edge: GeometricEdge) {
  let points = [edge.start, edge.end]
  if (edge.kind === 'arc') {
    const { origin, scale, arc } = edgeArcFrame(edge)
    points = [
      ...points,
      ...arcExtrema(arc).map((p) => ({
        re: origin.re + p.re * scale,
        im: origin.im + p.im * scale,
      })),
    ]
  }
  const minRe = Math.min(...points.map((p) => p.re)),
    maxRe = Math.max(...points.map((p) => p.re))
  const minIm = Math.min(...points.map((p) => p.im)),
    maxIm = Math.max(...points.map((p) => p.im))
  const padding = EPSILON * Math.max(maxRe - minRe, maxIm - minIm) + roundoff(points)
  const bounds = {
    minRe: minRe - padding,
    maxRe: maxRe + padding,
    minIm: minIm - padding,
    maxIm: maxIm + padding,
  }
  if (!Object.values(bounds).every(Number.isFinite))
    throw new Error('路径数值范围无法稳定计算包围盒。')
  return bounds
}

function roundoff(points: ComplexPoint[]): number {
  return 4 * Number.EPSILON * Math.max(...points.flatMap((p) => [Math.abs(p.re), Math.abs(p.im)]))
}

function contactTolerance(a: GeometricEdge, b: GeometricEdge): number {
  const points = [a.start, a.end, b.start, b.end]
  if (a.kind === 'arc') points.push(a.through)
  if (b.kind === 'arc') points.push(b.through)
  const width = Math.max(...points.map((p) => p.re)) - Math.min(...points.map((p) => p.re))
  const height = Math.max(...points.map((p) => p.im)) - Math.min(...points.map((p) => p.im))
  return EPSILON * Math.max(width, height) + roundoff(points)
}
