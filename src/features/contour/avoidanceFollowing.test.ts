import { expect, it } from 'vitest'
import {
  createConnectedFixture,
  createRectangleConnectedFixture,
} from '../../test/connectedAvoidanceFixtures'
import { contourReducer, type ContourState } from './model'
import {
  avoidanceAngle,
  avoidanceDirectionPatch,
  avoidanceNormalPatch,
} from './avoidanceParameters'
import { serializeProject } from '../project/format'
import { parseProject } from '../project/project'
import { constructAvoidances } from './avoidanceConstructionTable'
import { followAvoidance } from './avoidanceFollowing'
import { createHistory, historyReducer } from './history'

function automatic(state: ContourState) {
  state.avoidances = state.avoidances.map((a) =>
    a.kind === 'corridor' ? { ...a, alignment: { kind: 'normal' as const } } : a,
  )
  return state
}
function move(state: ContourState, re: number, im: number) {
  return contourReducer(state, {
    type: 'moveObject',
    kind: 'marker',
    id: 'center',
    point: { re, im },
  })
}

it('accepts a second manual direction near the source boundary', () => {
  let history = createHistory(createRectangleConnectedFixture())
  const first = avoidanceDirectionPatch(history.present, history.present.avoidances[0], 270)
  if (!first.ok) throw new Error(first.error)
  history = historyReducer(history, { type: 'updateAvoidance', id: 'parent', patch: first.value })
  history = historyReducer(history, {
    type: 'moveObject',
    kind: 'marker',
    id: 'center',
    point: { re: 0, im: 0.3 },
  })
  expect(history.present.error).toBe('')
  const before = history
  const second = avoidanceDirectionPatch(history.present, history.present.avoidances[0], 315)
  expect(second.ok).toBe(true)
  if (!second.ok) throw new Error(second.error)
  history = historyReducer(history, { type: 'updateAvoidance', id: 'parent', patch: second.value })
  expect(history.present.error).toBe('')
  expect(history.present.avoidances[0]).toMatchObject({
    radius: 0.4,
    gap: 0.2,
    alignment: { kind: 'direction', angle: 315 },
    anchor: { kind: 'segment', segmentId: 'edge-a', t: expect.closeTo(0.575, 10) },
  })
  expect(history.past).toHaveLength(before.past.length + 1)
  const undone = historyReducer(history, { type: 'undo' })
  expect(undone.present.avoidances).toEqual(before.present.avoidances)
  expect(undone.present.avoidances[0]).toMatchObject({ alignment: { angle: 270 } })
  expect(historyReducer(undone, { type: 'redo' }).present.avoidances).toEqual(
    history.present.avoidances,
  )
  expect(parseProject(serializeProject(history.present)).avoidances).toEqual(
    history.present.avoidances,
  )
  const value = history.present.avoidances[0]
  if (value.kind !== 'corridor') throw new Error('Expected corridor')
  const normal = avoidanceNormalPatch(history.present, value)
  if (!normal.ok) throw new Error(normal.error)
  const restored = contourReducer(history.present, {
    type: 'updateAvoidance',
    id: 'parent',
    patch: normal.value,
  })
  expect(restored.error).toBe('')
  expect(restored.avoidances[0]).toMatchObject({
    alignment: { kind: 'normal' },
    anchor: { t: 0.5 },
  })
})

it('follows the foot on a line rather than keeping the original contact fixed', () => {
  const initial = automatic(createRectangleConnectedFixture())
  const next = move(initial, 0.7, 1)
  expect(next.error).toBe('')
  expect(next.avoidances[0]).toMatchObject({
    radius: 0.4,
    gap: 0.2,
    anchor: { t: expect.closeTo(0.675, 10) },
  })
  const table = constructAvoidances(next)
  if (!table.ok) throw new Error(table.error)
  expect(table.value.parents.get('parent')!.bankPair!.direction).toMatchObject({
    re: expect.closeTo(0, 10),
    im: -1,
  })
})

it('leaves an old file unchanged on load but adopts normal following when its singularity is actually moved', () => {
  const initial = createRectangleConnectedFixture()
  const loaded = parseProject(serializeProject(initial))
  expect(loaded.avoidances).toEqual(initial.avoidances)
  expect(move(loaded, 0.7, 1).avoidances[0]).toMatchObject({
    alignment: { kind: 'normal' },
    anchor: { t: expect.closeTo(0.675, 9) },
  })
})

it('follows a circle radius and keeps the selected direction at its center', () => {
  const initial = automatic(createConnectedFixture())
  const next = move(initial, 0.3, 0.4)
  expect(next.error).toBe('')
  const table = constructAvoidances(next)
  if (!table.ok) throw new Error(table.error)
  expect(table.value.parents.get('parent')!.bankPair!.direction).toMatchObject({
    re: expect.closeTo(0.6, 9),
    im: expect.closeTo(0.8, 9),
  })
  const back = move(next, 0, 0)
  expect(back.error).toBe('')
  expect(back.avoidances[0]).toEqual(next.avoidances[0])
})

it('manual direction follows a moving singularity without rotating or retaining its old anchor', () => {
  const initial = automatic(createRectangleConnectedFixture())
  const patch = avoidanceDirectionPatch(initial, initial.avoidances[0], -75)
  if (!patch.ok) throw new Error(patch.error)
  const manual = contourReducer(initial, {
    type: 'updateAvoidance',
    id: 'parent',
    patch: patch.value,
  })
  const next = move(manual, 0.5, 1.2)
  expect(next.error).toBe('')
  if (next.avoidances[0].kind !== 'corridor') throw new Error('Expected corridor')
  expect(avoidanceAngle(next, next.avoidances[0])).toBeCloseTo(285, 8)
  expect(next.avoidances[0].anchor).not.toEqual(
    manual.avoidances[0].kind === 'corridor' && manual.avoidances[0].anchor,
  )
})

it('writes following rules as version 6 and reads them without losing behavior', () => {
  const initial = automatic(createRectangleConnectedFixture())
  const text = serializeProject(initial)
  expect(JSON.parse(text).version).toBe(6)
  const loaded = parseProject(text)
  expect(loaded.avoidances).toEqual(initial.avoidances)
  expect(move(loaded, 0.7, 1).avoidances[0]).toMatchObject({
    anchor: { t: expect.closeTo(0.675, 10) },
  })
})

it.each([
  { kind: 'direction', angle: null },
  { kind: 'unexpected' },
  { kind: 'direction', angle: '45' },
])('rejects malformed following rules: %j', (alignment) => {
  const file = JSON.parse(serializeProject(createRectangleConnectedFixture()))
  file.version = 6
  file.document.avoidances[0].alignment = alignment
  expect(() => parseProject(JSON.stringify(file))).toThrow(/跟随|朝向|角度/)
})

it.each([0.5, 0.39, 0.2, 0.01, 0])(
  'approaches a straight boundary at distance %s without changing radius or preferred gap',
  (distance) => {
    const initial = automatic(createRectangleConnectedFixture())
    initial.avoidances[0].partStyles = {
      entry: { color: '#cc2233' },
      arc: { width: 5 },
      exit: { arrows: false },
    }
    const next = move(initial, 0, distance)
    expect(next.error).toBe('')
    expect(next.markers[0].im).toBe(distance)
    expect(next.avoidances[0]).toMatchObject({
      radius: 0.4,
      gap: 0.2,
      partStyles: initial.avoidances[0].partStyles,
    })
    const table = constructAvoidances(next)
    if (!table.ok) throw new Error(table.error)
    const g = table.value.parents.get('parent')!.geometry
    expect(g.arc.radius).toBe(0.4)
    expect(g.arc.center).toEqual({ re: 0, im: distance })
    if (distance === 0) {
      expect(g.entry).toEqual(g.entryBase)
      expect(g.exit).toEqual(g.exitBase)
      expect(Math.abs(g.arc.sweep)).toBeCloseTo(Math.PI, 9)
    }
    const back = move(next, 0.6, 1)
    expect(back.error).toBe('')
    expect(back.avoidances[0]).toMatchObject({ radius: 0.4, gap: 0.2 })
  },
)

it.each([0, 0.01, 0.06, 0.1])(
  'reaches the circle seam at distance %s with true circle intersections',
  (distance) => {
    const initial = automatic(createConnectedFixture())
    const next = move(initial, 1 - distance, 0)
    expect(next.error).toBe('')
    expect(next.markers[0].re).toBe(1 - distance)
    const table = constructAvoidances(next)
    if (!table.ok) throw new Error(table.error)
    const g = table.value.parents.get('parent')!.geometry
    expect(g.arc.radius).toBe(0.1)
    expect(Math.hypot(g.entryBase.re, g.entryBase.im)).toBeCloseTo(1, 9)
    expect(Math.hypot(g.exitBase.re, g.exitBase.im)).toBeCloseTo(1, 9)
    if (!distance) {
      expect(g.entry).toEqual(g.entryBase)
      expect(g.exit).toEqual(g.exitBase)
      expect(Math.hypot(g.entry.re - 1, g.entry.im)).toBeCloseTo(0.1, 9)
    }
    expect(move(next, 0.3, 0.2).error).toBe('')
  },
)

it('keeps a manual diagonal direction through the mixed one-bank transition and boundary', () => {
  let state = automatic(createRectangleConnectedFixture())
  const patch = avoidanceDirectionPatch(state, state.avoidances[0], -65)
  if (!patch.ok) throw new Error(patch.error)
  state = contourReducer(state, { type: 'updateAvoidance', id: 'parent', patch: patch.value })
  for (const distance of [0.6, 0.4, 0.35, 0.3, 0.1, 0]) {
    state = move(state, 0, distance)
    expect(state.error, `distance ${distance}`).toBe('')
    expect(state.markers[0].im).toBe(distance)
  }
  expect(move(state, 0.5, 1).error).toBe('')
})

it('restoring normal following recomputes the anchor rather than keeping the manual ray', () => {
  const state = automatic(createRectangleConnectedFixture())
  const patch = avoidanceDirectionPatch(state, state.avoidances[0], -65)
  if (!patch.ok) throw new Error(patch.error)
  const manual = contourReducer(state, {
    type: 'updateAvoidance',
    id: 'parent',
    patch: patch.value,
  })
  const value = manual.avoidances[0]
  if (value.kind !== 'corridor') throw new Error('Expected corridor')
  const result = followAvoidance(manual, { ...value, alignment: { kind: 'normal' } })
  expect(result).toMatchObject({ ok: true, value: { anchor: { t: 0.5 } } })
})

it('rejects an automatic normal whose foot falls outside the bound finite straight edge', () => {
  const state = automatic(createRectangleConnectedFixture())
  const next = move(state, 3, 1)
  expect(next.error).not.toBe('')
  expect(next.markers).toBe(state.markers)
})

it('reverses a boundary detour without flipping it to the other side of its straight source', () => {
  const boundary = move(automatic(createRectangleConnectedFixture()), 0, 0)
  const before = constructAvoidances(boundary)
  if (!before.ok) throw new Error(before.error)
  const reversed = contourReducer(boundary, { type: 'reverse' })
  expect(reversed.error).toBe('')
  const after = constructAvoidances(reversed)
  if (!after.ok) throw new Error(after.error)
  const g = before.value.parents.get('parent')!.geometry
  const r = after.value.parents.get('parent')!.geometry
  expect(r.through.re).toBeCloseTo(g.through.re, 8)
  expect(r.through.im).toBeCloseTo(g.through.im, 8)
  expect(r.arc.sweep).toBeCloseTo(-g.arc.sweep, 8)
})

it('cannot move an active normal-following detour onto the hidden closing half of a circle', () => {
  const state = automatic(createConnectedFixture())
  state.closed = false
  if (state.avoidances[0].kind !== 'corridor') throw new Error('Expected corridor')
  state.avoidances[0].anchor = { kind: 'segment', segmentId: 'upper', t: 0.5 }
  const next = move(state, 0, -0.5)
  expect(next.error).toMatch(/暂存|隐藏|可见/)
  expect(next.markers).toBe(state.markers)
})

it('does not migrate or reshape an old oblique attachment when translating its whole dependency group', () => {
  const state = createRectangleConnectedFixture()
  if (state.avoidances[0].kind !== 'corridor') throw new Error('Expected corridor')
  state.avoidances[0].anchor = { kind: 'segment', segmentId: 'edge-a', t: 0.6 }
  state.selection = { kind: 'segment', id: 'avoid:parent:arc' }
  const next = contourReducer(state, {
    type: 'translateSelection',
    from: state,
    delta: { re: 0.4, im: 0.2 },
  })
  expect(next.error).toBe('')
  expect(next.avoidances).toEqual(state.avoidances)
})

it('rejects a disk touching an unrelated edge instead of trimming almost the whole rectangle', () => {
  const state = automatic(createRectangleConnectedFixture())
  if (state.avoidances[0].kind !== 'corridor') throw new Error('Expected corridor')
  state.avoidances[0].anchor = { kind: 'segment', segmentId: 'edge-c', t: 0.5 }
  const next = move(state, 0, 0.3)
  expect(next.error).not.toBe('')
  expect(next.markers).toBe(state.markers)
  expect(next.avoidances).toBe(state.avoidances)
})

it('retains usable parallel banks and a valid child when the disk first touches the source', () => {
  const state = automatic(createRectangleConnectedFixture(0.7))
  state.markers[0].im = 0.41
  state.markers.push({ ...state.markers[0], id: 'child', im: 0.1, mathematicalKind: 'isolated' })
  state.avoidances.push({
    kind: 'bank-clearance',
    id: 'clearance',
    markerId: 'child',
    parentAvoidanceId: 'parent',
    radius: 0.36,
  })
  const next = move(state, 0, 0.4)
  expect(next.error).toBe('')
  expect(next.markers[0].im).toBe(0.4)
  const table = constructAvoidances(next)
  if (!table.ok) throw new Error(table.error)
  const banks = table.value.parents.get('parent')!.bankPair!
  expect(banks).toBeDefined()
  expect(
    Math.hypot(
      banks.entry.end.re - banks.entry.start.re,
      banks.entry.end.im - banks.entry.start.im,
    ),
  ).toBeCloseTo(0.4 - Math.sqrt(0.4 ** 2 - 0.35 ** 2), 10)
  expect(table.value.clearances.has('clearance')).toBe(true)
})

it('rejects a nearby clamped source endpoint instead of calling a diagonal ray normal', () => {
  const state = automatic(createRectangleConnectedFixture())
  const next = move(state, 2.1, 0.1)
  expect(next.error).not.toBe('')
  expect(next.markers).toBe(state.markers)
})

it('rejects a clamped quarter-circle endpoint when the radial projection lies beyond the finite arc', () => {
  const state = automatic(createConnectedFixture({ radius: 0.2, gap: 0.08 }))
  state.vertices = [
    { id: 'a', re: 1, im: 0 },
    { id: 'b', re: 0, im: 1 },
    { id: 'c', re: -1, im: 1 },
    { id: 'd', re: -1, im: -1 },
    { id: 'e', re: 1, im: -1 },
  ]
  state.segments = state.vertices.map((p, i, points) => ({
    id: `edge-${p.id}`,
    kind: 'line',
    startId: p.id,
    endId: points[(i + 1) % points.length].id,
  }))
  state.segments[0] = {
    ...state.segments[0],
    kind: 'arc',
    through: { re: Math.SQRT1_2, im: Math.SQRT1_2 },
  }
  state.markers[0] = { ...state.markers[0], re: 0.3, im: 0.3 }
  if (state.avoidances[0].kind !== 'corridor') throw new Error('Expected corridor')
  state.avoidances[0].anchor = { kind: 'segment', segmentId: 'edge-a', t: 0.5 }
  expect(constructAvoidances(state).ok).toBe(true)
  const next = move(state, -0.1, 0.9)
  expect(next.error).not.toBe('')
  expect(next.markers).toBe(state.markers)
})

it('restores automatic following on a reversed boundary without flipping the semicircle side', () => {
  let state = contourReducer(automatic(createRectangleConnectedFixture()), { type: 'reverse' })
  state = move(state, 0, 0)
  const direction = avoidanceDirectionPatch(state, state.avoidances[0], 270)
  if (!direction.ok) throw new Error(direction.error)
  state = contourReducer(state, { type: 'updateAvoidance', id: 'parent', patch: direction.value })
  const before = constructAvoidances(state)
  if (!before.ok || state.avoidances[0].kind !== 'corridor')
    throw new Error('Expected valid corridor')
  const patch = avoidanceNormalPatch(state, state.avoidances[0])
  if (!patch.ok) throw new Error(patch.error)
  const restored = contourReducer(state, {
    type: 'updateAvoidance',
    id: 'parent',
    patch: patch.value,
  })
  expect(restored.error).toBe('')
  const after = constructAvoidances(restored)
  if (!after.ok) throw new Error(after.error)
  expect(after.value.parents.get('parent')!.geometry.through.im).toBeCloseTo(
    before.value.parents.get('parent')!.geometry.through.im,
    9,
  )
})
