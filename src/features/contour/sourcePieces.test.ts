import { expect, it } from 'vitest'
import { createRectangleConnectedFixture } from '../../test/connectedAvoidanceFixtures'
import { createAvoidanceFixture } from '../../test/avoidanceFixtures'
import { defaultLabel } from './appearance'
import { contourReducer, type ContourState } from './model'
import { createHistory, historyReducer } from './history'
import { resolvedScene } from './scene/sceneObjects'
import { sourcePieceId } from './sourcePieces'
import { selectionBounds } from './selection/selectionGeometry'
import { selectedSegmentLabel, selectedSegmentStyle } from './avoidance/avoidanceSelection'

const before = { startAvoidanceId: null, endAvoidanceId: 'parent' }
const after = { startAvoidanceId: 'parent', endAvoidanceId: null }
const id = (boundary: typeof before | typeof after) => sourcePieceId('edge-a', boundary)

it('gives the retained pieces stable boundary identities across geometry edits', () => {
  const state = createRectangleConnectedFixture()
  const first = resolvedScene(state)
  expect(first.origins.get(id(before))).toMatchObject({ kind: 'gap', piece: before })
  expect(first.origins.get(id(after))).toMatchObject({ kind: 'gap', piece: after })
  const next = contourReducer(state, {
    type: 'updateAvoidance',
    id: 'parent',
    patch: { radius: 0.5 },
  })
  expect(next.error).toBe('')
  expect(resolvedScene(next).origins.get(id(before))).toEqual(first.origins.get(id(before)))
})

it('edits retained pieces independently from each other and the three detour parts', () => {
  let state = createRectangleConnectedFixture()
  const original = state.segments[0]
  state = contourReducer(state, {
    type: 'stroke',
    id: id(before),
    patch: { color: '#cc2233', arrows: false },
  })
  state = contourReducer(state, {
    type: 'label',
    target: { kind: 'segment', id: id(after) },
    label: defaultLabel('C_2'),
  })
  state = contourReducer(state, { type: 'stroke', id: 'avoid:parent:entry', patch: { width: 5 } })
  expect(state.error).toBe('')
  const scene = resolvedScene(state)
  expect(
    scene.contourSegments.find((s) => s.id === 'gap:edge-a:before:parent')?.style,
  ).toMatchObject({ color: '#cc2233', arrows: false })
  expect(
    scene.contourSegments.find((s) => s.id === 'gap:edge-a:after:parent')?.style?.color,
  ).not.toBe('#cc2233')
  expect(scene.contourSegments.find((s) => s.id === 'avoid:parent:entry')?.style?.width).toBe(5)
  expect(scene.contourSegments.find((s) => s.id === 'avoid:parent:exit')?.style?.width).not.toBe(5)
  expect(scene.labels.find((l) => l.target.id === id(after))?.value.tex).toBe('C_2')
  expect(state.segments[0].style).toEqual(original.style)
  expect(state.segments[0].label).toEqual(original.label)
})

it('batch-edits only selected pieces with a single history step', () => {
  let history = createHistory(createRectangleConnectedFixture())
  history = historyReducer(history, {
    type: 'selectMany',
    items: [before, after].map((b) => ({ kind: 'segment', id: id(b) })),
  })
  history = historyReducer(history, { type: 'selectionStyle', patch: { width: 6 } })
  expect(history.present.error).toBe('')
  expect(history.past).toHaveLength(1)
  for (const s of resolvedScene(history.present).contourSegments) {
    if (s.origin.kind === 'gap') expect(s.style?.width).toBe(6)
    else expect(s.style?.width).not.toBe(6)
  }
})

it('keeps the middle piece of two detours independent and reverses its boundary identity', () => {
  const state: ContourState = createAvoidanceFixture()
  state.markers[0].re = -1
  state.markers.push({ ...state.markers[0], id: 'other', re: 1 })
  state.avoidances.push({ ...state.avoidances[0], id: 'second', markerId: 'other' })
  const boundary = { startAvoidanceId: 'avoid-1', endAvoidanceId: 'second' }
  const middleId = sourcePieceId('edge-a', boundary)
  const styled = contourReducer(state, {
    type: 'stroke',
    id: middleId,
    patch: { color: '#cc2233' },
  })
  expect(styled.error).toBe('')
  expect(styled.segments[0].pieces).toEqual([{ ...boundary, style: { color: '#cc2233' } }])
  const reversed = contourReducer(styled, { type: 'reverse' })
  expect(reversed.error).toBe('')
  expect(reversed.segments.find((s) => s.id === 'edge-a')?.pieces).toEqual([
    { startAvoidanceId: 'second', endAvoidanceId: 'avoid-1', style: { color: '#cc2233' } },
  ])
})

it('keeps temporarily hidden settings and restores removed piece records with undo', () => {
  let state = createRectangleConnectedFixture()
  state = contourReducer(state, { type: 'stroke', id: id(before), patch: { color: '#cc2233' } })
  state = contourReducer(state, { type: 'reverse' })
  const pieces = state.segments.find((s) => s.id === 'edge-a')!.pieces
  const hidden = contourReducer(state, { type: 'toggleClosed' })
  expect(hidden.error).toBe('')
  expect(hidden.segments.find((s) => s.id === 'edge-a')!.pieces).toEqual(pieces)
  let history = createHistory(state)
  history = historyReducer(history, { type: 'removeAvoidance', id: 'parent' })
  expect(history.present.segments.find((s) => s.id === 'edge-a')!.pieces).toBeUndefined()
  history = historyReducer(history, { type: 'undo' })
  expect(history.present.segments.find((s) => s.id === 'edge-a')!.pieces).toEqual(pieces)
})

it('clears selection of a removed retained object and restores it with undo', () => {
  let history = createHistory(createRectangleConnectedFixture())
  history = historyReducer(history, { type: 'selectSegment', id: id(before) })
  history = historyReducer(history, { type: 'removeAvoidance', id: 'parent' })
  expect(history.present.selection).toEqual({ kind: 'none' })
  expect(historyReducer(history, { type: 'undo' }).present.selection).toEqual({
    kind: 'segment',
    id: id(before),
  })
})

it('includes the independent retained label when bounding the full source or contour', () => {
  const state = contourReducer(createRectangleConnectedFixture(), {
    type: 'label',
    target: { kind: 'segment', id: id(before) },
    label: { ...defaultLabel('C'), dx: 700 },
  })
  expect(selectionBounds(state, [{ kind: 'segment', id: 'edge-a' }])!.right).toBeGreaterThan(1016)
  expect(selectionBounds(state, [{ kind: 'contour' }])!.right).toBeGreaterThan(1016)
})

it('keeps selection on the same styled physical piece when the contour reverses', () => {
  let state = contourReducer(createRectangleConnectedFixture(), {
    type: 'stroke',
    id: id(before),
    patch: { color: '#cc2233' },
  })
  state = contourReducer(state, {
    type: 'label',
    target: { kind: 'segment', id: id(before) },
    label: defaultLabel('C_left'),
  })
  state = contourReducer(state, { type: 'selectSegment', id: id(before) })
  const bounds = selectionBounds(state, [{ kind: 'segment', id: id(before) }])
  const reversed = contourReducer(state, { type: 'reverse' })
  expect(reversed.error).toBe('')
  expect(reversed.selection).toEqual({ kind: 'segment', id: id(after) })
  expect(reversed.selectedSegmentId).toBe(id(after))
  expect(selectedSegmentStyle(reversed, id(after))?.color).toBe('#cc2233')
  expect(selectedSegmentLabel(reversed, id(after))?.tex).toBe('C_left')
  expect(selectionBounds(reversed, [{ kind: 'segment', id: id(after) }])).toEqual(bounds)
})
