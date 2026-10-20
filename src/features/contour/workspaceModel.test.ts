import { describe, expect, it } from 'vitest'
import { contourReducer, createInitialState } from './model'
import { defaultLabel } from './appearance'

describe('workspace objects and appearance', () => {
  it('keeps independent points and formulas out of contour topology', () => {
    const initial = createInitialState()
    let state = contourReducer(initial, { type: 'addMarker', id: 'pole', point: { re: 0, im: 1 } })
    state = contourReducer(state, { type: 'addFormula', id: 'formula', point: { re: 2, im: 3 } })
    expect(state.vertices).toBe(initial.vertices)
    expect(state.segments).toBe(initial.segments)
    expect(state.markers[0]).toMatchObject({ id: 'pole', re: 0, im: 1 })
    expect(state.formulas).toHaveLength(1)
    state = contourReducer(state, {
      type: 'moveObject',
      kind: 'marker',
      id: 'pole',
      point: { re: -1.2, im: 3 },
    })
    expect(state.markers[0].re).toBe(-1.2)
    expect(initial.markers).toHaveLength(0)
  })
  it('keeps styles and labels when changing a segment type or reversing', () => {
    let state = createInitialState()
    state = contourReducer(state, {
      type: 'stroke',
      id: 'edge-a',
      patch: { color: '#ff0000', width: 4, dash: 'dashed' },
    })
    state = contourReducer(state, {
      type: 'label',
      target: { kind: 'segment', id: 'edge-a' },
      label: { ...defaultLabel(), tex: 'C_R' },
    })
    state = contourReducer(state, { type: 'setArc', id: 'edge-a', through: { re: 0, im: -3 } })
    state = contourReducer(state, { type: 'setLine', id: 'edge-a' })
    expect(state.segments[0].style).toMatchObject({ color: '#ff0000', width: 4 })
    expect(state.segments[0].label?.tex).toBe('C_R')
    const reversed = contourReducer(state, { type: 'reverse' })
    expect(reversed.segments.find((segment) => segment.id === 'edge-a')?.label?.tex).toBe('C_R')
  })
  it('validates visual properties and permits fill to change independently of closure', () => {
    const state = createInitialState()
    const updated = contourReducer(state, {
      type: 'fill',
      patch: { mode: 'hatch', opacity: 0.4, spacing: 12 },
    })
    expect(updated.appearance.fill.mode).toBe('hatch')
    expect(updated.closed).toBe(true)
    expect(contourReducer(updated, { type: 'stroke', patch: { width: NaN } }).appearance).toEqual(
      updated.appearance,
    )
    expect(contourReducer(updated, { type: 'fill', patch: { opacity: -1 } }).appearance).toEqual(
      updated.appearance,
    )
    expect(contourReducer(updated, { type: 'fill', patch: { mode: 'none' } }).closed).toBe(true)
  })
})
