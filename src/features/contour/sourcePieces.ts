import type { LabelSettings, StrokeStyle } from './appearance'
import type { ContourState, PathSegment } from './model'

export interface SourcePieceBoundary {
  startAvoidanceId: string | null
  endAvoidanceId: string | null
}
export interface SourcePieceAppearance extends SourcePieceBoundary {
  style?: Partial<StrokeStyle>
  label?: LabelSettings
}
export type SourcePieceAction =
  | {
      type: 'sourcePieceStyle'
      sourceId: string
      boundary: SourcePieceBoundary
      patch: Partial<StrokeStyle>
    }
  | {
      type: 'sourcePieceLabel'
      sourceId: string
      boundary: SourcePieceBoundary
      label: LabelSettings
    }

export function sourcePieceId(sourceId: string, boundary: SourcePieceBoundary): string {
  const start = boundary.startAvoidanceId === null ? 'start' : `a-${boundary.startAvoidanceId}`
  const end = boundary.endAvoidanceId === null ? 'end' : `a-${boundary.endAvoidanceId}`
  return `piece:${sourceId}:${start}:${end}`
}

function samePiece(a: SourcePieceBoundary, b: SourcePieceBoundary): boolean {
  return a.startAvoidanceId === b.startAvoidanceId && a.endAvoidanceId === b.endAvoidanceId
}

export function pieceAppearance(source: PathSegment, boundary: SourcePieceBoundary) {
  return source.pieces?.find((piece) => samePiece(piece, boundary))
}

export function sourcePieceReducer(state: ContourState, action: SourcePieceAction): ContourState {
  const key = state.connections.some((s) => s.id === action.sourceId) ? 'connections' : 'segments'
  return {
    ...state,
    [key]: state[key].map((source) => {
      if (source.id !== action.sourceId) return source
      const original = pieceAppearance(source, action.boundary)
      const piece: SourcePieceAppearance = {
        ...action.boundary,
        ...original,
        ...(action.type === 'sourcePieceStyle'
          ? { style: { ...original?.style, ...action.patch } }
          : { label: action.label }),
      }
      const pieces = original
        ? source.pieces!.map((p) => (p === original ? piece : p))
        : [...(source.pieces ?? []), piece]
      return { ...source, pieces }
    }),
    error: '',
  }
}

/** Only true dependency removal deletes overrides; hiding/repositioning keeps them. */
export function reconcileSourcePieces(
  before: ContourState,
  candidate: ContourState,
  reverseGeometry = false,
): ContourState {
  const live = new Set(candidate.avoidances.map((a) => a.id))
  const originals = new Map([...before.segments, ...before.connections].map((s) => [s.id, s]))
  let changed = false
  const update = (source: PathSegment): PathSegment => {
    if (!source.pieces) return source
    const old = originals.get(source.id)
    const reversed =
      reverseGeometry && old && old.startId === source.endId && old.endId === source.startId
    const pieces = source.pieces.filter(
      (p) =>
        (p.startAvoidanceId === null || live.has(p.startAvoidanceId)) &&
        (p.endAvoidanceId === null || live.has(p.endAvoidanceId)),
    )
    if (!reversed && pieces.length === source.pieces.length) return source
    changed = true
    const rest = { ...source }
    delete rest.pieces
    return pieces.length
      ? {
          ...rest,
          pieces: reversed
            ? pieces.map((p) => ({
                ...p,
                startAvoidanceId: p.endAvoidanceId,
                endAvoidanceId: p.startAvoidanceId,
              }))
            : pieces,
        }
      : rest
  }
  const segments = candidate.segments.map(update)
  const connections = candidate.connections.map(update)
  return changed ? { ...candidate, segments, connections } : candidate
}
