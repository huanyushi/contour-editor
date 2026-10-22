import {
  buildConnectedAvoidance,
  type GeometryResult,
  type ParallelBanks,
} from '../../lib/connectedAvoidanceGeometry'
import { buildBankClearance } from '../../lib/bankClearanceGeometry'
import type { AvoidanceGeometry } from '../../lib/avoidanceGeometry'
import { constructAvoidance } from './avoidanceConstruction'
import type {
  ConstructionTable,
  ParentConstruction,
  ClearanceConstruction,
} from './avoidanceConstructionTypes'
import type { SceneDocument } from './resolvedScene'
import { sourceChainForSegment } from './sourcePathChain'
import { isLegacyAvoidance } from './avoidanceTypes'
import { buildApproachingAvoidance } from '../../lib/approachingAvoidance'
import { corridorDirection } from './avoidanceFollowing'

function legacyBanks(g: AvoidanceGeometry): ParallelBanks | undefined {
  const length = (a: { re: number; im: number }, b: { re: number; im: number }) =>
    Math.hypot(a.re - b.re, a.im - b.im)
  if (
    g.onLine ||
    length(g.entryBase, g.entry) <= 1e-9 * g.arc.radius ||
    length(g.exit, g.exitBase) <= 1e-9 * g.arc.radius
  )
    return undefined
  const q = {
    re: g.entryBase.re / 2 + g.exitBase.re / 2,
    im: g.entryBase.im / 2 + g.exitBase.im / 2,
  }
  const distance = length(q, g.arc.center)
  const direction = {
    re: (q.re - g.arc.center.re) / distance,
    im: (q.im - g.arc.center.im) / distance,
  }
  const outward = Math.sign(
    (g.entry.re - g.arc.center.re) * -direction.im + (g.entry.im - g.arc.center.im) * direction.re,
  ) as -1 | 1
  return {
    center: g.arc.center,
    direction,
    gap: g.actualOpeningWidth,
    entry: { start: g.entryBase, end: g.entry, outward },
    exit: { start: g.exit, end: g.exitBase, outward: outward === 1 ? -1 : 1 },
  }
}

/** A two-level dependency evaluation, independent of declaration array ordering. */
export function constructAvoidances(document: SceneDocument): GeometryResult<ConstructionTable> {
  const parents = new Map<string, ParentConstruction>()
  const clearances = new Map<string, ClearanceConstruction>()
  const points = new Map([...document.vertices, ...document.markers].map((p) => [p.id, p]))
  const ids = new Set<string>()
  const parentPairs = new Set<string>()
  const invalid = (error: string): GeometryResult<ConstructionTable> => ({ ok: false, error })
  for (const a of document.avoidances) {
    if (ids.has(a.id)) return invalid(`绕行 ID 重复：${a.id}`)
    ids.add(a.id)
    const point = points.get(a.markerId)
    if (!point || !['pole', 'isolated', 'branch'].includes(point.mathematicalKind ?? 'ordinary'))
      return invalid(`绕行 ${a.id} 需要真实的非普通数学点：${a.markerId}。`)
    if (a.kind === 'bank-clearance') continue
    const parentKey = isLegacyAvoidance(a)
      ? `${a.markerId}:${a.targetSegmentId}:${a.exitSegmentId ?? ''}`
      : `${a.markerId}:${JSON.stringify(a.anchor)}`
    if (parentPairs.has(parentKey)) return invalid(`绕行 ${a.id} 的奇点与源路径绑定重复。`)
    parentPairs.add(parentKey)
    if (isLegacyAvoidance(a)) {
      const result = constructAvoidance(document, a)
      if (!result.ok) return result
      parents.set(a.id, {
        id: a.id,
        ...result.value,
        primarySourceId: a.targetSegmentId,
        bankPair: legacyBanks(result.value.geometry),
      })
    } else {
      const source = sourceChainForSegment(document, a.anchor.segmentId)
      if (!source.ok) return source
      const input = {
        source: source.value,
        anchor: a.anchor,
        center: point,
        radius: a.radius,
        gap: a.gap,
      }
      const result = a.alignment
        ? buildApproachingAvoidance({ ...input, direction: corridorDirection(document, a) })
        : buildConnectedAvoidance(input)
      if (!result.ok) return invalid(`绕行 ${a.id}：${result.error}`)
      const { geometry, trims, banks } = result.value
      parents.set(a.id, {
        id: a.id,
        mode: 'corridor',
        geometry,
        trims,
        occupancy: trims,
        primarySourceId: trims[0].sourceSegmentId,
        bankPair: banks,
      })
    }
  }
  const pairs = new Set<string>()
  for (const a of document.avoidances) {
    if (a.kind !== 'bank-clearance') continue
    const parent = parents.get(a.parentAvoidanceId)
    const point = points.get(a.markerId)!
    const parentDeclaration = document.avoidances.find((p) => p.id === a.parentAvoidanceId)
    if (!parent?.bankPair || !parentDeclaration || parentDeclaration.markerId === a.markerId)
      return invalid(`两岸避让 ${a.id} 的父绕行不存在、岸线退化或引用不合法。`)
    if (!['pole', 'isolated'].includes(point.mathematicalKind ?? 'ordinary'))
      return invalid(`两岸避让 ${a.id} 需要孤立奇点。`)
    const pair = `${a.parentAvoidanceId}:${a.markerId}`
    if (pairs.has(pair)) return invalid(`孤立奇点 ${a.markerId} 在同一通道上的避让重复。`)
    pairs.add(pair)
    const result = buildBankClearance({ banks: parent.bankPair, center: point, radius: a.radius })
    if (!result.ok) return invalid(`两岸避让 ${a.id}：${result.error}`)
    clearances.set(a.id, {
      id: a.id,
      parentAvoidanceId: a.parentAvoidanceId,
      cuts: result.value.cuts,
    })
  }
  return { ok: true, value: { parents, clearances } }
}
