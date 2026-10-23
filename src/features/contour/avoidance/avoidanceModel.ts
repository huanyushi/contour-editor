import { constructAvoidance } from './avoidanceConstruction'
import { constructAvoidances } from './avoidanceConstructionTable'
import type { ComplexPoint } from '../../../lib/geometry'
import type { SourceAnchor } from '../../../lib/connectedAvoidanceGeometry'
import type { LabelSettings, StrokeStyle } from '../appearance'
import {
  isLegacyAvoidance,
  type Avoidance,
  type AvoidancePart,
  type AvoidanceSide,
  type MathematicalKind,
} from './avoidanceTypes'
import {
  avoidanceSelectionId,
  avoidanceSourceIds,
  pruneAvoidances,
  sameAvoidanceTarget,
} from './avoidanceDependencies'
import type { ContourAction, ContourState } from '../model'
import { scenePoints, sceneSegments } from '../scene/sceneObjects'
import { cleanupRemovedAvoidanceSelection } from '../selection/selectionState'
import { editableAvoidance } from './avoidanceParameters'
import { corridorDirection, followAvoidance } from './avoidanceFollowing'
import type { CorridorAvoidance } from './avoidanceTypes'

export type AvoidancePatch = {
  radius?: number
  gap?: number
  side?: AvoidanceSide
  openingRatio?: number
  anchor?: SourceAnchor
  alignment?: CorridorAvoidance['alignment']
}
export type AvoidanceAction =
  | { type: 'mathematicalKind'; id: string; value: MathematicalKind }
  | { type: 'addAvoidance'; avoidance: Avoidance }
  | {
      type: 'applyAvoidanceCandidate'
      avoidance: Avoidance
      parentPatch?: { id: string; patch: AvoidancePatch }
    }
  | { type: 'updateAvoidance'; id: string; patch: AvoidancePatch }
  | { type: 'removeAvoidance'; id: string }
  | { type: 'avoidanceStyle'; id: string; part: AvoidancePart; patch: Partial<StrokeStyle> }
  | { type: 'avoidanceLabel'; id: string; part: AvoidancePart; label: LabelSettings }

export function avoidanceReducer(state: ContourState, action: AvoidanceAction): ContourState {
  switch (action.type) {
    case 'applyAvoidanceCandidate': {
      const candidate = action.parentPatch
        ? avoidanceReducer(state, { type: 'updateAvoidance', ...action.parentPatch })
        : state
      return action.parentPatch && candidate.error
        ? candidate
        : avoidanceReducer(candidate, { type: 'addAvoidance', avoidance: action.avoidance })
    }
    case 'mathematicalKind': {
      const marker = scenePoints(state).find((item) => item.id === action.id)
      if (!marker) return state
      if (!['ordinary', 'pole', 'isolated', 'branch'].includes(action.value))
        return { ...state, error: '标记数学类型无效。' }
      if (action.value === 'ordinary' && state.avoidances.some((a) => a.markerId === action.id))
        return { ...state, error: '请先取消该标记的绕行，再改为普通标记。' }
      if ((marker.mathematicalKind ?? 'ordinary') === action.value) return state
      const key = state.vertices.some((item) => item.id === action.id) ? 'vertices' : 'markers'
      return {
        ...state,
        [key]: state[key].map((item) =>
          item.id === action.id ? { ...item, mathematicalKind: action.value } : item,
        ),
        error: '',
      }
    }
    case 'addAvoidance': {
      const existing = state.avoidances.find((a) => sameAvoidanceTarget(a, action.avoidance, state))
      const id = avoidanceSelectionId(existing ?? action.avoidance)
      return {
        ...state,
        avoidances: existing ? state.avoidances : [...state.avoidances, action.avoidance],
        selection: { kind: 'segment', id },
        selectedSegmentId: id,
        selectionSource: 'click',
        error: '',
      }
    }
    case 'removeAvoidance':
    case 'updateAvoidance':
    case 'avoidanceStyle':
    case 'avoidanceLabel': {
      if (!state.avoidances.some((a) => a.id === action.id)) return state
      if (action.type === 'updateAvoidance') {
        const original = state.avoidances.find((a) => a.id === action.id)!
        const target = editableAvoidance(state, original)
        const allowed = isLegacyAvoidance(target)
          ? ['radius', 'side', 'openingRatio']
          : target.kind === 'corridor'
            ? ['radius', 'gap', 'anchor', 'alignment']
            : ['radius']
        if (Object.keys(action.patch).some((key) => !allowed.includes(key)))
          return { ...state, error: '该绕行不支持此参数。' }
      }
      const avoidances: Avoidance[] =
        action.type === 'removeAvoidance'
          ? pruneAvoidances(state, state, new Set([action.id]))
          : state.avoidances.map((a) => {
              if (a.id !== action.id) return a
              switch (action.type) {
                case 'updateAvoidance':
                  return patchAvoidance(editableAvoidance(state, a), action.patch)
                case 'avoidanceStyle':
                  return {
                    ...a,
                    partStyles: {
                      ...a.partStyles,
                      [action.part]: { ...a.partStyles?.[action.part], ...action.patch },
                    },
                  }
                case 'avoidanceLabel':
                  return { ...a, partLabels: { ...a.partLabels, [action.part]: action.label } }
              }
            })
      return cleanupRemovedAvoidanceSelection(state, { ...state, avoidances, error: '' })
    }
  }
}

export function patchAvoidance(a: Avoidance, patch: AvoidancePatch): Avoidance {
  if (isLegacyAvoidance(a))
    return {
      ...a,
      radius: patch.radius === undefined ? a.radius : patch.radius,
      side: patch.side === undefined ? a.side : patch.side,
      openingRatio: patch.openingRatio === undefined ? a.openingRatio : patch.openingRatio,
    }
  if (a.kind === 'corridor')
    return {
      ...a,
      radius: patch.radius === undefined ? a.radius : patch.radius,
      gap: patch.gap === undefined ? a.gap : patch.gap,
      anchor: patch.anchor === undefined ? a.anchor : patch.anchor,
      ...(patch.alignment === undefined ? {} : { alignment: patch.alignment }),
    }
  return { ...a, radius: patch.radius === undefined ? a.radius : patch.radius }
}

function swapEnds<T>(parts: Partial<Record<AvoidancePart, T>>): Partial<Record<AvoidancePart, T>> {
  // Omit absent keys rather than persisting undefined overrides.
  const { entry, exit, ...rest } = parts
  return {
    ...rest,
    ...(exit === undefined ? {} : { entry: exit }),
    ...(entry === undefined ? {} : { exit: entry }),
  }
}

function reverseArrowPositions(a: Avoidance) {
  if (!a.partArrowPositions) return {}
  const flipped: Partial<Record<AvoidancePart, number>> = Object.fromEntries(
    Object.entries(a.partArrowPositions).map(([part, t]) => [part, 1 - t]),
  )
  return {
    partArrowPositions: a.kind === 'bank-clearance' ? swapBanks(flipped) : swapEnds(flipped),
  }
}

const samePoint = (a: ComplexPoint, b: ComplexPoint) => a.re === b.re && a.im === b.im

/** Dependency maintenance only builds a candidate; contourReducer owns acceptance. */
export function reconcileAvoidanceDependencies(
  before: ContourState,
  candidate: ContourState,
  action: ContourAction,
): ContourState {
  const destructive =
    action.type === 'delete' ||
    action.type === 'deleteSegment' ||
    action.type === 'deleteSelection' ||
    (action.type === 'removeObject' && action.kind === 'marker')
  const sourceEdit =
    destructive ||
    action.type === 'move' ||
    action.type === 'moveObject' ||
    action.type === 'moveThrough' ||
    action.type === 'translateSelection' ||
    action.type === 'add' ||
    action.type === 'reverse' ||
    action.type === 'toggleClosed' ||
    action.type === 'closeAtVertex' ||
    action.type === 'connectPoints'
  if (!sourceEdit || !candidate.avoidances.length) return candidate

  const oldSegments = new Map(sceneSegments(before).map((s) => [s.id, s]))
  const newSegments = new Map(sceneSegments(candidate).map((s) => [s.id, s]))
  const oldPoints = new Map(scenePoints(before).map((p) => [p.id, p]))
  const newPoints = new Map(scenePoints(candidate).map((p) => [p.id, p]))
  const removedSegments = new Set([...oldSegments.keys()].filter((id) => !newSegments.has(id)))
  const liveMarkers = new Set(scenePoints(candidate).map((m) => m.id))
  const removedMarkers = new Set(
    scenePoints(before)
      .filter((m) => !liveMarkers.has(m.id))
      .map((m) => m.id),
  )
  let changed = false
  const avoidances: Avoidance[] = []
  for (const item of candidate.avoidances) {
    if (
      destructive &&
      ((isLegacyAvoidance(item)
        ? [item.targetSegmentId, ...(item.exitSegmentId ? [item.exitSegmentId] : [])]
        : avoidanceSourceIds(before, item.id)
      ).some((id) => removedSegments.has(id)) ||
        removedMarkers.has(item.markerId))
    ) {
      changed = true
      continue
    }
    if (!isLegacyAvoidance(item)) {
      let next = item
      const root =
        item.kind === 'bank-clearance'
          ? before.avoidances.find((a) => a.id === item.parentAvoidanceId)
          : item
      const sourceId =
        root &&
        (root.kind === 'corridor'
          ? root.anchor.segmentId
          : isLegacyAvoidance(root)
            ? root.targetSegmentId
            : undefined)
      const old = sourceId ? oldSegments.get(sourceId) : undefined
      const current = sourceId ? newSegments.get(sourceId) : undefined
      const reversed =
        old && current && old.startId === current.endId && old.endId === current.startId
      if (reversed) {
        if (next.kind === 'corridor')
          next = {
            ...next,
            anchor:
              next.anchor.kind === 'segment'
                ? { ...next.anchor, t: 1 - next.anchor.t }
                : next.anchor,
            ...(next.partStyles ? { partStyles: swapEnds(next.partStyles) } : {}),
            ...(next.partLabels ? { partLabels: swapEnds(next.partLabels) } : {}),
            ...reverseArrowPositions(next),
          }
        else
          next = {
            ...next,
            ...(next.partStyles ? { partStyles: swapBanks(next.partStyles) } : {}),
            ...(next.partLabels ? { partLabels: swapBanks(next.partLabels) } : {}),
            ...reverseArrowPositions(next),
          }
      }
      const previousMarker = oldPoints.get(item.markerId)
      const currentMarker = newPoints.get(item.markerId)
      const markerMoved =
        previousMarker && currentMarker && !samePoint(previousMarker, currentMarker)
      const translatedTogether =
        markerMoved &&
        old &&
        current &&
        [old.startId, old.endId].every((id) => {
          const p = oldPoints.get(id),
            q = newPoints.get(id)
          const tolerance =
            32 *
            Number.EPSILON *
            Math.max(
              1,
              ...[p, q, previousMarker, currentMarker].flatMap((v) =>
                v ? [Math.abs(v.re), Math.abs(v.im)] : [],
              ),
            )
          return (
            p &&
            q &&
            Math.hypot(
              q.re - p.re - (currentMarker.re - previousMarker.re),
              q.im - p.im - (currentMarker.im - previousMarker.im),
            ) <= tolerance
          )
        })
      if (
        next.kind === 'corridor' &&
        (next.alignment || (markerMoved && !translatedTogether)) &&
        !reversed
      ) {
        let following: CorridorAvoidance = next.alignment
          ? next
          : { ...next, alignment: { kind: 'normal' } }
        const previous = before.avoidances.find((a) => a.id === item.id)
        if (following.alignment?.kind === 'normal' && previous?.kind === 'corridor') {
          const direction = corridorDirection(before, previous)
          following = {
            ...following,
            alignment: {
              kind: 'normal',
              angle: (Math.atan2(direction.im, direction.re) * 180) / Math.PI,
            },
          }
        }
        const followed = followAvoidance(candidate, following)
        if (!followed.ok) return { ...before, error: followed.error }
        next = followed.value
      }
      changed ||= next !== item
      avoidances.push(next)
      continue
    }
    const oldSource = oldSegments.get(item.targetSegmentId)
    const source = newSegments.get(item.targetSegmentId)
    let next = item
    if (oldSource && source) {
      const reversed = oldSource.startId === source.endId && oldSource.endId === source.startId
      if (reversed) {
        next = {
          ...next,
          ...(next.exitSegmentId === undefined
            ? {}
            : {
                targetSegmentId: next.exitSegmentId,
                exitSegmentId: next.targetSegmentId,
              }),
          side: next.side === 'left' ? 'right' : 'left',
          ...(next.partStyles === undefined ? {} : { partStyles: swapEnds(next.partStyles) }),
          ...(next.partLabels === undefined ? {} : { partLabels: swapEnds(next.partLabels) }),
          ...reverseArrowPositions(next),
        }
      }
      const ids = [source.startId, source.endId, item.markerId]
      // A direction-only reversal must flip (and preserve) the saved preference,
      // even when an imported off-line marker currently lies on its other side.
      const coordinatesChanged =
        (!reversed && (oldSource.startId !== source.startId || oldSource.endId !== source.endId)) ||
        ids.some((id) => {
          const oldPoint = oldPoints.get(id),
            point = newPoints.get(id)
          return oldPoint && point && !samePoint(oldPoint, point)
        })
      if (coordinatesChanged && next.exitSegmentId === undefined && source.kind === 'line') {
        const result = constructAvoidance(candidate, next)
        // Invalid geometry is left intact for the shared final boundary to reject.
        if (result.ok && !result.value.geometry.onLine) {
          const side = result.value.defaultSide
          if (next.side !== side) next = { ...next, side }
        }
      }
    }
    changed ||= next !== item
    avoidances.push(next)
  }
  const pruned = destructive ? pruneAvoidances(before, { ...candidate, avoidances }) : avoidances
  const reconciled =
    changed || pruned.length !== candidate.avoidances.length
      ? cleanupRemovedAvoidanceSelection(before, { ...candidate, avoidances: pruned })
      : candidate
  // A valid new loop must not silently retarget an existing corridor to its closing edge.
  if (action.type === 'closeAtVertex' && !before.closed && reconciled.closed) {
    const previous = constructAvoidances(before)
    if (!previous.ok) return { ...before, error: previous.error }
    const next = constructAvoidances(reconciled)
    if (!next.ok) return { ...before, error: next.error }
    for (const avoidance of reconciled.avoidances) {
      const sources = new Set(avoidanceSourceIds(before, avoidance.id, previous.value))
      const updated = avoidanceSourceIds(reconciled, avoidance.id, next.value)
      if (sources.size !== updated.length || updated.some((id) => !sources.has(id)))
        return {
          ...before,
          error: `闭合会改变绕行 ${avoidance.id} 的源路径，请先取消该绕行或改选闭合端点。`,
        }
    }
  }
  return reconciled
}

function swapBanks<T>(parts: Partial<Record<AvoidancePart, T>>): Partial<Record<AvoidancePart, T>> {
  const { 'bank-entry': entry, 'bank-exit': exit, ...rest } = parts
  return {
    ...rest,
    ...(exit === undefined ? {} : { 'bank-entry': exit }),
    ...(entry === undefined ? {} : { 'bank-exit': entry }),
  }
}
