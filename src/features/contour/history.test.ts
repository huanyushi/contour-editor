import { describe, expect, it } from 'vitest'
import { createArcFixture } from '../../test/fixtures'
import { createHistory, historyReducer } from './history'
import { defaultLabel } from './appearance'

describe('document history', () => {
  it('merges arrow movement into one step and cancels without retaining a position', () => {
    let history = createHistory()
    const original = history.present
    history = historyReducer(history, { type: 'beginGesture', owner: 'canvas' })
    for (const position of [0.2, 0.3, 0.8])
      history = historyReducer(history, { type: 'arrowPosition', id: 'edge-a', position })
    expect(history.past).toHaveLength(0)
    expect(history.present.segments[0].arrowPosition).toBe(0.8)
    const cancelled = historyReducer(history, { type: 'cancelGesture', owner: 'canvas' })
    expect(cancelled.present).toEqual(original)
    history = historyReducer(history, { type: 'endGesture', owner: 'canvas' })
    expect(history.past).toHaveLength(1)
    expect(historyReducer(history, { type: 'undo' }).present.segments).toEqual(original.segments)
    const clicked = historyReducer(createHistory(), { type: 'beginGesture', owner: 'canvas' })
    expect(historyReducer(clicked, { type: 'endGesture', owner: 'canvas' }).past).toHaveLength(0)
  })
  it('cancels only the owned gesture and preserves the pre-drag document and redo stack', () => {
    let history = historyReducer(createHistory(), {
      type: 'move',
      id: 'a',
      point: { re: -2, im: 1 },
    })
    history = historyReducer(history, { type: 'undo' })
    const before = history
    history = historyReducer(history, { type: 'beginGesture', owner: 'canvas' })
    history = historyReducer(history, { type: 'move', id: 'b', point: { re: 2, im: -1 } })
    expect(historyReducer(history, { type: 'cancelGesture', owner: 'slider-keyboard' })).toBe(
      history,
    )
    history = historyReducer(history, { type: 'cancelGesture', owner: 'canvas' })
    expect(history.present).toEqual(before.present)
    expect(history.past).toEqual(before.past)
    expect(history.future).toEqual(before.future)
    expect(history.gesture).toBeNull()
    expect(historyReducer(history, { type: 'redo' }).present.vertices[0].re).toBe(-2)
  })
  it('preserves automatic labeling and redo after an appearance slider returns to its starting value', () => {
    let history = historyReducer(createHistory(createArcFixture()), { type: 'reverse' })
    history = historyReducer(history, { type: 'undo' })
    history = historyReducer(history, { type: 'beginGesture', owner: 'slider-pointer' })
    history = historyReducer(history, {
      type: 'label',
      target: { kind: 'vertex', id: 'a' },
      label: { ...defaultLabel('z_{1}'), size: 20 },
    })
    history = historyReducer(history, {
      type: 'label',
      target: { kind: 'vertex', id: 'a' },
      label: defaultLabel('z_{1}'),
    })
    history = historyReducer(history, { type: 'endGesture', owner: 'slider-pointer' })
    expect(history.present.vertices[0].label).toBeUndefined()
    expect(history.past).toHaveLength(0)
    expect(history.future).toHaveLength(1)
  })
  it('only allows the gesture owner to finish an active transaction', () => {
    let history = historyReducer(createHistory(), { type: 'beginGesture', owner: 'canvas' })
    history = historyReducer(history, { type: 'move', id: 'a', point: { re: 1, im: 1 } })
    history = historyReducer(history, { type: 'endGesture', owner: 'slider-keyboard' })
    expect(history.past).toHaveLength(0)
    expect(historyReducer(history, { type: 'undo' })).toBe(history)
    history = historyReducer(history, { type: 'endGesture', owner: 'canvas' })
    expect(history.past).toHaveLength(1)
  })

  it('preserves redo when a point-size gesture returns to its implicit default', () => {
    let history = historyReducer(createHistory(), {
      type: 'move',
      id: 'a',
      point: { re: 2, im: 2 },
    })
    history = historyReducer(history, { type: 'undo' })
    history = historyReducer(history, { type: 'beginGesture' })
    history = historyReducer(history, {
      type: 'pointStyle',
      target: { kind: 'vertex', id: 'a' },
      patch: { radius: 6 },
    })
    history = historyReducer(history, {
      type: 'pointStyle',
      target: { kind: 'vertex', id: 'a' },
      patch: { radius: 4 },
    })
    history = historyReducer(history, { type: 'endGesture' })
    expect(history.past).toHaveLength(0)
    expect(history.future).toHaveLength(1)
    expect(historyReducer(history, { type: 'redo' }).present.vertices[0].re).toBe(2)
  })
  it('undoes and redoes an edit without mutating earlier snapshots', () => {
    const initial = createHistory()
    const edited = historyReducer(initial, { type: 'move', id: 'a', point: { re: 1, im: 2 } })
    expect(initial.present.vertices[0].re).toBe(-4)
    expect(edited.past).toHaveLength(1)
    const undone = historyReducer(edited, { type: 'undo' })
    expect(undone.present).toEqual(initial.present)
    expect(historyReducer(undone, { type: 'redo' }).present).toEqual(edited.present)
    expect(historyReducer(initial, { type: 'undo' })).toBe(initial)
    expect(historyReducer(initial, { type: 'redo' })).toBe(initial)
  })

  it('treats all valid movements in one pointer gesture as a single step', () => {
    const original = createHistory(createArcFixture())
    let history = historyReducer(original, { type: 'beginGesture' })
    for (const im of [2.1, 2.4, 2.8, 3])
      history = historyReducer(history, { type: 'moveThrough', id: 'edge-b', point: { re: 0, im } })
    expect(history.past).toHaveLength(0)
    expect(historyReducer(history, { type: 'undo' })).toBe(history)
    history = historyReducer(history, { type: 'endGesture' })
    expect(history.past).toHaveLength(1)
    expect(historyReducer(history, { type: 'undo' }).present.segments).toEqual(
      original.present.segments,
    )
    const redone = historyReducer(historyReducer(history, { type: 'undo' }), { type: 'redo' })
    expect(redone.present.segments[1]).toMatchObject({ through: { re: 0, im: 3 } })
  })

  it('ignores rejected geometry but retains the last valid part of a drag', () => {
    let history = createHistory(createArcFixture())
    history = historyReducer(history, { type: 'beginGesture' })
    history = historyReducer(history, {
      type: 'moveThrough',
      id: 'edge-b',
      point: { re: 0, im: 0 },
    })
    history = historyReducer(history, { type: 'endGesture' })
    expect(history.past).toHaveLength(0)
    expect(history.present.error).toMatch(/共线/)
    history = historyReducer(history, { type: 'beginGesture' })
    history = historyReducer(history, {
      type: 'moveThrough',
      id: 'edge-b',
      point: { re: 0, im: 3 },
    })
    history = historyReducer(history, {
      type: 'moveThrough',
      id: 'edge-b',
      point: { re: 0, im: 0 },
    })
    history = historyReducer(history, { type: 'endGesture' })
    expect(history.past).toHaveLength(1)
    const undone = historyReducer(history, { type: 'undo' })
    expect(undone.present.segments[1]).toMatchObject({ through: { re: 0, im: 2 } })
    expect(undone.present.error).toBe('')
    expect(historyReducer(undone, { type: 'redo' }).present.segments[1]).toMatchObject({
      through: { re: 0, im: 3 },
    })
  })

  it('preserves redo after selections, rejected edits and return-to-origin gestures', () => {
    let history = historyReducer(createHistory(), {
      type: 'move',
      id: 'a',
      point: { re: 2, im: 2 },
    })
    history = historyReducer(history, { type: 'undo' })
    history = historyReducer(history, { type: 'select', id: 'b' })
    history = historyReducer(history, { type: 'stroke', patch: { width: NaN } })
    history = historyReducer(history, { type: 'move', id: 'a', point: { re: -4, im: 0 } })
    history = historyReducer(history, { type: 'beginGesture' })
    history = historyReducer(history, { type: 'move', id: 'a', point: { re: 0, im: 0 } })
    history = historyReducer(history, { type: 'move', id: 'a', point: { re: -4, im: 0 } })
    history = historyReducer(history, { type: 'endGesture' })
    expect(history.past).toHaveLength(0)
    expect(history.future).toHaveLength(1)
    expect(historyReducer(history, { type: 'redo' }).present.vertices[0].re).toBe(2)
  })

  it('clears redo only when a new actual edit is committed', () => {
    let history = historyReducer(createHistory(), { type: 'reverse' })
    history = historyReducer(history, { type: 'undo' })
    history = historyReducer(history, { type: 'fill', patch: { mode: 'hatch' } })
    expect(history.future).toHaveLength(0)
    expect(historyReducer(history, { type: 'redo' })).toBe(history)
  })

  it('preserves view preferences across undo and redo without recording them', () => {
    let history = createHistory()
    history = historyReducer(history, { type: 'toggleGrid' })
    history = historyReducer(history, { type: 'toggleSnap' })
    history = historyReducer(history, { type: 'toggleHandles' })
    expect(history.past).toHaveLength(0)
    history = historyReducer(history, { type: 'move', id: 'a', point: { re: 1, im: 1 } })
    history = historyReducer(history, { type: 'undo' })
    expect(history.present).toMatchObject({ snap: false, grid: false, handles: false })
    expect(historyReducer(history, { type: 'redo' }).present).toMatchObject({
      snap: false,
      grid: false,
      handles: false,
    })
  })

  it('restores removed objects, labels, styles and selection', () => {
    let history = historyReducer(createHistory(), {
      type: 'addFormula',
      id: 'f',
      point: { re: 1, im: 2 },
    })
    history = historyReducer(history, {
      type: 'stroke',
      id: 'edge-a',
      patch: { color: '#cc2233', width: 4 },
    })
    const before = history.present
    history = historyReducer(history, { type: 'removeObject', kind: 'formula', id: 'f' })
    history = historyReducer(history, { type: 'undo' })
    expect(history.present).toEqual(before)
    expect(history.present.selection).toEqual({ kind: 'formula', id: 'f' })
  })

  it('groups a style slider gesture and bounds history to the most recent 100 edits', () => {
    let history = historyReducer(createHistory(), { type: 'beginGesture' })
    for (const width of [2.5, 3, 3.5, 4])
      history = historyReducer(history, { type: 'stroke', patch: { width } })
    history = historyReducer(history, { type: 'endGesture' })
    expect(history.past).toHaveLength(1)
    expect(historyReducer(history, { type: 'undo' }).present.appearance.stroke.width).toBe(2)
    history = createHistory()
    for (let re = 1; re <= 105; re++)
      history = historyReducer(history, { type: 'move', id: 'a', point: { re, im: 0 } })
    expect(history.past).toHaveLength(100)
    for (let i = 0; i < 100; i++) history = historyReducer(history, { type: 'undo' })
    expect(history.present.vertices[0].re).toBe(5)
    expect(history.past).toHaveLength(0)
  })
})
