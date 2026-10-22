import { useMemo, useReducer, useState, type Dispatch } from 'react'
import type { ComplexPoint } from '../../lib/geometry'
import type { PathScreenMetric } from '../../lib/pathSnap'
import { projectSceneError } from '../project/validation'
import { avoidanceDraftReducer, type AvoidanceDraft } from './avoidanceDraft'
import {
  patchAvoidance,
  reconcileAvoidanceDependencies,
  type AvoidancePatch,
} from './avoidanceModel'
import { constructAvoidance } from './avoidanceConstruction'
import { constructAvoidances } from './avoidanceConstructionTable'
import { avoidanceSelectionId, sameAvoidanceTarget } from './avoidanceDependencies'
import { isLegacyAvoidance, type Avoidance } from './avoidanceTypes'
import { validateAvoidances } from './avoidanceValidation'
import { legacyTargetForPoint, makeAvoidanceTarget } from './avoidanceTarget'
import { editableAvoidance } from './avoidanceParameters'
import type { EditorAction } from './history'
import type { ContourState } from './model'
import type { SceneResolution } from './resolvedScene'
import {
  findPoint,
  findResolvedSegment,
  findSegment,
  segmentOrigin,
  visibleSceneSegments,
} from './sceneObjects'

export interface AvoidanceWorkflow {
  draft: AvoidanceDraft
  preview: SceneResolution | null
  previewDocument: ContourState | null
  start: (markerId: string) => void
  pickTarget: (renderedId: string, point?: ComplexPoint, metric?: PathScreenMetric) => void
  patch: (patch: AvoidancePatch) => void
  patchParentGap: (gap: number) => void
  apply: () => void
  cancel: () => void
}

export function useAvoidanceDraft(
  state: ContourState,
  dispatch: Dispatch<EditorAction>,
): AvoidanceWorkflow {
  const [draft, update] = useReducer(avoidanceDraftReducer, { kind: 'idle' })
  const [defaultSidePending, setDefaultSidePending] = useState(false)
  const [draftBasis, setDraftBasis] = useState(state)
  const invalid =
    draft.kind !== 'idle' &&
    (!validMarker(state, draft.kind === 'pickTarget' ? draft.markerId : draft.avoidance.markerId) ||
      (draft.kind === 'configure' && !validConfiguredTarget(state, draft.avoidance)))
  if (invalid) {
    if (defaultSidePending) setDefaultSidePending(false)
    update({ type: 'cancel' })
  }
  const followed = useMemo(() => {
    if (
      draft.kind !== 'configure' ||
      invalid ||
      draftBasis === state ||
      draft.avoidance.kind !== 'corridor' ||
      !draft.avoidance.alignment
    )
      return null
    const marker = findPoint(state, draft.avoidance.markerId)!
    // Use the applied-object maintenance on an isolated virtual document: the
    // draft must follow geometry, but must not enter saving, export or history.
    return reconcileAvoidanceDependencies(
      { ...draftBasis, avoidances: [draft.avoidance], error: '' },
      { ...state, avoidances: [draft.avoidance], error: '' },
      { type: 'moveObject', kind: 'marker', id: marker.id, point: marker },
    )
  }, [state, draftBasis, draft, invalid])
  if (followed && !followed.error) {
    setDraftBasis(state)
    const avoidance = followed.avoidances[0]
    if (draft.kind === 'configure' && avoidance !== draft.avoidance)
      update({ type: 'configure', avoidance })
  }
  const legacyConstruction = useMemo(
    () =>
      draft.kind === 'configure' && !invalid && isLegacyAvoidance(draft.avoidance)
        ? constructAvoidance(state, draft.avoidance)
        : null,
    [state, draft, invalid],
  )
  if (defaultSidePending && legacyConstruction?.ok) {
    setDefaultSidePending(false)
    update({ type: 'patch', patch: { side: legacyConstruction.value.defaultSide } })
  }
  const previewDocument = useMemo(() => {
    if (draft.kind !== 'configure' || invalid) return null
    const parentPatch = draft.parentPatch
    return {
      ...state,
      avoidances: [
        ...state.avoidances.map((a) =>
          a.id === parentPatch?.id
            ? patchAvoidance(editableAvoidance(state, a), parentPatch.patch)
            : a,
        ),
        draft.avoidance,
      ],
    }
  }, [state, draft, invalid])
  const preview = useMemo((): SceneResolution | null => {
    if (!previewDocument || draft.kind !== 'configure') return null
    if (followed?.error) return { ok: false, error: followed.error }
    if (legacyConstruction && !legacyConstruction.ok) return legacyConstruction
    const resolution = validateAvoidances(previewDocument)
    if (!resolution.ok) return resolution
    const table = constructAvoidances(previewDocument)
    if (!table.ok) return table
    const rootId =
      draft.avoidance.kind === 'bank-clearance'
        ? draft.avoidance.parentAvoidanceId
        : draft.avoidance.id
    const visible = new Set(visibleSceneSegments(previewDocument).map((s) => s.id))
    if (table.value.parents.get(rootId)?.trims.some((t) => !visible.has(t.sourceSegmentId)))
      return { ok: false, error: '接入区间依赖暂存路径，请改选完整可见的源区间或先恢复闭合。' }
    if (draft.parentPatch) {
      const actual = table.value.parents.get(draft.parentPatch.id)?.bankPair?.gap
      if (
        actual === undefined ||
        Math.abs(actual - draft.parentPatch.expectedGap) > 1e-9 * draft.parentPatch.expectedGap
      )
        return { ok: false, error: '请求的两岸间距无法在当前连接约束下保持，请调整间距或半径。' }
    }
    const error = projectSceneError(previewDocument)
    return error ? { ok: false, error } : resolution
  }, [previewDocument, draft, legacyConstruction, followed])
  return {
    draft,
    preview,
    previewDocument,
    start: (markerId) => {
      if (validMarker(state, markerId)) {
        setDraftBasis(state)
        setDefaultSidePending(false)
        update({ type: 'start', markerId })
      }
    },
    pickTarget: (renderedId, point, metric) => {
      if (draft.kind !== 'pickTarget') return
      const origin = segmentOrigin(state, renderedId)
      if (
        renderedId !== (origin?.sourceSegmentId ?? renderedId) &&
        !findResolvedSegment(state, renderedId)
      )
        return
      const owner =
        origin?.kind === 'avoidance'
          ? state.avoidances.find((a) => a.id === origin.avoidanceId)
          : undefined
      if (owner?.markerId === draft.markerId) {
        dispatch({ type: 'selectSegment', id: avoidanceSelectionId(owner) })
        update({ type: 'cancel' })
        return
      }
      const target = makeAvoidanceTarget(state, draft.markerId, {
        renderedId,
        point,
        metric,
      })
      if (!target.ok) {
        update({ type: 'targetError', error: target.error })
        return
      }
      const existing = state.avoidances.find((a) => sameAvoidanceTarget(a, target.value, state))
      if (existing) {
        setDefaultSidePending(false)
        dispatch({ type: 'selectSegment', id: avoidanceSelectionId(existing) })
        update({ type: 'cancel' })
        return
      }
      setDefaultSidePending(
        isLegacyAvoidance(target.value) && !constructAvoidance(state, target.value).ok,
      )
      update({ type: 'configure', avoidance: target.value })
    },
    patch: (patch) => {
      if (patch.side !== undefined) setDefaultSidePending(false)
      update({ type: 'patch', patch })
    },
    patchParentGap: (gap) => {
      if (draft.kind !== 'configure' || draft.avoidance.kind !== 'bank-clearance') return
      const parentId = draft.avoidance.parentAvoidanceId
      const stored = state.avoidances.find((a) => a.id === parentId)
      const parent = stored && editableAvoidance(state, stored)
      if (!parent || parent.kind === 'bank-clearance') return
      update({
        type: 'parentGap',
        value: {
          id: parent.id,
          expectedGap: gap,
          patch: isLegacyAvoidance(parent) ? { openingRatio: gap / (2 * parent.radius) } : { gap },
        },
      })
    },
    apply: () => {
      if (draft.kind !== 'configure' || !preview?.ok) return
      if (draft.parentPatch)
        dispatch({
          type: 'applyAvoidanceCandidate',
          avoidance: draft.avoidance,
          parentPatch: { id: draft.parentPatch.id, patch: draft.parentPatch.patch },
        })
      else dispatch({ type: 'addAvoidance', avoidance: draft.avoidance })
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

function validConfiguredTarget(state: ContourState, avoidance: Avoidance): boolean {
  if (avoidance.kind === 'corridor')
    return (
      !!findSegment(state, avoidance.anchor.segmentId) &&
      visibleSceneSegments(state).some((s) => s.id === avoidance.anchor.segmentId)
    )
  if (avoidance.kind === 'bank-clearance') {
    const table = constructAvoidances(state)
    const parent = table.ok ? table.value.parents.get(avoidance.parentAvoidanceId) : undefined
    const visible = new Set(visibleSceneSegments(state).map((s) => s.id))
    return !!parent?.bankPair && parent.trims.every((t) => visible.has(t.sourceSegmentId))
  }
  const target = legacyTargetForPoint(state, avoidance.markerId, avoidance.targetSegmentId)
  return (
    !!target &&
    !('error' in target) &&
    target.targetSegmentId === avoidance.targetSegmentId &&
    target.exitSegmentId === avoidance.exitSegmentId
  )
}
