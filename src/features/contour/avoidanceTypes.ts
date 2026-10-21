import type { LabelSettings, StrokeStyle } from './appearance'

export type MathematicalKind = 'ordinary' | 'pole' | 'isolated' | 'branch'
export type AvoidanceSide = 'left' | 'right'
export type AvoidancePart = 'entry' | 'arc' | 'exit'

export interface Avoidance {
  id: string
  markerId: string
  targetSegmentId: string
  exitSegmentId?: string
  radius: number
  side: AvoidanceSide
  openingRatio: number
  partStyles?: Partial<Record<AvoidancePart, Partial<StrokeStyle>>>
  partLabels?: Partial<Record<AvoidancePart, LabelSettings>>
}
