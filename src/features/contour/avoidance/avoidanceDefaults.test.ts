import { expect, it } from 'vitest'
import { contourTemplates, createRectangleState } from '../templates'
import { defaultLabel, defaultPointStyle } from '../appearance'
import { makeAvoidanceTarget } from './avoidanceTarget'
import type { ContourState } from '../model'
import { createConnectedFixture } from '../../../test/connectedAvoidanceFixtures'
import { constructAvoidances } from './avoidanceConstructionTable'
import { validateAvoidances } from './avoidanceValidation'

function target(state: ContourState, re: number, im: number) {
  state.markers = [
    {
      id: 'pole',
      re,
      im,
      mathematicalKind: 'isolated',
      label: defaultLabel(),
      pointStyle: defaultPointStyle(),
    },
  ]
  const result = makeAvoidanceTarget(state, 'pole', {
    renderedId: state.segments[0].id,
    point: { re: 0, im: 3 },
  })
  if (!result.ok) throw new Error(result.error)
  return result.value
}

it('uses a common mathematical radius on and off a source and independent of zoom', () => {
  const state = createRectangleState()
  const off = target(state, 0, 1)
  const on = target(state, 0, 0)
  state.viewport = { ...state.viewport, scaleX: 300, scaleY: 100 }
  expect(target(state, 0, 1).radius).toBe(off.radius)
  expect(on.radius).toBe(off.radius)
})

it('suggests about 0.4 at the center of the ordinary radius-three circle without template branching', () => {
  const state = contourTemplates.find((t) => t.id === 'circle')!.create()
  expect(target(state, 0, 0).radius).toBe(0.4)
  for (const p of state.vertices) {
    p.re *= 10
    p.im *= 10
  }
  state.segments = state.segments.map((s) =>
    s.kind === 'arc' ? { ...s, through: { re: s.through.re * 10, im: s.through.im * 10 } } : s,
  )
  expect(target(state, 0, 0).radius).toBe(4)
})

it('reuses the existing parent radius but does not copy a small child-clearance radius', () => {
  const state = createRectangleState()
  const first = target(state, -1, 1)
  first.radius = 0.55
  state.avoidances = [first]
  expect(target(state, 1, 1).radius).toBe(0.55)
})

it('does not shrink a fitting radius just because a different rectangle edge is shorter', () => {
  const state = createRectangleState()
  target(state, -4, 1.5)
  const result = makeAvoidanceTarget(state, 'pole', { renderedId: state.segments[3].id })
  expect(result).toMatchObject({ ok: true, value: { radius: 0.4 } })
})

it('shrinks only a default that cannot fit near an actual source endpoint', () => {
  const state = createRectangleState()
  const value = target(state, -3.9, 0)
  expect(value.radius).toBeLessThan(0.1)
  expect(value.radius).toBeGreaterThan(0)
})

function bankTarget(state: ContourState, bank: 'entry' | 'exit' = 'entry') {
  const result = makeAvoidanceTarget(state, 'pole', { renderedId: `avoid:parent:${bank}` })
  if (!result.ok) throw new Error(result.error)
  return result.value
}

it.each(['entry', 'exit'] as const)(
  'reuses the parent radius for a new clearance from the %s bank, independent of zoom',
  (bank) => {
    const state = createConnectedFixture({ radius: 0.2, gap: 0.12, clearanceRadius: 0.03 })
    state.avoidances = state.avoidances.slice(0, 1)
    const child = bankTarget(state, bank)
    expect(child.radius).toBe(0.2)
    expect(validateAvoidances({ ...state, avoidances: [...state.avoidances, child] }).ok).toBe(true)
    state.viewport = { ...state.viewport, scaleX: 300, scaleY: 100 }
    expect(bankTarget(state, bank).radius).toBe(0.2)
  },
)

it('uses the selected bank parent, not another earlier parent with a manually different radius', () => {
  const state = createConnectedFixture({ radius: 0.2, gap: 0.12, clearanceRadius: 0.03 })
  state.avoidances = state.avoidances.slice(0, 1)
  state.markers.push(
    ...[-4, -3, -2].map((re, i) => ({
      ...state.markers[1],
      id: `other-${i}`,
      re,
      im: 2,
      mathematicalKind: i === 1 ? ('isolated' as const) : ('ordinary' as const),
    })),
  )
  state.connections.push({ id: 'other-source', kind: 'line', startId: 'other-0', endId: 'other-2' })
  state.avoidances.unshift({
    id: 'other-parent',
    markerId: 'other-1',
    targetSegmentId: 'other-source',
    radius: 0.1,
    side: 'left',
    openingRatio: 0.5,
  })
  const child = bankTarget(state)
  expect(child).toMatchObject({ parentAvoidanceId: 'parent', radius: 0.2 })
  expect(validateAvoidances({ ...state, avoidances: [...state.avoidances, child] }).ok).toBe(true)
})

it('shrinks a clearance default only when the shared radius would invade a finite bank endpoint', () => {
  const state = createConnectedFixture({ radius: 0.2, gap: 0.12, clearanceRadius: 0.03 })
  state.avoidances = state.avoidances.slice(0, 1)
  state.markers[1].re = 0.88
  const child = bankTarget(state)
  expect(child.radius).toBe(0.1)
  expect(state.avoidances[0].radius).toBe(0.2)
  const document = { ...state, avoidances: [...state.avoidances, child] }
  const table = constructAvoidances(document)
  if (!table.ok) throw new Error(table.error)
  expect(table.value.clearances.get(child.id)!.cuts).toHaveLength(2)
  expect(validateAvoidances(document).ok).toBe(true)
})

it('preserves the shared radius in a repairable draft rather than shrinking around unrelated crossings', () => {
  const state = createConnectedFixture({ radius: 0.2, gap: 0.12, clearanceRadius: 0.03 })
  state.avoidances = state.avoidances.slice(0, 1)
  state.markers.push(
    ...[0.35, 0.65].map((re, i) => ({
      ...state.markers[1],
      id: `cross-${i}`,
      re,
      im: 0.18,
      mathematicalKind: 'ordinary' as const,
    })),
  )
  state.connections.push({ id: 'crossing', kind: 'line', startId: 'cross-0', endId: 'cross-1' })
  const child = bankTarget(state)
  expect(child.radius).toBe(0.2)
  const preview = validateAvoidances({ ...state, avoidances: [...state.avoidances, child] })
  expect(preview.ok).toBe(false)
  if (preview.ok) throw new Error('Expected a crossing error')
  expect(preview.error).toMatch(/相交|相切|重叠/)
})
