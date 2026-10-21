import { useMemo, useReducer, useState, type Dispatch } from 'react'
import { arcThrough } from '../../lib/arc'
import { projectSceneError } from '../project/validation'
import { avoidanceDraftReducer, type AvoidanceDraft } from './avoidanceDraft'
import type { AvoidancePatch } from './avoidanceModel'
import { constructAvoidance } from './avoidanceConstruction'
import type { Avoidance } from './avoidanceTypes'
import { validateAvoidances } from './avoidanceValidation'
import type { EditorAction } from './history'
import type { ContourState } from './model'
import type { SceneResolution } from './resolvedScene'
import {
  findPoint,
  findResolvedSegment,
  findSegment,
  scenePoints,
  sceneSegments,
  segmentOrigin,
  visibleSceneSegments,
} from './sceneObjects'

export interface AvoidanceWorkflow {
  draft: AvoidanceDraft
  preview: SceneResolution | null
  start: (markerId: string) => void
  pickTarget: (renderedId: string) => void
  patch: (patch: AvoidancePatch) => void
  apply: () => void
  cancel: () => void
}

export function useAvoidanceDraft(
  state: ContourState,
  dispatch: Dispatch<EditorAction>,
): AvoidanceWorkflow {
  const [draft, update] = useReducer(avoidanceDraftReducer, { kind: 'idle' })
  const [defaultSidePending, setDefaultSidePending] = useState(false)
  // Cancel during render so no consumer can act on or display a stale reference.
  const invalid =
    draft.kind !== 'idle' &&
    (!validMarker(state, draft.kind === 'pickTarget' ? draft.markerId : draft.avoidance.markerId) ||
      (draft.kind === 'configure' && !validConfiguredTarget(state, draft.avoidance)))
  if (invalid) {
    if (defaultSidePending) setDefaultSidePending(false)
    update({ type: 'cancel' })
  }
  const construction = useMemo(
    () =>
      draft.kind === 'configure' && !invalid ? constructAvoidance(state, draft.avoidance) : null,
    [state, draft, invalid],
  )
  if (defaultSidePending && construction?.ok) {
    // A failed suggestion has no default yet. Consume it on the first valid
    // construction; explicit side patches consume it before reaching this point.
    setDefaultSidePending(false)
    update({ type: 'patch', patch: { side: construction.value.defaultSide } })
  }
  const preview = useMemo((): SceneResolution | null => {
    if (draft.kind !== 'configure' || !construction) return null
    if (!construction.ok) return construction
    const candidate = { ...state, avoidances: [...state.avoidances, draft.avoidance] }
    const resolution = validateAvoidances(candidate)
    if (!resolution.ok) return resolution
    // Match document acceptance too: a valid curve may exceed file/scene limits.
    const error = projectSceneError(candidate)
    return error ? { ok: false, error } : resolution
  }, [state, draft, construction])
  return {
    draft,
    preview,
    start: (markerId) => {
      if (validMarker(state, markerId)) {
        setDefaultSidePending(false)
        update({ type: 'start', markerId })
      }
    },
    pickTarget: (renderedId) => {
      if (draft.kind !== 'pickTarget') return
      const origin = segmentOrigin(state, renderedId)
      const sourceId = origin?.sourceSegmentId ?? renderedId
      if (renderedId !== sourceId && !findResolvedSegment(state, renderedId)) return
      const targetIds = targetForPoint(state, draft.markerId, sourceId)
      if (!targetIds) return
      if ('error' in targetIds) {
        update({ type: 'targetError', error: targetIds.error })
        return
      }
      const existing = state.avoidances.find(
        (a) =>
          a.markerId === draft.markerId &&
          a.targetSegmentId === targetIds.targetSegmentId &&
          a.exitSegmentId === targetIds.exitSegmentId,
      )
      if (existing) {
        setDefaultSidePending(false)
        dispatch({ type: 'selectSegment', id: `avoid:${existing.id}:arc` })
        update({ type: 'cancel' })
        return
      }
      const occupied = new Set(
        [
          ...scenePoints(state),
          ...sceneSegments(state),
          ...state.formulas,
          ...state.avoidances,
        ].map((item) => item.id),
      )
      let index = 0
      while (occupied.has(`avoidance-${index}`)) index++
      const target = findSegment(state, targetIds.targetSegmentId)!
      const avoidance: Avoidance = {
        id: `avoidance-${index}`,
        markerId: draft.markerId,
        ...targetIds,
        radius: sourceLength(state, target.id) / 20,
        side: 'left',
        openingRatio: 0.5,
      }
      const construction = constructAvoidance(state, avoidance)
      if (construction.ok) avoidance.side = construction.value.defaultSide
      setDefaultSidePending(!construction.ok)
      update({
        type: 'configure',
        avoidance,
      })
    },
    patch: (patch) => {
      if (patch.side !== undefined) setDefaultSidePending(false)
      update({ type: 'patch', patch })
    },
    apply: () => {
      if (draft.kind !== 'configure' || !preview?.ok) return
      dispatch({ type: 'addAvoidance', avoidance: draft.avoidance })
      setDefaultSidePending(false)
      update({ type: 'cancel' })
    },
    cancel: () => {
      setDefaultSidePending(false)
      update({ type: 'cancel' })
    },
  }
}

function validMarker(state: ContourState, markerId: string): boolean {
  const marker = findPoint(state, markerId)
  return !!marker && ['pole', 'isolated', 'branch'].includes(marker.mathematicalKind ?? 'ordinary')
}

function targetForPoint(
  state: ContourState,
  markerId: string,
  sourceId: string,
): { targetSegmentId: string; exitSegmentId?: string } | { error: string } | null {
  const target = findSegment(state, sourceId)
  const visible = new Set(visibleSceneSegments(state).map((s) => s.id))
  if (!target || !visible.has(sourceId)) return null
  if (target.startId === markerId || target.endId === markerId) {
    if (!state.vertices.some((p) => p.id === markerId)) return null
    const incoming = state.segments.filter((s) => s.endId === markerId)
    const outgoing = state.segments.filter((s) => s.startId === markerId)
    if (
      incoming.length !== 1 ||
      outgoing.length !== 1 ||
      ![incoming[0], outgoing[0]].some((s) => s.id === sourceId) ||
      !visible.has(incoming[0].id) ||
      !visible.has(outgoing[0].id)
    ) {
      return {
        error: `顶点 ${markerId} 的角点绕行需要一条可见进入路径和一条可见离开路径；开放端点不能创建角点绕行。`,
      }
    }
    return { targetSegmentId: incoming[0].id, exitSegmentId: outgoing[0].id }
  }
  // A source arc is intersected as a finite curve, never filtered by its chord.
  if (target.kind === 'arc') return { targetSegmentId: sourceId }
  const start = findPoint(state, target.startId),
    end = findPoint(state, target.endId),
    marker = findPoint(state, markerId)
  if (!start || !end || !marker) return null
  const dx = end.re - start.re,
    dy = end.im - start.im
  const length = Math.hypot(dx, dy)
  const projection = (marker.re - start.re) * (dx / length) + (marker.im - start.im) * (dy / length)
  return Number.isFinite(length) && length > 0 && projection > 0 && projection < length
    ? { targetSegmentId: sourceId }
    : null
}

function validConfiguredTarget(state: ContourState, avoidance: Avoidance): boolean {
  const target = targetForPoint(state, avoidance.markerId, avoidance.targetSegmentId)
  return (
    !!target &&
    !('error' in target) &&
    target.targetSegmentId === avoidance.targetSegmentId &&
    target.exitSegmentId === avoidance.exitSegmentId
  )
}

function sourceLength(state: ContourState, id: string): number {
  const source = findSegment(state, id)!
  const start = findPoint(state, source.startId)!,
    end = findPoint(state, source.endId)!
  if (source.kind === 'arc') {
    const result = arcThrough(start, end, source.through)
    if (result.ok) {
      const length = result.arc.radius * Math.abs(result.arc.sweep)
      if (Number.isFinite(length) && length > 0) return length
    }
  }
  const chord = Math.hypot(end.re - start.re, end.im - start.im)
  return Number.isFinite(chord) && chord > 0 ? chord : 2
}
