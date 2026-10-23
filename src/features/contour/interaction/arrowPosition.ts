import { inRange } from '../appearance'
import type { ContourState } from '../model'
import { findSegment, segmentOrigin } from '../scene/sceneObjects'
import { pieceAppearance } from '../sourcePieces'

/** Persist only to the stable source owner, never a transient rendered fragment. */
export function setArrowPosition(state: ContourState, id: string, position: number): ContourState {
  if (!inRange(position, 0, 1)) return { ...state, error: '箭头位置须为 0–1 之间的有限数值。' }
  const origin = segmentOrigin(state, id)
  if (!origin) return state
  if (origin.kind === 'avoidance') {
    const owner = state.avoidances.find((a) => a.id === origin.avoidanceId)
    if (!owner || (owner.partArrowPositions?.[origin.part] ?? 0.5) === position) return state
    return {
      ...state,
      error: '',
      avoidances: state.avoidances.map((a) =>
        a === owner
          ? {
              ...a,
              partArrowPositions: { ...a.partArrowPositions, [origin.part]: position },
            }
          : a,
      ),
    }
  }
  const source = findSegment(state, origin.sourceSegmentId)
  if (!source) return state
  const key = origin.collection === 'connection' ? 'connections' : 'segments'
  if (origin.kind === 'gap') {
    const own = pieceAppearance(source, origin.piece)
    if ((own?.arrowPosition ?? 0.5) === position) return state
    const updated = { ...origin.piece, ...own, arrowPosition: position }
    return {
      ...state,
      error: '',
      [key]: state[key].map((s) =>
        s === source
          ? {
              ...s,
              pieces: own
                ? s.pieces!.map((p) => (p === own ? updated : p))
                : [...(s.pieces ?? []), updated],
            }
          : s,
      ),
    }
  }
  if ((source.arrowPosition ?? 0.5) === position) return state
  return {
    ...state,
    error: '',
    [key]: state[key].map((s) => (s === source ? { ...s, arrowPosition: position } : s)),
  }
}
