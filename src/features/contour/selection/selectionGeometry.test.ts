import { expect, it } from 'vitest'
import { contourReducer, createInitialState } from '../model'
import { itemAnchor, itemsWithinRect, selectionBounds } from './selectionGeometry'
import { createLegacyTemplateFixture } from '../../../test/legacyTemplates'
import { createConnectedFixture } from '../../../test/connectedAvoidanceFixtures'
import { logicalSegmentId } from '../scene/sceneObjects'
import { defaultLabel, type SelectionItem } from '../appearance'
import { createArcFixture } from '../../../test/fixtures'

it('requires the complete configured arrow head, not just the line, for marquee selection', () => {
  const state = createArcFixture()
  state.segments = [state.segments[0]]
  state.closed = false
  state.appearance.stroke.arrowSize = 20
  state.appearance.stroke.arrowShape = 'open'
  const owner: SelectionItem = { kind: 'segment', id: 'edge-a' }
  const bounds = selectionBounds(state, [owner])!
  expect(bounds.top).toBeCloseTo(290.8)
  expect(bounds.bottom).toBeCloseTo(309.2)
  expect(
    itemsWithinRect(state, { left: 310, right: 490, top: 294, bottom: 306 }),
  ).not.toContainEqual(owner)
  expect(itemsWithinRect(state, { left: 310, right: 490, top: 290, bottom: 310 })).toContainEqual(
    owner,
  )
  const hidden = {
    ...state,
    appearance: { ...state.appearance, stroke: { ...state.appearance.stroke, arrows: false } },
  }
  expect(selectionBounds(hidden, [owner])).toMatchObject({ top: 299, bottom: 301 })
})

it.each(['isolated', 'branch', 'pole', 'ordinary'] as const)(
  'marquee-selects visible semantic vertices with handles hidden: %s',
  (mathematicalKind) => {
    const state = createInitialState()
    state.handles = false
    state.vertices[0] = {
      ...state.vertices[0],
      mathematicalKind,
      label: { ...defaultLabel('a'), visible: false },
    }
    const rect = { left: 0, top: 0, right: 800, bottom: 600 }
    const owner = { kind: 'vertex', id: 'a' }
    expect(
      itemsWithinRect(state, rect).some((item) => item.kind === 'vertex' && item.id === 'a'),
    ).toBe(mathematicalKind !== 'ordinary')
    state.handles = true
    expect(
      itemsWithinRect(state, rect).filter((item) => item.kind === 'vertex' && item.id === 'a'),
    ).toEqual([owner])
    state.handles = false
    state.vertices[0].label = defaultLabel('a')
    const items = itemsWithinRect(state, rect).filter(
      (item) => item.kind === 'vertex' && item.id === 'a',
    )
    expect(items).toEqual([mathematicalKind === 'ordinary' ? { ...owner, part: 'label' } : owner])
    expect(itemsWithinRect(state, { left: 0, right: 800, top: 260, bottom: 299 })).toContainEqual({
      ...owner,
      part: 'label',
    })
  },
)

it('selects only complete segments, including the full extent of major arcs', () => {
  const state = createLegacyTemplateFixture('keyhole')
  const items = itemsWithinRect(state, { left: 410, right: 550, top: 275, bottom: 325 })
  expect(items).toContainEqual({ kind: 'vertex', id: 'v1' })
  expect(items).toContainEqual({ kind: 'segment', id: 'edge-v2' })
  expect(items).not.toContainEqual({ kind: 'segment', id: 'edge-v1' })
  expect(items).not.toContainEqual({ kind: 'segment', id: 'edge-v3' })
  const bounds = selectionBounds(state, [{ kind: 'segment', id: 'edge-v1' }])!
  expect(bounds.left).toBeLessThan(261)
  expect(bounds.top).toBeLessThan(161)
  expect(bounds.bottom).toBeGreaterThan(439)
})

it('bounds a split logical bank by all its own visible fragments, excluding its child arcs', () => {
  const state = createConnectedFixture({ clearanceRadius: 0.2 })
  const bank: SelectionItem = { kind: 'segment', id: 'avoid:parent:entry' }
  const bounds = selectionBounds(state, [bank])
  expect(bounds).not.toBeNull()
  expect(bounds!.left).toBeLessThan(404)
  expect(bounds!.right).toBeGreaterThan(440)
  expect(bounds!.top).toBeCloseTo(295.8)
  expect(bounds!.bottom).toBeCloseTo(305.8)
  const anchor = itemAnchor(state, bank)
  expect(anchor).not.toBeNull()
  expect(anchor!.y).toBeCloseTo(300.8)
  expect(anchor!.x).toBeGreaterThan(403)
  expect(anchor!.x).toBeLessThan(440)
  const hidden = { ...state, closed: false }
  expect(selectionBounds(hidden, [bank])).toBeNull()
  expect(itemAnchor(hidden, bank)).toBeNull()
})

it('requires every visible fragment before marquee-selecting a logical bank and returns it only once', () => {
  const state = createConnectedFixture({ clearanceRadius: 0.2 })
  const bank: SelectionItem = { kind: 'segment', id: 'avoid:parent:entry' }
  const partial = itemsWithinRect(state, { left: 417, right: 447, top: 294, bottom: 308 })
  expect(
    partial.flatMap((item) => (item.kind === 'segment' ? [logicalSegmentId(state, item.id)] : [])),
  ).not.toContain(bank.id)
  // The child arc extends below this rectangle; the two parent line fragments
  // fit completely, so they select their bank, not the independently editable child.
  const complete = itemsWithinRect(state, { left: 397, right: 447, top: 295, bottom: 306 })
  expect(complete.filter((item) => item.kind === 'segment' && item.id === bank.id)).toEqual([bank])
  expect(complete).not.toContainEqual({ kind: 'segment', id: 'avoid:clearance:bank-entry' })
})

it('uses the visible formula bounds instead of its mathematical anchor when box-selecting', () => {
  let state = contourReducer(createInitialState(), {
    type: 'addFormula',
    id: 'f',
    point: { re: 0, im: 0 },
  })
  state = contourReducer(state, {
    type: 'label',
    target: { kind: 'formula', id: 'f' },
    label: { ...state.formulas[0].label, tex: 'F', dx: 50, dy: -24 },
  })
  expect(itemsWithinRect(state, { left: 449, right: 490, top: 270, bottom: 310 })).toContainEqual({
    kind: 'formula',
    id: 'f',
  })
  expect(
    itemsWithinRect(state, { left: 390, right: 410, top: 290, bottom: 310 }),
  ).not.toContainEqual({ kind: 'formula', id: 'f' })
})

it('includes attached labels in the final selection frame while keeping object IDs unique', () => {
  const state = createInitialState()
  const bounds = selectionBounds(state, [{ kind: 'vertex', id: 'a' }])!
  expect(bounds.left).toBeLessThanOrEqual(212)
  expect(bounds.bottom).toBeGreaterThan(310)
  expect(selectionBounds(state, [])).toBeNull()
})

it('can select a label independently when its owner lies outside the selection rectangle', () => {
  const state = createInitialState()
  const items = itemsWithinRect(state, { left: 200, right: 280, top: 308, bottom: 350 })
  expect(items).toEqual([{ kind: 'vertex', id: 'a', part: 'label' }])
})

it('keeps retained isolated endpoints inside the frame when selecting the whole contour', () => {
  let state = contourReducer(createInitialState(), {
    type: 'selectMany',
    items: [
      { kind: 'segment', id: 'edge-a' },
      { kind: 'segment', id: 'edge-b' },
      { kind: 'segment', id: 'edge-c' },
    ],
  })
  state = contourReducer(state, { type: 'deleteSelection' })
  const bounds = selectionBounds(state, [{ kind: 'contour' }])!
  expect(bounds.right).toBeGreaterThanOrEqual(564)
})
