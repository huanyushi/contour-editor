import { describe, expect, it } from 'vitest'
import { contourReducer, createInitialState } from '../model'
import { createArcFixture } from '../../../test/fixtures'
import { createHistory, historyReducer } from '../history'

describe('rigid selection translation', () => {
  it('distinguishes box selections from Ctrl-click selections without document history', () => {
    let history = historyReducer(createHistory(), {
      type: 'selectMany',
      source: 'marquee',
      items: [
        { kind: 'vertex', id: 'a' },
        { kind: 'vertex', id: 'b' },
      ],
    })
    expect(history.present.selectionSource).toBe('marquee')
    history = historyReducer(history, {
      type: 'toggleSelection',
      item: { kind: 'vertex', id: 'c' },
    })
    expect(history.present.selectionSource).toBe('click')
    expect(history.past).toHaveLength(0)
  })

  it('translates shared endpoints once and moves selected circular geometry rigidly', () => {
    let from = contourReducer(createArcFixture(), {
      type: 'addMarker',
      id: 'm',
      point: { re: 4, im: 1 },
    })
    from = contourReducer(from, { type: 'addFormula', id: 'f', point: { re: 5, im: 2 } })
    from = contourReducer(from, {
      type: 'selectMany',
      source: 'marquee',
      items: [
        { kind: 'contour' },
        { kind: 'vertex', id: 'a' },
        { kind: 'vertex', id: 'a', part: 'label' },
        { kind: 'marker', id: 'm' },
        { kind: 'formula', id: 'f' },
      ],
    })
    const moved = contourReducer(from, {
      type: 'translateSelection',
      from,
      delta: { re: 1.25, im: -0.5 },
    })
    expect(moved.vertices.map(({ re, im }) => ({ re, im }))).toEqual([
      { re: -0.75, im: -0.5 },
      { re: 3.25, im: -0.5 },
    ])
    expect(moved.vertices[0].label).toBeUndefined()
    expect(moved.segments[1]).toMatchObject({ through: { re: 1.25, im: 1.5 } })
    expect(moved.markers[0]).toMatchObject({ re: 5.25, im: 0.5 })
    expect(moved.formulas[0]).toMatchObject({ re: 6.25, im: 1.5 })
    expect(moved.formulas[0].label).toEqual(from.formulas[0].label)
    expect(moved.selection).toEqual(from.selection)
    expect(from.vertices[0].re).toBe(-2)
  })

  it('keeps pixel label offsets correct under unequal axes and does not move an unselected owner', () => {
    const initial = createInitialState()
    let from = {
      ...initial,
      viewport: { ...initial.viewport, scaleX: 80, scaleY: 20, locked: false },
    }
    from = contourReducer(from, {
      type: 'selectMany',
      source: 'marquee',
      items: [{ kind: 'vertex', id: 'a', part: 'label' }],
    })
    const moved = contourReducer(from, {
      type: 'translateSelection',
      from,
      delta: { re: 0.2, im: 0.5 },
    })
    expect(moved.vertices[0]).toMatchObject({ re: -4, im: 0, label: { dx: -12, dy: 0 } })
    expect(moved.vertices[1]).toBe(from.vertices[1])
  })

  it('rejects degenerate translations atomically and records a drag as one undo step', () => {
    let from = contourReducer(createArcFixture(), {
      type: 'addMarker',
      id: 'm',
      point: { re: 4, im: 1 },
    })
    from = contourReducer(from, {
      type: 'selectMany',
      source: 'marquee',
      items: [
        { kind: 'vertex', id: 'a' },
        { kind: 'marker', id: 'm' },
      ],
    })
    const rejected = contourReducer(from, {
      type: 'translateSelection',
      from,
      delta: { re: 2, im: 2 },
    })
    expect(rejected.vertices).toBe(from.vertices)
    expect(rejected.markers).toBe(from.markers)
    expect(rejected.error).not.toBe('')
    let history = historyReducer(createHistory(from), { type: 'beginGesture', owner: 'canvas' })
    history = historyReducer(history, { type: 'translateSelection', from, delta: { re: 1, im: 1 } })
    history = historyReducer(history, { type: 'translateSelection', from, delta: { re: 2, im: 0 } })
    history = historyReducer(history, { type: 'endGesture', owner: 'canvas' })
    expect(history.present.vertices[0].re).toBe(0)
    expect(history.present.markers[0].re).toBe(6)
    expect(history.past).toHaveLength(1)
    expect(historyReducer(history, { type: 'undo' }).present).toEqual(from)
  })
})
