import { expect, it } from 'vitest'
import { createConnectedFixture } from '../../../test/connectedAvoidanceFixtures'
import { createAvoidanceFixture } from '../../../test/avoidanceFixtures'
import { constructAvoidances } from './avoidanceConstructionTable'

it('normalizes isolated and branch parents to the same geometry', () => {
  const isolated = constructAvoidances(createConnectedFixture({ kind: 'isolated' }))
  const branch = constructAvoidances(createConnectedFixture({ kind: 'branch' }))
  expect(isolated.ok && branch.ok).toBe(true)
  if (!isolated.ok || !branch.ok) throw new Error('expected valid parents')
  expect(isolated.value.parents.get('parent')!.geometry).toEqual(
    branch.value.parents.get('parent')!.geometry,
  )
})

it('exposes the actual spacing of legacy nonzero connectors', () => {
  const state = createAvoidanceFixture()
  state.markers[0].im = 1
  const result = constructAvoidances(state)
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(result.error)
  expect(result.value.parents.get('avoid-1')!.bankPair!.gap).toBe(0.5)
})

it('does not invent banks for automatically expanded legacy openings with zero connectors', () => {
  const state = createAvoidanceFixture()
  state.markers[0].im = 0.3
  state.avoidances[0].openingRatio = 0.1
  const result = constructAvoidances(state)
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(result.error)
  expect(result.value.parents.get('avoid-1')!.bankPair).toBeUndefined()
})

it('resolves children independently of declaration order', () => {
  const state = createConnectedFixture({ clearanceRadius: 0.1 })
  state.avoidances.reverse()
  const result = constructAvoidances(state)
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(result.error)
  expect(result.value.clearances.get('clearance')!.cuts).toHaveLength(2)
  for (const cut of result.value.clearances.get('clearance')!.cuts) {
    expect(cut.arc.center).toEqual({ re: 0.5, im: 0 })
    expect(cut.arc.radius).toBe(0.1)
  }
})

it.each(['missing', 'clearance'])('rejects an invalid parent reference %s', (parentAvoidanceId) => {
  const state = createConnectedFixture({ clearanceRadius: 0.1 })
  const child = state.avoidances.find((a) => a.kind === 'bank-clearance')!
  if (child.kind !== 'bank-clearance') throw new Error('fixture')
  child.parentAvoidanceId = parentAvoidanceId
  expect(constructAvoidances(state).ok).toBe(false)
})
