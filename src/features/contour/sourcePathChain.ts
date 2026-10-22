import type {
  GeometryResult,
  SourceAnchor,
  SourceChain,
} from '../../lib/connectedAvoidanceGeometry'
import type { ContourState, PathSegment } from './model'

type SourceDocument = Pick<ContourState, 'vertices' | 'segments' | 'connections' | 'markers'>

export function sourceChainForSegment(
  document: SourceDocument,
  segmentId: string,
): GeometryResult<SourceChain> {
  const invalid = (error: string): GeometryResult<SourceChain> => ({ ok: false, error })
  const independent = document.connections.find((s) => s.id === segmentId)
  const target = independent ?? document.segments.find((s) => s.id === segmentId)
  if (!target) return invalid(`源路径 ${segmentId} 不存在。`)
  const ordered: PathSegment[] = []
  if (independent) ordered.push(independent)
  else {
    const incoming = new Map(document.segments.map((s) => [s.endId, s]))
    const outgoing = new Map(document.segments.map((s) => [s.startId, s]))
    let first = target
    const backwards = new Set<string>()
    while (incoming.has(first.startId) && !backwards.has(first.id)) {
      backwards.add(first.id)
      first = incoming.get(first.startId)!
    }
    const seen = new Set<string>()
    let current: PathSegment | undefined = first
    while (current && !seen.has(current.id)) {
      seen.add(current.id)
      ordered.push(current)
      current = outgoing.get(current.endId)
    }
  }
  const points = new Map([...document.vertices, ...document.markers].map((p) => [p.id, p]))
  if (ordered.some((s) => !points.has(s.startId) || !points.has(s.endId)))
    return invalid('源路径端点引用无效。')
  return {
    ok: true,
    value: {
      cyclic: ordered.at(-1)!.endId === ordered[0].startId,
      edges: ordered.map((s) => ({
        id: s.id,
        startId: s.startId,
        endId: s.endId,
        edge: {
          kind: s.kind,
          start: points.get(s.startId)!,
          end: points.get(s.endId)!,
          ...(s.kind === 'arc' ? { through: s.through } : {}),
        } as import('../../lib/geometryIntersections').GeometricEdge,
      })),
    },
  }
}

export function canonicalSourceAnchor(
  chain: SourceChain,
  segmentId: string,
  t: number,
): GeometryResult<SourceAnchor> {
  const edge = chain.edges.find((s) => s.id === segmentId)
  if (!edge || !Number.isFinite(t) || t < 0 || t > 1)
    return { ok: false, error: '接入位置不在源路径内。' }
  if (t <= 1e-9 || t >= 1 - 1e-9)
    return {
      ok: true,
      value: { kind: 'vertex', vertexId: t <= 1e-9 ? edge.startId : edge.endId, segmentId },
    }
  return { ok: true, value: { kind: 'segment', segmentId, t } }
}
