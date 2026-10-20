import { describe, expect, it } from 'vitest'
import { contourReducer, createInitialState } from './model'

describe('contour editing rules', () => {
  it('opens a contour at two vertices and prevents further deletion or closing', () => {
    let state = createInitialState()
    state = contourReducer(state, { type: 'delete' })
    state = contourReducer(state, { type: 'delete' })
    expect(state.vertices).toHaveLength(2)
    expect(state.closed).toBe(false)
    expect(contourReducer(state, { type: 'delete' })).toEqual(state)
    expect(contourReducer(state, { type: 'toggleClosed' })).toEqual(state)
  })
  it('reverses traversal without changing selection or the original array', () => {
    const state = createInitialState()
    const reversed = contourReducer(state, { type: 'reverse' })
    expect(reversed.vertices.map((p) => p.id)).toEqual(['d', 'c', 'b', 'a'])
    expect(reversed.selectedId).toBe('a')
    expect(state.vertices.map((p) => p.id)).toEqual(['a', 'b', 'c', 'd'])
  })
  it('updates only the targeted vertex and rejects non-finite coordinates', () => {
    const state = createInitialState()
    const moved = contourReducer(state, { type: 'move', id: 'b', point: { re: 0, im: -1.5 } })
    expect(moved.vertices[1]).toEqual({ id: 'b', re: 0, im: -1.5 })
    expect(moved.vertices[0]).toEqual(state.vertices[0])
    expect(
      contourReducer(state, { type: 'move', id: 'a', point: { re: Infinity, im: 0 } }),
    ).toEqual(state)
  })
  it('appends and selects a new vertex then resets the full editor state', () => {
    const state = contourReducer(createInitialState(), {
      type: 'add',
      vertex: { id: 'new', re: 1, im: 2 },
    })
    expect(state.vertices).toHaveLength(5)
    expect(state.selectedId).toBe('new')
    expect(contourReducer(state, { type: 'reset' })).toEqual(createInitialState())
  })
})
