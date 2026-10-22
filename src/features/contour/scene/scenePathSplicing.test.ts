import { expect, it } from 'vitest'
import {
  createConnectedFixture,
  createRectangleConnectedFixture,
} from '../../../test/connectedAvoidanceFixtures'
import { defaultLabel } from '../appearance'
import { validateAvoidances } from '../avoidance/avoidanceValidation'
import { contourReducer } from '../model'

it('anchors a parent label halfway along its own remaining bank, excluding child arcs', () => {
  const state = createConnectedFixture({ radius: 0.1, gap: 0.04, clearanceRadius: 0.12 })
  state.avoidances[0].partLabels = { entry: { ...defaultLabel('L'), dx: 0, dy: 0 } }
  const result = validateAvoidances(state)
  if (!result.ok) throw new Error(result.error)
  const labels = result.scene.labels.filter((l) => l.target.id === 'avoid:parent:entry')
  expect(labels).toHaveLength(1)
  const outer = Math.sqrt(1 - 0.02 ** 2)
  const inner = Math.sqrt(0.1 ** 2 - 0.02 ** 2)
  expect(labels[0].anchor.re).toBeCloseTo(
    (outer + inner) / 2 + Math.sqrt(0.12 ** 2 - 0.02 ** 2),
    10,
  )
  expect(labels[0].anchor.im).toBeCloseTo(-0.02, 10)
  const chain = result.scene.partChains!.get('avoid:parent:entry')!
  expect(chain.map((s) => s.kind)).toEqual(['line', 'arc', 'line'])
})

it('keeps a vanished bank label setting and restores it when the bank reopens', () => {
  let state = createRectangleConnectedFixture()
  if (state.avoidances[0].kind !== 'corridor') throw new Error('Expected corridor')
  state.avoidances[0] = { ...state.avoidances[0], alignment: { kind: 'normal' as const } }
  state.avoidances[0].partLabels = { entry: defaultLabel('L') }
  const before = state.avoidances[0].partLabels
  state = contourReducer(state, {
    type: 'moveObject',
    kind: 'marker',
    id: 'center',
    point: { re: 0, im: 0 },
  })
  expect(state.error).toBe('')
  const hidden = validateAvoidances(state)
  if (!hidden.ok) throw new Error(hidden.error)
  expect(hidden.scene.labels.filter((l) => l.value.tex === 'L')).toHaveLength(0)
  expect(state.avoidances[0].partLabels).toEqual(before)
  state = contourReducer(state, {
    type: 'moveObject',
    kind: 'marker',
    id: 'center',
    point: { re: 0, im: 1 },
  })
  expect(state.error).toBe('')
  const reopened = validateAvoidances(state)
  if (!reopened.ok) throw new Error(reopened.error)
  expect(reopened.scene.labels.filter((l) => l.value.tex === 'L')).toHaveLength(1)
})

it.each([false, true])(
  'anchors an uncut bank independently of a cut on only its other bank: %s',
  (cut) => {
    const state = createConnectedFixture(cut ? { clearanceRadius: 0.03 } : {})
    if (cut) state.markers[1].im = 0.019
    state.avoidances[0].partLabels = { entry: defaultLabel('L'), exit: defaultLabel('R') }
    const result = validateAvoidances(state)
    if (!result.ok) throw new Error(result.error)
    const label = result.scene.labels.find((l) => l.value.tex === 'L')!
    expect(label.anchor.re).toBeCloseTo(
      (Math.sqrt(1 - 0.02 ** 2) + Math.sqrt(0.1 ** 2 - 0.02 ** 2)) / 2,
      10,
    )
    expect(label.anchor.im).toBeCloseTo(-0.02, 10)
  },
)

it('excludes two separate child arcs from a parent bank midpoint and keeps child labels independent', () => {
  const state = createConnectedFixture({ clearanceRadius: 0.08 })
  state.markers[1].re = 0.35
  state.markers.push({ ...state.markers[1], id: 'second-pole', re: 0.7 })
  state.avoidances.push({
    kind: 'bank-clearance',
    id: 'second',
    markerId: 'second-pole',
    parentAvoidanceId: 'parent',
    radius: 0.06,
    partLabels: { 'bank-entry': defaultLabel('C') },
  })
  state.avoidances[0].partLabels = { entry: defaultLabel('L') }
  const result = validateAvoidances(state)
  if (!result.ok) throw new Error(result.error)
  const label = result.scene.labels.find((l) => l.value.tex === 'L')!
  // Half the retained length is on the middle line, between the two cuts.
  const half =
    (Math.sqrt(1 - 0.02 ** 2) -
      Math.sqrt(0.1 ** 2 - 0.02 ** 2) -
      2 * Math.sqrt(0.08 ** 2 - 0.02 ** 2) -
      2 * Math.sqrt(0.06 ** 2 - 0.02 ** 2)) /
    2
  const firstLength = Math.sqrt(1 - 0.02 ** 2) - 0.7 - Math.sqrt(0.06 ** 2 - 0.02 ** 2)
  expect(label.anchor.re).toBeCloseTo(
    0.7 - Math.sqrt(0.06 ** 2 - 0.02 ** 2) - (half - firstLength),
    10,
  )
  expect(label.anchor.im).toBeCloseTo(-0.02, 10)
  expect(result.scene.labels.filter((l) => l.value.tex === 'C')).toHaveLength(1)
})
