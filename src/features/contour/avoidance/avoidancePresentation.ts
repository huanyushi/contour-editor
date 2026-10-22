import type { AvoidancePart } from './avoidanceTypes'

export const avoidancePartNames: Readonly<Record<AvoidancePart, string>> = {
  entry: '进入连接段',
  arc: '绕行圆弧',
  exit: '离开连接段',
  'bank-entry': '进入岸避让弧',
  'bank-exit': '离开岸避让弧',
}
