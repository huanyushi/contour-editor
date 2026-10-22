import type { LabelSettings, StrokeStyle } from './appearance'
import type { SourceAnchor } from '../../lib/connectedAvoidanceGeometry'

/** `pole` is retained for lossless legacy project compatibility, not a separate UI choice. */
export type MathematicalKind = 'ordinary' | 'pole' | 'isolated' | 'branch'
export type AvoidanceSide = 'left' | 'right'
export type ParentAvoidancePart = 'entry' | 'arc' | 'exit'
export type AvoidancePart = ParentAvoidancePart | 'bank-entry' | 'bank-exit'

interface AvoidanceBase {
  id: string
  markerId: string
  radius: number
  partStyles?: Partial<Record<AvoidancePart, Partial<StrokeStyle>>>
  partLabels?: Partial<Record<AvoidancePart, LabelSettings>>
}

export interface LegacyAvoidance extends AvoidanceBase {
  kind?: 'local'
  targetSegmentId: string
  exitSegmentId?: string
  side: AvoidanceSide
  openingRatio: number
}

interface NoLegacySource {
  targetSegmentId?: never
  exitSegmentId?: never
  side?: never
  openingRatio?: never
}

export interface CorridorAvoidance extends AvoidanceBase, NoLegacySource {
  kind: 'corridor'
  anchor: SourceAnchor
  gap: number
  /** A normal angle only remembers the chosen side at a coincident boundary contact. */
  alignment?: { kind: 'normal'; angle?: number } | { kind: 'direction'; angle: number }
}

export interface BankClearanceAvoidance extends AvoidanceBase, NoLegacySource {
  kind: 'bank-clearance'
  parentAvoidanceId: string
}

export type Avoidance = LegacyAvoidance | CorridorAvoidance | BankClearanceAvoidance

export function isLegacyAvoidance(value: Avoidance): value is LegacyAvoidance {
  return value.kind === undefined || value.kind === 'local'
}
