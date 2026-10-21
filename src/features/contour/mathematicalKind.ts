import type { MathematicalKind } from './avoidanceTypes'

export const mathematicalCategories = ['ordinary', 'isolated', 'branch'] as const
type MathematicalCategory = (typeof mathematicalCategories)[number]

export const mathematicalNames: Record<MathematicalCategory, string> = {
  ordinary: '普通点',
  isolated: '孤立奇点',
  branch: '支点',
}

/** Group legacy poles for display without rewriting their persisted metadata. */
export function mathematicalCategory(kind?: MathematicalKind): MathematicalCategory {
  return kind === 'pole' ? 'isolated' : (kind ?? 'ordinary')
}
