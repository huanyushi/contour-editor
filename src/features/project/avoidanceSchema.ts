import type { Avoidance, AvoidancePart, MathematicalKind } from '../contour/avoidanceTypes'
import { label, list, numeric, record, stableId, stroke } from './schema'

export function mathematicalKind(value: unknown, path: string): MathematicalKind | undefined {
  if (value === undefined) return undefined
  if (value !== 'ordinary' && value !== 'pole' && value !== 'isolated' && value !== 'branch')
    throw new Error(`${path} 数学类型无效。`)
  return value
}

function parts<T>(value: unknown, path: string, read: (value: unknown, path: string) => T) {
  const item = record(value, path)
  const result: Partial<Record<AvoidancePart, T>> = {}
  for (const key of Object.keys(item)) {
    if (key !== 'entry' && key !== 'arc' && key !== 'exit')
      throw new Error(`${path} 部件无效：${key}`)
    result[key] = read(item[key], `${path}.${key}`)
  }
  return result
}

/** Same value rules for untrusted files and typed editor candidates. */
export function readAvoidanceAppearance(
  value: unknown,
  path: string,
): Pick<Avoidance, 'partStyles' | 'partLabels'> {
  const item = record(value, path)
  return {
    ...(item.partStyles === undefined
      ? {}
      : { partStyles: parts(item.partStyles, `${path}样式`, (v, p) => stroke(v, p, true)) }),
    ...(item.partLabels === undefined
      ? {}
      : { partLabels: parts(item.partLabels, `${path}标签`, label) }),
  }
}

export function readAvoidances(
  value: unknown,
  readId: (value: unknown, path: string) => string,
  max: number,
): Avoidance[] {
  if (value === undefined) return []
  return list(value, '绕行声明', 0, max).map((entry, index) => {
    const path = `绕行 ${index + 1}`
    const item = record(entry, path)
    if (item.side !== 'left' && item.side !== 'right') throw new Error(`${path} 方向无效。`)
    return {
      id: readId(item.id, path),
      markerId: stableId(item.markerId, `${path}标记`),
      targetSegmentId: stableId(item.targetSegmentId, `${path}源路径`),
      ...(item.exitSegmentId === undefined
        ? {}
        : { exitSegmentId: stableId(item.exitSegmentId, `${path}离开源路径`) }),
      radius: numeric(item.radius, `${path}.radius`),
      side: item.side,
      openingRatio: numeric(item.openingRatio, `${path}.openingRatio`),
      ...readAvoidanceAppearance(item, path),
    }
  })
}
