import { expect, it } from 'vitest'
import { createAvoidanceFixture } from '../../test/avoidanceFixtures'
import {
  createConnectedFixture,
  createRectangleConnectedFixture,
} from '../../test/connectedAvoidanceFixtures'
import { makeAvoidanceTarget } from './avoidanceTarget'
import {
  avoidanceDirectionPatch,
  avoidancePortPatch,
  editableAvoidance,
} from './avoidanceParameters'

it('snaps a nearly vertical opening to the source normal but preserves the unsnapped port when bypassed', () => {
  const state = createRectangleConnectedFixture()
  const metric = { a: 80, b: 0, c: 0, d: -80 }
  const point = { re: -0.075, im: 0 }
  const raw = avoidancePortPatch(state, state.avoidances[0], point, -1, metric)
  const snapped = avoidancePortPatch(state, state.avoidances[0], point, -1, metric, true)
  if (!raw.ok || !snapped.ok) throw new Error('Expected valid port patches')
  expect(snapped.value).toMatchObject({
    anchor: { t: expect.closeTo(0.5, 10) },
    alignment: { kind: 'direction', angle: 270 },
  })
  expect(raw.value.anchor).not.toEqual(snapped.value.anchor)
})

it('snaps horizontal openings using CSS distance even with unequal axis scales', () => {
  const state = createConnectedFixture()
  const angle = 0.025
  const point = {
    re: Math.sqrt(1 - 0.02 ** 2) * Math.cos(angle) - 0.02 * Math.sin(angle),
    im: Math.sqrt(1 - 0.02 ** 2) * Math.sin(angle) + 0.02 * Math.cos(angle),
  }
  const snapped = avoidancePortPatch(
    state,
    state.avoidances[0],
    point,
    1,
    { a: 160, b: 0, c: 0, d: -40 },
    true,
  )
  expect(snapped).toMatchObject({ ok: true, value: { alignment: { kind: 'direction', angle: 0 } } })
})

it('updates the saved manual angle on a subsequent unsnapped port drag', () => {
  const state = createConnectedFixture()
  const value = { ...state.avoidances[0], alignment: { kind: 'direction' as const, angle: 0 } }
  const angle = (5 * Math.PI) / 180
  const port = angle + Math.asin(0.02)
  const patch = avoidancePortPatch(state, value, { re: Math.cos(port), im: Math.sin(port) }, 1, {
    a: 160,
    b: 0,
    c: 0,
    d: -160,
  })
  expect(patch).toMatchObject({
    ok: true,
    value: { alignment: { kind: 'direction', angle: expect.closeTo(5, 9) } },
  })
})
import { contourReducer, type ContourState } from './model'
import { validateAvoidances } from './avoidanceValidation'
import { defaultLabel } from './appearance'

it('automatically connects an off-path point using the normal foot rather than the click location', () => {
  const state = createRectangleConnectedFixture()
  state.avoidances = []
  const result = makeAvoidanceTarget(state, 'center', {
    renderedId: 'edge-a',
    point: { re: 1.5, im: 0 },
  })
  expect(result).toMatchObject({
    ok: true,
    value: { kind: 'corridor', anchor: { kind: 'segment', segmentId: 'edge-a', t: 0.5 } },
  })
})

it('keeps the click direction for a concentric source circle with a source-scale initial radius', () => {
  const state = createConnectedFixture()
  state.avoidances = []
  const result = makeAvoidanceTarget(state, 'center', {
    renderedId: 'upper',
    point: { re: Math.SQRT1_2, im: Math.SQRT1_2 },
  })
  expect(result.ok).toBe(true)
  if (!result.ok || result.value.kind !== 'corridor') throw new Error('expected connected parent')
  expect(result.value.anchor).toMatchObject({
    kind: 'segment',
    segmentId: 'upper',
    t: expect.closeTo(0.25, 9),
  })
  expect(result.value.radius).toBe(0.1)
  expect(result.value.radius).toBeLessThan(1)
})

it('keeps direct on-path detours instead of inventing zero-length connected banks', () => {
  const state = createAvoidanceFixture()
  state.avoidances = []
  const result = makeAvoidanceTarget(state, 'pole', {
    renderedId: 'edge-a',
    point: { re: 1, im: 0 },
  })
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(result.error)
  expect(result.value.kind).not.toBe('corridor')
})

it('converts an editable old off-path binding only on geometry edits and preserves actual spacing', () => {
  const state = createAvoidanceFixture()
  state.markers[0].im = 1
  const original = state.avoidances[0]
  expect(editableAvoidance(state, original)).toMatchObject({
    kind: 'corridor',
    id: original.id,
    radius: 0.5,
    gap: 0.5,
  })
  expect(original.kind).toBeUndefined()
  const next = contourReducer(state, {
    type: 'updateAvoidance',
    id: original.id,
    patch: { radius: 0.8 },
  })
  expect(next.error).toBe('')
  expect(next.avoidances[0]).toMatchObject({ kind: 'corridor', radius: 0.8, gap: 0.5 })
  expect(next.vertices).toBe(state.vertices)
})

it('rejects a direction that invalidates child clearances atomically', () => {
  const state = createConnectedFixture({ clearanceRadius: 0.05 })
  const patch = avoidanceDirectionPatch(state, state.avoidances[0], 90)
  expect(patch.ok).toBe(true)
  if (!patch.ok) throw new Error(patch.error)
  const next = contourReducer(state, { type: 'updateAvoidance', id: 'parent', patch: patch.value })
  expect(next.error).not.toBe('')
  expect(next.avoidances).toBe(state.avoidances)
})

it.each([false, true])(
  'keeps a legacy diameter opening editable without invalid conversion (child: %s)',
  (child) => {
    const fixture = createAvoidanceFixture()
    fixture.markers[0].im = 1
    fixture.avoidances[0].openingRatio = 1
    fixture.avoidances[0].partLabels = { arc: defaultLabel('C') }
    const state: ContourState = {
      ...fixture,
      markers: child
        ? [...fixture.markers, { ...fixture.markers[0], id: 'child-pole', im: 0.4 }]
        : fixture.markers,
      avoidances: child
        ? [
            ...fixture.avoidances,
            {
              kind: 'bank-clearance',
              id: 'child',
              markerId: 'child-pole',
              parentAvoidanceId: 'avoid-1',
              radius: 0.55,
            },
          ]
        : fixture.avoidances,
    }
    expect(validateAvoidances(state).ok).toBe(true)
    const original = state.avoidances[0]
    expect(editableAvoidance(state, original)).toBe(original)
    for (const radius of [0.5, 0.4]) {
      const next = contourReducer(state, {
        type: 'updateAvoidance',
        id: original.id,
        patch: { radius },
      })
      expect(next.error).toBe('')
      expect(next.avoidances[0]).toMatchObject({
        radius,
        openingRatio: 1,
        partLabels: original.partLabels,
      })
      expect(next.avoidances[0].kind).toBeUndefined()
      if (child) expect(next.avoidances[1]).toBe(state.avoidances[1])
    }
  },
)

it('refuses an opening direction that would migrate a visible detour to the hidden closing edge', () => {
  const state = createRectangleConnectedFixture()
  state.closed = false
  expect(validateAvoidances(state).ok).toBe(true)
  expect(avoidanceDirectionPatch(state, state.avoidances[0], 180)).toMatchObject({ ok: false })
  const visible = avoidanceDirectionPatch(state, state.avoidances[0], 0)
  expect(visible.ok).toBe(true)
  if (!visible.ok) throw new Error(visible.error)
  const next = contourReducer(state, {
    type: 'updateAvoidance',
    id: 'parent',
    patch: visible.value,
  })
  expect(next.error).toBe('')
  expect(next.avoidances[0]).toMatchObject({
    radius: 0.4,
    gap: 0.2,
    anchor: { segmentId: 'edge-b' },
  })
})

it('refuses a visible circular anchor whose detour needs the hidden source arc', () => {
  const state = createConnectedFixture()
  state.closed = false
  if (state.avoidances[0].kind !== 'corridor') throw new Error('fixture')
  state.avoidances[0].anchor = { kind: 'segment', segmentId: 'upper', t: 0.5 }
  expect(validateAvoidances(state).ok).toBe(true)
  expect(avoidanceDirectionPatch(state, state.avoidances[0], 0).ok).toBe(false)
  expect(avoidanceDirectionPatch(state, state.avoidances[0], 45).ok).toBe(true)
  expect(
    avoidancePortPatch(
      state,
      state.avoidances[0],
      { re: Math.cos(0.005), im: Math.sin(0.005) },
      1,
      { a: 200, b: 0, c: 0, d: -200 },
    ).ok,
  ).toBe(false)
})
