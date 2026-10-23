import { createRectangleConnectedFixture } from './connectedAvoidanceFixtures'

export function createPathArrowFixture() {
  const state = createRectangleConnectedFixture()
  state.markers.push({
    ...state.markers[0],
    id: 'pole',
    re: 0,
    im: 0.5,
    mathematicalKind: 'isolated',
  })
  state.avoidances.push({
    id: 'clearance',
    kind: 'bank-clearance',
    markerId: 'pole',
    parentAvoidanceId: 'parent',
    radius: 0.15,
  })
  return state
}
