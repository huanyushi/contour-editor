import { createInitialState, type ContourState } from '../features/contour/model'
import { defaultLabel, defaultPointStyle } from '../features/contour/appearance'

export function createAvoidanceFixture(): ContourState {
  return {
    ...createInitialState(),
    markers: [
      {
        id: 'pole',
        re: 0,
        im: 0,
        mathematicalKind: 'pole',
        label: defaultLabel('z_0'),
        pointStyle: defaultPointStyle(),
      },
    ],
    avoidances: [
      {
        id: 'avoid-1',
        markerId: 'pole',
        targetSegmentId: 'edge-a',
        radius: 0.5,
        side: 'left',
        openingRatio: 0.5,
      },
    ],
  }
}

/** Accepted legacy source geometry at the default projection's finite boundary. */
export function createHugeOrdinaryArcFixture(magnitude = 3e306): ContourState {
  const state = createAvoidanceFixture()
  state.avoidances = []
  state.markers[0].mathematicalKind = 'ordinary'
  state.markers.push(
    { ...state.markers[0], id: 'huge-start', re: -magnitude, im: 0 },
    { ...state.markers[0], id: 'huge-end', re: magnitude, im: 0 },
  )
  state.connections.push({
    id: 'huge-arc',
    kind: 'arc',
    startId: 'huge-start',
    endId: 'huge-end',
    through: { re: 0, im: magnitude },
  })
  return state
}
