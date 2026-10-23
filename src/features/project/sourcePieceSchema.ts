import type { SourcePieceAppearance } from '../contour/sourcePieces'
import { sourcePieceId } from '../contour/sourcePieces'
import type { ContourState } from '../contour/model'
import { arrowPosition, label, list, record, stableId, stroke } from './schema'

export const MAX_SOURCE_PIECES = 2001

export function readSourcePieces(
  value: unknown,
  path: string,
  version: number,
): SourcePieceAppearance[] | undefined {
  if (value === undefined) return undefined
  if (version < 5) throw new Error(`${path}片段设置需要项目文件版本 5。`)
  const seen = new Set<string>()
  const pieces = list(value, `${path}片段`, 0, MAX_SOURCE_PIECES).map((raw, index) => {
    const at = `${path}片段 ${index + 1}`
    const item = record(raw, at)
    const piece: SourcePieceAppearance = {
      startAvoidanceId:
        item.startAvoidanceId === null ? null : stableId(item.startAvoidanceId, `${at}起始绕行`),
      endAvoidanceId:
        item.endAvoidanceId === null ? null : stableId(item.endAvoidanceId, `${at}结束绕行`),
      ...(item.style === undefined
        ? {}
        : { style: stroke(item.style, `${at}样式`, true, version) }),
      ...(item.label === undefined ? {} : { label: label(item.label, `${at}标签`) }),
      ...(item.arrowPosition === undefined
        ? {}
        : { arrowPosition: arrowPosition(item.arrowPosition, `${at}箭头位置`, version) }),
    }
    if (piece.startAvoidanceId === null && piece.endAvoidanceId === null)
      throw new Error(`${at}必须具有绕行边界。`)
    const id = sourcePieceId('', piece)
    if (seen.has(id)) throw new Error(`${at}边界重复。`)
    seen.add(id)
    return piece
  })
  return pieces.length ? pieces : undefined
}

export function validateSourcePieces(
  state: Pick<ContourState, 'segments' | 'connections' | 'avoidances'>,
): void {
  const parents = new Set(
    state.avoidances.filter((a) => a.kind !== 'bank-clearance').map((a) => a.id),
  )
  for (const source of [...state.segments, ...state.connections]) {
    const pieces = readSourcePieces(source.pieces, `源路径 ${source.id}`, 7)
    for (const piece of pieces ?? [])
      if (
        [piece.startAvoidanceId, piece.endAvoidanceId].some((id) => id !== null && !parents.has(id))
      )
        throw new Error(`源路径 ${source.id} 的片段引用不存在的父绕行。`)
  }
}
