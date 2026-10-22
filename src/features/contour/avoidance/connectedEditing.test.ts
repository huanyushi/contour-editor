import { expect, it } from 'vitest'
import { createConnectedFixture } from '../../../test/connectedAvoidanceFixtures'
import { createHistory, historyReducer } from '../history'
import { contourReducer } from '../model'
import { resolveScene } from '../scene/resolvedScene'
import { sourceBindingsIndex } from './avoidanceDependencies'

it('rejects a parent edit atomically when a child becomes invalid', () => {
  const before = createHistory(createConnectedFixture({ clearanceRadius: 0.1 }))
  const result = historyReducer(before, {
    type: 'updateAvoidance',
    id: 'parent',
    patch: { radius: 0.6 },
  })
  expect(result.present.avoidances).toEqual(before.present.avoidances)
  expect(result.past).toEqual(before.past)
  expect(result.present.error).not.toBe('')
})

it('removes children but keeps real markers when removing a parent', () => {
  const before = createConnectedFixture({ clearanceRadius: 0.1 })
  const after = contourReducer(before, { type: 'removeAvoidance', id: 'parent' })
  expect(after.error).toBe('')
  expect(after.avoidances).toEqual([])
  expect(after.markers).toEqual(before.markers)
  expect(after.segments).toEqual(before.segments)
})

it('canceling a child restores banks without removing its parent', () => {
  const before = createConnectedFixture({ clearanceRadius: 0.1 })
  const after = contourReducer(before, { type: 'removeAvoidance', id: 'clearance' })
  expect(after.avoidances.map((a) => a.id)).toEqual(['parent'])
  const scene = resolveScene(after)
  expect(scene.ok).toBe(true)
  if (!scene.ok) throw new Error(scene.error)
  expect(scene.scene.contourSegments.some((s) => s.id === 'avoid:parent:entry')).toBe(true)
})

it('moves selected parent and child dependencies exactly once', () => {
  const before = createConnectedFixture({ clearanceRadius: 0.1 })
  before.selection = {
    kind: 'multiple',
    items: [
      { kind: 'segment', id: 'avoid:parent:arc' },
      { kind: 'segment', id: 'avoid:clearance:bank-entry' },
    ],
  }
  const after = contourReducer(before, {
    type: 'translateSelection',
    from: before,
    delta: { re: 2, im: 3 },
  })
  expect(after.error).toBe('')
  expect(after.vertices[0]).toMatchObject({ re: 3, im: 3 })
  expect(after.markers.find((p) => p.id === 'center')).toMatchObject({ re: 2, im: 3 })
  expect(after.markers.find((p) => p.id === 'pole')).toMatchObject({ re: 2.5, im: 3 })
  expect(after.segments[0]).toMatchObject({ through: { re: 2, im: 4 } })
})

it('reverses parent and child appearance semantics and restores them on a second reversal', () => {
  const before = createConnectedFixture({ clearanceRadius: 0.1 })
  before.avoidances[0].partStyles = { entry: { color: '#112233' }, exit: { width: 3 } }
  before.avoidances[1].partStyles = { 'bank-entry': { color: '#123456' } }
  const once = contourReducer(before, { type: 'reverse' })
  expect(once.error).toBe('')
  expect(once.avoidances[0].partStyles?.exit).toEqual({ color: '#112233' })
  expect(once.avoidances[1].partStyles?.['bank-exit']).toEqual({ color: '#123456' })
  const twice = contourReducer(once, { type: 'reverse' })
  expect(twice.avoidances).toEqual(before.avoidances)
})

it('deleting a dependency removes its whole parent-child group in one undo step', () => {
  const before = createHistory(createConnectedFixture({ clearanceRadius: 0.1 }))
  const after = historyReducer(before, { type: 'deleteSegment', id: 'lower' })
  expect(after.present.error).toBe('')
  expect(after.present.avoidances).toEqual([])
  expect(after.past).toHaveLength(1)
  expect(historyReducer(after, { type: 'undo' }).present.avoidances).toEqual(
    before.present.avoidances,
  )
})

it('changes radius without silently changing the gap', () => {
  const state = createConnectedFixture()
  const after = contourReducer(state, {
    type: 'updateAvoidance',
    id: 'parent',
    patch: { radius: 0.2 },
  })
  expect(after.avoidances[0]).toMatchObject({ radius: 0.2, gap: 0.04 })
})

it('indexes a cross-source parent and its child under every real dependency', () => {
  const state = createConnectedFixture({ clearanceRadius: 0.1 })
  const index = sourceBindingsIndex(state)
  expect(index.get('upper')).toEqual(['parent', 'clearance'])
  expect(index.get('lower')).toEqual(['parent', 'clearance'])
  expect(index.get('missing')).toBeUndefined()
})

it('reuses the same vertex anchor picked through its other adjacent source segment', () => {
  const before = createHistory(createConnectedFixture())
  const parent = before.present.avoidances[0]
  if (parent.kind !== 'corridor' || parent.anchor.kind !== 'vertex') throw new Error('fixture')
  const after = historyReducer(before, {
    type: 'addAvoidance',
    avoidance: { ...parent, id: 'duplicate', anchor: { ...parent.anchor, segmentId: 'lower' } },
  })
  expect(after.present.error).toBe('')
  expect(after.present.avoidances).toBe(before.present.avoidances)
  expect(after.past).toHaveLength(0)
})

it('keeps a selected split bank editable when changing gap removes all child cuts', () => {
  const state = createConnectedFixture({ clearanceRadius: 0.05 })
  const selected = contourReducer(state, {
    type: 'selectSegment',
    id: 'avoid:parent:entry:before:clearance',
  })
  expect(selected.selection).toEqual({ kind: 'segment', id: 'avoid:parent:entry' })
  const changed = contourReducer(selected, {
    type: 'updateAvoidance',
    id: 'parent',
    patch: { gap: 0.12 },
  })
  expect(changed.error).toBe('')
  expect(changed.selection).toEqual(selected.selection)
  expect(changed.selectedSegmentId).toBe('avoid:parent:entry')
  const painted = contourReducer(changed, { type: 'selectionStyle', patch: { width: 5 } })
  expect(painted.avoidances[0].partStyles?.entry).toEqual({ width: 5 })
})

it('deduplicates and toggles different fragments of the same logical bank', () => {
  const state = createConnectedFixture({ clearanceRadius: 0.05 })
  const before = { kind: 'segment' as const, id: 'avoid:parent:entry:before:clearance' }
  const after = { kind: 'segment' as const, id: 'avoid:parent:entry:after:clearance' }
  const multiple = contourReducer(state, {
    type: 'selectMany',
    items: [before, after],
    source: 'marquee',
  })
  expect(multiple.selection).toEqual({ kind: 'segment', id: 'avoid:parent:entry' })
  expect(multiple.selectionSource).toBe('marquee')
  expect(contourReducer(multiple, { type: 'toggleSelection', item: after }).selection).toEqual({
    kind: 'none',
  })
  expect(contourReducer(state, { type: 'selectObject', selection: before }).selection).toEqual({
    kind: 'segment',
    id: 'avoid:parent:entry',
  })
})

it('changes a source anchor without changing radius, gap or real vertices', () => {
  const state = createConnectedFixture()
  const after = contourReducer(state, {
    type: 'updateAvoidance',
    id: 'parent',
    patch: { anchor: { kind: 'segment', segmentId: 'upper', t: 0.5 } },
  })
  expect(after.error).toBe('')
  expect(after.avoidances[0]).toMatchObject({
    radius: 0.1,
    gap: 0.04,
    anchor: { kind: 'segment', segmentId: 'upper', t: 0.5 },
  })
  expect(after.vertices).toBe(state.vertices)
  expect(after.markers).toBe(state.markers)
})

it('rejects an anchor change atomically if a child would leave the channel', () => {
  const before = createHistory(createConnectedFixture({ clearanceRadius: 0.05 }))
  const after = historyReducer(before, {
    type: 'updateAvoidance',
    id: 'parent',
    patch: { anchor: { kind: 'segment', segmentId: 'upper', t: 0.5 } },
  })
  expect(after.present.error).not.toBe('')
  expect(after.present.avoidances).toBe(before.present.avoidances)
  expect(after.past).toHaveLength(0)
})
