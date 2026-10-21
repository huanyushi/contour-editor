import type { AvoidancePatch } from './avoidanceModel'
import type { Avoidance } from './avoidanceTypes'

export type AvoidanceDraft =
  | { kind: 'idle' }
  | { kind: 'pickTarget'; markerId: string; error?: string }
  | { kind: 'configure'; avoidance: Avoidance }

export type AvoidanceDraftAction =
  | { type: 'start'; markerId: string }
  | { type: 'configure'; avoidance: Avoidance }
  | { type: 'targetError'; error: string }
  | { type: 'patch'; patch: AvoidancePatch }
  | { type: 'cancel' }

export function avoidanceDraftReducer(
  draft: AvoidanceDraft,
  action: AvoidanceDraftAction,
): AvoidanceDraft {
  switch (action.type) {
    case 'start':
      return { kind: 'pickTarget', markerId: action.markerId }
    case 'configure':
      return { kind: 'configure', avoidance: action.avoidance }
    case 'targetError':
      return draft.kind === 'pickTarget' ? { ...draft, error: action.error } : draft
    case 'patch':
      return draft.kind === 'configure'
        ? { kind: 'configure', avoidance: { ...draft.avoidance, ...action.patch } }
        : draft
    case 'cancel':
      return { kind: 'idle' }
  }
}
