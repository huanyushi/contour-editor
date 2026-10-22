import type { Avoidance, AvoidancePart, MathematicalKind } from '../contour/avoidanceTypes'
import { isLegacyAvoidance } from '../contour/avoidanceTypes'
import { label, list, numeric, record, stableId, stroke } from './schema'
import type { CorridorAvoidance } from '../contour/avoidanceTypes'

export function readAlignment(value: unknown, path: string): CorridorAvoidance['alignment'] {
  if (value === undefined) return undefined
  const item = record(value, `${path}跟随规则`)
  if (item.kind === 'normal')
    return {
      kind: 'normal',
      ...(item.angle === undefined ? {} : { angle: numeric(item.angle, `${path}法向侧别角度`) }),
    }
  if (item.kind === 'direction')
    return { kind: 'direction', angle: numeric(item.angle, `${path}朝向角度`) }
  throw new Error(`${path}跟随规则无效。`)
}

export function mathematicalKind(value: unknown, path: string): MathematicalKind | undefined {
  if (value === undefined) return undefined
  if (value !== 'ordinary' && value !== 'pole' && value !== 'isolated' && value !== 'branch')
    throw new Error(`${path} 数学类型无效。`)
  return value
}

function parts<T>(
  value: unknown,
  path: string,
  read: (value: unknown, path: string) => T,
  allowed: readonly string[],
) {
  const item = record(value, path)
  const result: Partial<Record<AvoidancePart, T>> = {}
  for (const key of Object.keys(item)) {
    if (!allowed.includes(key)) throw new Error(`${path} 部件无效：${key}`)
    result[key as AvoidancePart] = read(item[key], `${path}.${key}`)
  }
  return result
}

/** Same value rules for untrusted files and typed editor candidates. */
export function readAvoidanceAppearance(
  value: unknown,
  path: string,
): Pick<Avoidance, 'partStyles' | 'partLabels'> {
  const item = record(value, path)
  const allowed =
    item.kind === 'bank-clearance' ? ['bank-entry', 'bank-exit'] : ['entry', 'arc', 'exit']
  return {
    ...(item.partStyles === undefined
      ? {}
      : {
          partStyles: parts(item.partStyles, `${path}样式`, (v, p) => stroke(v, p, true), allowed),
        }),
    ...(item.partLabels === undefined
      ? {}
      : { partLabels: parts(item.partLabels, `${path}标签`, label, allowed) }),
  }
}

export function readAvoidances(
  value: unknown,
  readId: (value: unknown, path: string) => string,
  max: number,
  version = 3,
): Avoidance[] {
  if (value === undefined) return []
  return list(value, '绕行声明', 0, max).map((entry, index) => {
    const path = `绕行 ${index + 1}`
    const item = record(entry, path)
    const common = {
      id: readId(item.id, path),
      markerId: stableId(item.markerId, `${path}标记`),
      radius: numeric(item.radius, `${path}.radius`),
      ...readAvoidanceAppearance(item, path),
    }
    if (item.kind === 'corridor' || item.kind === 'bank-clearance') {
      if (version < 4) throw new Error(`${path} 需要项目文件版本 4。`)
      if (item.kind === 'bank-clearance')
        return {
          ...common,
          kind: 'bank-clearance',
          parentAvoidanceId: stableId(item.parentAvoidanceId, `${path}父绕行`),
        }
      const anchor = record(item.anchor, `${path}接入位置`)
      if (item.alignment !== undefined && version < 6)
        throw new Error(`${path}跟随规则需要版本 6。`)
      const alignment = readAlignment(item.alignment, path)
      const following = alignment ? { alignment } : {}
      const segmentId = stableId(anchor.segmentId, `${path}接入源路径`)
      const gap = numeric(item.gap, `${path}.gap`)
      if (anchor.kind === 'vertex')
        return {
          ...common,
          kind: 'corridor',
          ...following,
          gap,
          anchor: {
            kind: 'vertex',
            segmentId,
            vertexId: stableId(anchor.vertexId, `${path}接入顶点`),
          },
        }
      if (anchor.kind !== 'segment') throw new Error(`${path} 接入位置类型无效。`)
      const t = numeric(anchor.t, `${path}接入参数`)
      if (t < 0 || t > 1) throw new Error(`${path} 接入参数须在 0 到 1 之间。`)
      return {
        ...common,
        ...following,
        kind: 'corridor',
        gap,
        anchor: { kind: 'segment', segmentId, t },
      }
    }
    if (item.kind !== undefined && item.kind !== 'local') throw new Error(`${path} 构造类型无效。`)
    if (item.side !== 'left' && item.side !== 'right') throw new Error(`${path} 方向无效。`)
    return {
      ...common,
      ...(item.kind === 'local' ? { kind: 'local' as const } : {}),
      targetSegmentId: stableId(item.targetSegmentId, `${path}源路径`),
      ...(item.exitSegmentId === undefined
        ? {}
        : { exitSegmentId: stableId(item.exitSegmentId, `${path}离开源路径`) }),
      side: item.side,
      openingRatio: numeric(item.openingRatio, `${path}.openingRatio`),
    }
  })
}

/** Explicit source-only serialization, shared by all project writers. */
export function writeAvoidance(value: Avoidance): Avoidance {
  const common = {
    id: value.id,
    markerId: value.markerId,
    radius: value.radius,
    ...(value.partStyles === undefined ? {} : { partStyles: value.partStyles }),
    ...(value.partLabels === undefined ? {} : { partLabels: value.partLabels }),
  }
  if (value.kind === 'corridor')
    return {
      ...common,
      kind: 'corridor',
      anchor: { ...value.anchor },
      gap: value.gap,
      ...(value.alignment ? { alignment: { ...value.alignment } } : {}),
    }
  if (value.kind === 'bank-clearance')
    return { ...common, kind: 'bank-clearance', parentAvoidanceId: value.parentAvoidanceId }
  if (!isLegacyAvoidance(value)) throw new Error('未知绕行类型。')
  return {
    ...common,
    ...(value.kind === undefined ? {} : { kind: value.kind }),
    targetSegmentId: value.targetSegmentId,
    ...(value.exitSegmentId === undefined ? {} : { exitSegmentId: value.exitSegmentId }),
    side: value.side,
    openingRatio: value.openingRatio,
  }
}
