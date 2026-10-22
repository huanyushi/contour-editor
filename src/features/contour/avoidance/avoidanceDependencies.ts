import type { GeometryResult } from '../../../lib/connectedAvoidanceGeometry'
import { constructAvoidances } from './avoidanceConstructionTable'
import type { ConstructionTable } from './avoidanceConstructionTypes'
import type { Avoidance } from './avoidanceTypes'
import { isLegacyAvoidance } from './avoidanceTypes'
import type { SceneDocument } from '../scene/resolvedScene'
import { sourceChainForSegment } from '../sourcePathChain'

/** Direct source ownership only, never recursively querying a resolved scene. */
export function avoidanceSourceIds(
  document: SceneDocument,
  id: string,
  construction?: ConstructionTable,
): readonly string[] {
  const declaration = document.avoidances.find((a) => a.id === id)
  if (!declaration) return []
  if (declaration.kind === 'bank-clearance') {
    const parent = document.avoidances.find((a) => a.id === declaration.parentAvoidanceId)
    if (!parent || parent.kind === 'bank-clearance') return []
    return avoidanceSourceIds(document, parent.id, construction)
  }
  if (isLegacyAvoidance(declaration))
    return [
      declaration.targetSegmentId,
      ...(declaration.exitSegmentId ? [declaration.exitSegmentId] : []),
    ]
  if (construction)
    return [...new Set(construction.parents.get(id)?.trims.map((t) => t.sourceSegmentId) ?? [])]
  const table = constructAvoidances(document)
  return table.ok
    ? [...new Set(table.value.parents.get(id)!.trims.map((t) => t.sourceSegmentId))]
    : [declaration.anchor.segmentId]
}

export function relatedAvoidanceIds(document: SceneDocument, sourceId: string): readonly string[] {
  return sourceBindingsIndex(document).get(sourceId) ?? []
}

/** One construction per source-list render, not one per binding per source row. */
export function sourceBindingsIndex(
  document: SceneDocument,
): ReadonlyMap<string, readonly string[]> {
  const result = new Map<string, string[]>()
  const table = constructAvoidances(document)
  if (!table.ok) return result
  for (const a of document.avoidances)
    for (const sourceId of avoidanceSourceIds(document, a.id, table.value)) {
      const group = result.get(sourceId) ?? []
      group.push(a.id)
      result.set(sourceId, group)
    }
  return result
}

export function pruneAvoidances(
  before: SceneDocument,
  candidate: SceneDocument,
  explicit: ReadonlySet<string> = new Set(),
): Avoidance[] {
  const removed = new Set(explicit)
  const points = new Set([...candidate.vertices, ...candidate.markers].map((p) => p.id))
  const sources = new Set([...candidate.segments, ...candidate.connections].map((s) => s.id))
  const previousPoints = new Set([...before.vertices, ...before.markers].map((p) => p.id))
  const previousSources = new Set([...before.segments, ...before.connections].map((s) => s.id))
  const table = constructAvoidances(before)
  for (const a of candidate.avoidances) {
    if (previousPoints.has(a.markerId) && !points.has(a.markerId)) removed.add(a.id)
    if (
      a.kind !== 'bank-clearance' &&
      avoidanceSourceIds(before, a.id, table.ok ? table.value : undefined).some(
        (id) => previousSources.has(id) && !sources.has(id),
      )
    )
      removed.add(a.id)
    if (
      a.kind === 'corridor' &&
      a.anchor.kind === 'vertex' &&
      previousPoints.has(a.anchor.vertexId) &&
      !points.has(a.anchor.vertexId)
    )
      removed.add(a.id)
  }
  const live = new Set(candidate.avoidances.filter((a) => !removed.has(a.id)).map((a) => a.id))
  return candidate.avoidances.filter(
    (a) =>
      !removed.has(a.id) &&
      (a.kind !== 'bank-clearance' ||
        live.has(a.parentAvoidanceId) ||
        !before.avoidances.some((old) => old.id === a.parentAvoidanceId)),
  )
}

export function avoidanceDependencies(
  document: SceneDocument,
  id: string,
  construction?: ConstructionTable,
): GeometryResult<{
  sourceIds: ReadonlySet<string>
  pointIds: ReadonlySet<string>
}> {
  const target = document.avoidances.find((a) => a.id === id)
  if (!target) return { ok: false, error: `绕行 ${id} 不存在。` }
  const rootId = target.kind === 'bank-clearance' ? target.parentAvoidanceId : id
  const root = document.avoidances.find((a) => a.id === rootId)
  if (!root) return { ok: false, error: `父绕行 ${rootId} 不存在。` }
  const sourceIds = new Set(avoidanceSourceIds(document, rootId, construction))
  const group = document.avoidances.filter(
    (a) => a.id === rootId || (a.kind === 'bank-clearance' && a.parentAvoidanceId === rootId),
  )
  const pointIds = new Set(group.map((a) => a.markerId))
  for (const s of [...document.segments, ...document.connections])
    if (sourceIds.has(s.id)) {
      pointIds.add(s.startId)
      pointIds.add(s.endId)
    }
  return { ok: true, value: { sourceIds, pointIds } }
}

export function avoidanceSelectionId(a: Avoidance): string {
  return `avoid:${a.id}:${a.kind === 'bank-clearance' ? 'bank-entry' : 'arc'}`
}

export function sameAvoidanceTarget(a: Avoidance, b: Avoidance, document?: SceneDocument): boolean {
  if (a.markerId !== b.markerId) return false
  if (isLegacyAvoidance(a) && isLegacyAvoidance(b))
    return a.targetSegmentId === b.targetSegmentId && a.exitSegmentId === b.exitSegmentId
  if (a.kind === 'bank-clearance' && b.kind === 'bank-clearance')
    return a.parentAvoidanceId === b.parentAvoidanceId
  if (a.kind === 'corridor' && b.kind === 'corridor') {
    if (a.anchor.kind === 'vertex' && b.anchor.kind === 'vertex') {
      if (a.anchor.vertexId !== b.anchor.vertexId) return false
      if (a.anchor.segmentId === b.anchor.segmentId) return true
      const chain = document ? sourceChainForSegment(document, a.anchor.segmentId) : null
      const segmentId = b.anchor.segmentId
      return !!chain?.ok && chain.value.edges.some((s) => s.id === segmentId)
    }
    return (
      a.anchor.kind === 'segment' &&
      b.anchor.kind === 'segment' &&
      a.anchor.segmentId === b.anchor.segmentId &&
      Math.abs(a.anchor.t - b.anchor.t) <= 1e-9
    )
  }
  return false
}
