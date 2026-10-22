import { defaultLabel, defaultPointStyle } from '../features/contour/appearance'
import { createInitialState, type ContourState } from '../features/contour/model'

export function createConnectedFixture(
  options: {
    kind?: 'isolated' | 'branch'
    radius?: number
    gap?: number
    clearanceRadius?: number
  } = {},
): ContourState {
  const state = createInitialState()
  state.vertices = [
    { id: 'right', re: 1, im: 0 },
    { id: 'left', re: -1, im: 0 },
  ]
  state.segments = [
    { id: 'upper', kind: 'arc', startId: 'right', endId: 'left', through: { re: 0, im: 1 } },
    { id: 'lower', kind: 'arc', startId: 'left', endId: 'right', through: { re: 0, im: -1 } },
  ]
  state.markers = [
    {
      id: 'center',
      re: 0,
      im: 0,
      mathematicalKind: options.kind ?? 'branch',
      label: defaultLabel('0'),
      pointStyle: defaultPointStyle(),
    },
  ]
  state.avoidances = [
    {
      id: 'parent',
      kind: 'corridor',
      markerId: 'center',
      anchor: { kind: 'vertex', vertexId: 'right', segmentId: 'upper' },
      radius: options.radius ?? 0.1,
      gap: options.gap ?? 0.04,
    },
  ]
  if (options.clearanceRadius !== undefined) {
    state.markers.push({
      id: 'pole',
      re: 0.5,
      im: 0,
      mathematicalKind: 'isolated',
      label: defaultLabel('z_0'),
      pointStyle: defaultPointStyle(),
    })
    state.avoidances.push({
      id: 'clearance',
      kind: 'bank-clearance',
      markerId: 'pole',
      parentAvoidanceId: 'parent',
      radius: options.clearanceRadius,
    })
  }
  state.selection = { kind: 'none' }
  state.selectedId = ''
  state.selectedSegmentId = ''
  state.closed = true
  return state
}

export function createRectangleConnectedFixture(gap = 0.2): ContourState {
  const state = createConnectedFixture({ radius: 0.4, gap })
  state.vertices = [
    { id: 'a', re: -2, im: 0 },
    { id: 'b', re: 2, im: 0 },
    { id: 'c', re: 2, im: 3 },
    { id: 'd', re: -2, im: 3 },
  ]
  state.segments = state.vertices.map((p, i, points) => ({
    kind: 'line',
    id: `edge-${p.id}`,
    startId: p.id,
    endId: points[(i + 1) % points.length].id,
  }))
  state.markers[0].im = 1
  state.markers[0].label.visible = false
  state.avoidances = [
    {
      kind: 'corridor',
      id: 'parent',
      markerId: 'center',
      radius: 0.4,
      gap,
      anchor: { kind: 'segment', segmentId: 'edge-a', t: 0.5 },
    },
  ]
  state.viewport = { ...state.viewport, scaleX: 80, scaleY: 80 }
  state.snap = false
  return state
}
