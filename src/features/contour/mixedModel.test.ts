import { describe, expect, it } from 'vitest'
import { contourReducer, createInitialState } from './model'
import { createArcFixture } from '../../test/fixtures'

describe('shared-endpoint mixed contours', () => {
  it('closes two endpoints with a line and an upper semicircle', () => {
    const state = createArcFixture()
    expect(state.vertices).toEqual([
      { id: 'a', re: -2, im: 0 },
      { id: 'b', re: 2, im: 0 },
    ])
    expect(state.segments).toEqual([
      { id: 'edge-a', kind: 'line', startId: 'a', endId: 'b' },
      { id: 'edge-b', kind: 'arc', startId: 'b', endId: 'a', through: { re: 0, im: 2 } },
    ])
    expect(state.closed).toBe(true)
    const opened = contourReducer(state, { type: 'toggleClosed' })
    expect(opened.closed).toBe(false)
    expect(contourReducer(opened, { type: 'toggleClosed' })).toEqual(state)
  })

  it('updates a shared endpoint once and keeps both adjacent references', () => {
    const original = createArcFixture()
    const state = contourReducer(original, { type: 'move', id: 'a', point: { re: -3, im: -1 } })
    expect(state.vertices[0]).toEqual({ id: 'a', re: -3, im: -1 })
    expect(state.segments[0].startId).toBe('a')
    expect(state.segments[1].endId).toBe('a')
    expect(original.vertices[0].re).toBe(-2)
  })

  it('rejects a degenerate through-point move while preserving geometry', () => {
    const state = createArcFixture()
    const rejected = contourReducer(state, {
      type: 'moveThrough',
      id: 'edge-b',
      point: { re: 0, im: 0 },
    })
    expect(rejected.error).toMatch(/共线/)
    expect(rejected.vertices).toEqual(state.vertices)
    expect(rejected.segments).toEqual(state.segments)
    const recovered = contourReducer(rejected, {
      type: 'moveThrough',
      id: 'edge-b',
      point: { re: 0, im: 3 },
    })
    expect(recovered.error).toBe('')
  })

  it('rejects a shared endpoint move that degenerates an incident arc', () => {
    const state = createArcFixture()
    const rejected = contourReducer(state, { type: 'move', id: 'a', point: { re: 0, im: 2 } })
    expect(rejected.error).not.toBe('')
    expect(rejected.vertices).toEqual(state.vertices)
    expect(rejected.segments).toEqual(state.segments)
  })

  it('rejects an endpoint move atomically even when the other incident arc remains valid', () => {
    const state = contourReducer(createArcFixture(), {
      type: 'setArc',
      id: 'edge-a',
      through: { re: 0, im: -2 },
    })
    const rejected = contourReducer(state, { type: 'move', id: 'a', point: { re: 0, im: 2 } })
    expect(rejected.error).not.toBe('')
    expect(rejected.vertices).toBe(state.vertices)
    expect(rejected.segments).toBe(state.segments)
    expect(state.segments.every((segment) => segment.kind === 'arc')).toBe(true)
  })

  it('reverses segment direction but preserves through points and selection; twice is identity', () => {
    const state = createArcFixture()
    const reversed = contourReducer(state, { type: 'reverse' })
    expect(reversed.segments[0]).toEqual({ id: 'edge-a', kind: 'line', startId: 'b', endId: 'a' })
    expect(reversed.segments[1]).toEqual({
      id: 'edge-b',
      kind: 'arc',
      startId: 'a',
      endId: 'b',
      through: { re: 0, im: 2 },
    })
    expect(reversed.selectedId).toBe(state.selectedId)
    expect(reversed.selectedSegmentId).toBe(state.selectedSegmentId)
    expect(contourReducer(reversed, { type: 'reverse' })).toEqual(state)
  })

  it('converts a closing line to an arc and opens a two-line degenerate closure', () => {
    let state = createArcFixture()
    state = contourReducer(state, { type: 'setLine', id: 'edge-b' })
    expect(state.closed).toBe(false)
    state = contourReducer(state, { type: 'setArc', id: 'edge-b', through: { re: 0, im: 2 } })
    state = contourReducer(state, { type: 'toggleClosed' })
    expect(state.closed).toBe(true)
  })

  it('maintains topology on addition and deletion without orphan segment references', () => {
    let state = createInitialState()
    state = contourReducer(state, { type: 'setArc', id: 'edge-a', through: { re: 0, im: -3 } })
    state = contourReducer(state, { type: 'add', vertex: { id: 'new', re: -4.5, im: -1 } })
    expect(state.segments[0].kind).toBe('arc')
    state = contourReducer(state, { type: 'delete' })
    expect(state.segments).toHaveLength(3)
    const ids = new Set(state.vertices.map((v) => v.id))
    state.segments.forEach((segment) => {
      expect(ids.has(segment.startId)).toBe(true)
      expect(ids.has(segment.endId)).toBe(true)
    })
    expect(state.closed).toBe(false)
    expect(state.segments[0].kind).toBe('arc')
  })
})
