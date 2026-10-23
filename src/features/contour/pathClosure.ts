import { defaultLabel, defaultPointStyle } from './appearance'
import type { ContourState, PathSegment } from './model'
import { activeSegments, singleChainEnds } from './pathTopology'

/** Keep the suffix as a contour and move its incoming tail to independent geometry. */
export function closeContourAtVertex(
  state: ContourState,
  id: string,
  line: (startId: string, endId: string, preferred: string) => PathSegment,
): ContourState {
  if (state.closed || !state.vertices.some((v) => v.id === id)) return state
  const active = activeSegments(state)
  const ends = singleChainEnds({ ...state, segments: active })
  if (!ends)
    return state.vertices.length < 2
      ? state
      : { ...state, error: '请先将围道整理为一条连续路径，再点击端点闭合。' }
  if (ends.endId === id) return state

  const outgoing = new Map(active.map((s) => [s.startId, s]))
  const suffix: PathSegment[] = []
  const loopIds = new Set([id])
  let current = outgoing.get(id)
  while (current) {
    suffix.push(current)
    loopIds.add(current.endId)
    current = outgoing.get(current.endId)
  }

  const retained = state.segments.find(
    (s) => !active.includes(s) && s.startId === ends.endId && s.endId === id,
  )
  const connection = state.connections.find(
    (s) =>
      s.kind === 'line' &&
      ((s.startId === ends.endId && s.endId === id) ||
        (s.startId === id && s.endId === ends.endId)),
  )
  const closing =
    retained ??
    (connection
      ? { ...connection, startId: ends.endId, endId: id }
      : line(ends.endId, id, 'edge-close'))
  const loop = state.vertices.filter((v) => loopIds.has(v.id))
  const first = loop[0]
  const second = loop.find((v) => v.re !== first.re || v.im !== first.im)
  const noncollinear =
    second &&
    loop.some(
      (v) =>
        (second.re - first.re) * (v.im - first.im) !== (second.im - first.im) * (v.re - first.re),
    )
  if (!noncollinear && ![...suffix, closing].some((s) => s.kind === 'arc'))
    return { ...state, error: '至少需要三个不共线端点或一段圆弧才能闭合。' }

  // Preserve implicit z_n labels when points change category or array index.
  const originalIndex = new Map(state.vertices.map((v, index) => [v.id, index]))
  const vertices = loop.map((v, index) =>
    !v.label && originalIndex.get(v.id) !== index
      ? { ...v, label: defaultLabel(`z_{${originalIndex.get(v.id)! + 1}}`) }
      : v,
  )
  const markers = state.vertices
    .filter((v) => !loopIds.has(v.id))
    .map((v) => ({
      ...v,
      label: v.label ?? defaultLabel(`z_{${originalIndex.get(v.id)! + 1}}`),
      pointStyle: v.pointStyle ?? defaultPointStyle(),
    }))
  const suffixIds = new Set(suffix.map((s) => s.id))
  return {
    ...state,
    vertices,
    segments: [...suffix, closing],
    markers: markers.length ? [...state.markers, ...markers] : state.markers,
    connections: [
      ...state.connections.filter((s) => s.id !== closing.id),
      ...active.filter((s) => !suffixIds.has(s.id)),
    ],
    selectedSegmentId: closing.id,
    closed: true,
    error: '',
  }
}
