import { expect, it } from 'vitest'
import { contourReducer, createInitialState } from './model'
import { contourTemplates } from './templates'
import { itemsWithinRect, selectionBounds } from './selectionGeometry'

it('selects only complete segments, including the full extent of major arcs', () => {
  const state = contourTemplates.find((t) => t.id === 'keyhole')!.create()
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
