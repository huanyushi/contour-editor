import { arcThrough, type CircularArc } from '../../lib/arc'
import { isValidPoint, type ComplexPoint } from '../../lib/geometry'
import type { LabelSettings } from './appearance'
import type { AvoidancePart } from './avoidanceTypes'
import { constructAvoidances } from './avoidanceConstructionTable'
import type { ContourState, PathSegment, Vertex } from './model'
import { isSingleCycle, validTopology } from './pathTopology'
import { spliceSourcePaths } from './scenePathSplicing'
import type { SourcePieceBoundary } from './sourcePieces'

export type SceneDocument = Pick<
  ContourState,
  | 'vertices'
  | 'segments'
  | 'connections'
  | 'markers'
  | 'formulas'
  | 'closed'
  | 'appearance'
  | 'avoidances'
>
export type SegmentOrigin = {
  sourceSegmentId: string
  collection: 'contour' | 'connection'
  sourceSegmentIds?: readonly string[]
  parentAvoidanceId?: string
} & (
  | { kind: 'source' }
  | { kind: 'gap'; piece: SourcePieceBoundary }
  | { kind: 'avoidance'; avoidanceId: string; part: AvoidancePart }
)
export type ResolvedSegment = PathSegment & {
  origin: SegmentOrigin
  resolvedArc?: CircularArc
}
export interface ResolvedSegmentLabel {
  target: { kind: 'segment'; id: string; part: 'label' }
  anchor: ComplexPoint
  value: LabelSettings
}
export interface ResolvedScene {
  points: ReadonlyMap<string, Vertex>
  contourSegments: readonly ResolvedSegment[]
  connectionSegments: readonly ResolvedSegment[]
  chains: ReadonlyMap<string, readonly ResolvedSegment[]>
  labels: readonly ResolvedSegmentLabel[]
  origins: ReadonlyMap<string, SegmentOrigin>
  partChains?: ReadonlyMap<string, readonly ResolvedSegment[]>
}
export type SceneResolution = { ok: true; scene: ResolvedScene } | { ok: false; error: string }

/** Pure source validation followed by one shared parent/child scene pipeline. */
export function resolveScene(document: SceneDocument): SceneResolution {
  try {
    const invalid = (error: string): SceneResolution => ({ ok: false, error })
    const sourcePoints = [...document.vertices, ...document.markers]
    const sourceSegments = [...document.segments, ...document.connections]
    const ids = new Set<string>()
    for (const object of [
      ...sourcePoints,
      ...document.formulas,
      ...sourceSegments,
      ...document.avoidances,
    ]) {
      if (!/^[a-zA-Z0-9_-]{1,80}$/.test(object.id))
        return invalid(`源对象 ID 格式无效：${object.id}`)
      if (ids.has(object.id)) return invalid(`源对象或绕行 ID 重复：${object.id}`)
      ids.add(object.id)
    }
    for (const point of [...sourcePoints, ...document.formulas]) {
      if (!isValidPoint(point)) return invalid(`源对象 ${point.id} 的坐标不是可绘制的有限数值。`)
    }
    for (const point of sourcePoints) {
      if (
        !['ordinary', 'pole', 'isolated', 'branch'].includes(
          point.mathematicalKind === undefined ? 'ordinary' : point.mathematicalKind,
        )
      )
        return invalid(`源点 ${point.id} 的数学类型无效。`)
    }
    const points = new Map(sourcePoints.map((p) => [p.id, p]))
    const contourIds = new Set(document.vertices.map((p) => p.id))
    const connectionIds = new Set(document.connections.map((s) => s.id))
    const linePairs = new Set(
      document.segments
        .filter((s) => s.kind === 'line')
        .map((s) => [s.startId, s.endId].sort().join(':')),
    )
    for (const segment of sourceSegments) {
      const start = points.get(segment.startId),
        end = points.get(segment.endId)
      if (!start || !end || start.id === end.id)
        return invalid(`源路径 ${segment.id} 的端点引用无效。`)
      if (!connectionIds.has(segment.id) && (!contourIds.has(start.id) || !contourIds.has(end.id)))
        return invalid(`围道路径 ${segment.id} 的端点必须来自围道顶点。`)
      if (connectionIds.has(segment.id)) {
        if (start.re === end.re && start.im === end.im)
          return invalid(`独立路径 ${segment.id} 的端点位置不能相同。`)
        if (segment.kind === 'line') {
          const pair = [start.id, end.id].sort().join(':')
          if (linePairs.has(pair)) return invalid(`独立路径 ${segment.id} 的直线段连接重复。`)
          linePairs.add(pair)
        }
      }
      if (segment.kind === 'arc') {
        const result = arcThrough(start, end, segment.through)
        if (!result.ok) return invalid(`源路径 ${segment.id}：${result.error}`)
      }
    }
    if (!validTopology(document.vertices, document.segments))
      return invalid('源围道拓扑存在分叉或局部环路。')
    if (
      document.closed &&
      (!isSingleCycle(document) ||
        (document.vertices.length < 3 && !document.segments.some((s) => s.kind === 'arc')))
    )
      return invalid('源围道拓扑不能构成有效闭合围道。')
    const table = constructAvoidances(document)
    return table.ok ? spliceSourcePaths(document, table.value) : table
  } catch (error) {
    return {
      ok: false,
      error: `派生场景数值构造失败：${error instanceof Error ? error.message : '无法可靠计算路径。'}`,
    }
  }
}
