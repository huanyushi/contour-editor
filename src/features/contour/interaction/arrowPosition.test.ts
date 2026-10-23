import { describe, expect, it } from 'vitest'
import { contourReducer, createInitialState } from '../model'
import { resolvedScene } from '../scene/sceneObjects'
import { sourcePieceId } from '../sourcePieces'
import { createPathArrowFixture } from '../../../test/pathArrowFixtures'

describe('per-object arrow positions', () => {
  it('updates ordinary paths and independent connections without changing other objects', () => {
    const initial = createInitialState()
    initial.connections = [{ id: 'diagonal', kind: 'line', startId: 'a', endId: 'c' }]
    let next = contourReducer(initial, { type: 'arrowPosition', id: 'edge-a', position: 0.25 })
    next = contourReducer(next, { type: 'arrowPosition', id: 'diagonal', position: 0.8 })
    expect(next.segments[0].arrowPosition).toBe(0.25)
    expect(next.connections[0].arrowPosition).toBe(0.8)
    expect(next.segments[1]).toBe(initial.segments[1])
    expect(contourReducer(next, { type: 'arrowPosition', id: 'diagonal', position: 0.8 })).toBe(
      next,
    )
  })

  it.each([NaN, Infinity, -0.01, 1.01])('rejects invalid positions %s atomically', (position) => {
    const state = createInitialState()
    const next = contourReducer(state, { type: 'arrowPosition', id: 'edge-a', position })
    expect(next.error).not.toBe('')
    expect(next.segments).toBe(state.segments)
  })

  it('routes retained pieces and parent/child parts to their stable source owners', () => {
    const state = createPathArrowFixture()
    const boundary = { startAvoidanceId: null, endAvoidanceId: 'parent' }
    let next = contourReducer(state, {
      type: 'arrowPosition',
      id: sourcePieceId('edge-a', boundary),
      position: 0.25,
    })
    for (const id of ['avoid:parent:entry', 'avoid:parent:arc', 'avoid:clearance:bank-entry'])
      next = contourReducer(next, { type: 'arrowPosition', id, position: 0.25 })
    expect(next.error).toBe('')
    expect(next.segments[0].pieces?.[0]).toMatchObject({ ...boundary, arrowPosition: 0.25 })
    expect(next.avoidances[0].partArrowPositions).toEqual({ entry: 0.25, arc: 0.25 })
    expect(next.avoidances[1].partArrowPositions).toEqual({ 'bank-entry': 0.25 })
    expect(next.segments[0].arrowPosition).toBeUndefined()
    const scene = resolvedScene(next)
    expect(scene.contourSegments.find((s) => s.id === 'avoid:parent:arc')?.arrowPosition).toBe(0.25)
    expect(
      scene.contourSegments.find((s) => s.id === 'avoid:parent:exit')?.arrowPosition,
    ).toBeUndefined()
  })

  it('does not inherit a source arrow position into new detour objects', () => {
    const state = createPathArrowFixture()
    state.segments[0].arrowPosition = 0.15
    const scene = resolvedScene(state)
    for (const part of scene.chains.get('edge-a')!) expect(part.arrowPosition).toBeUndefined()
  })

  it('reverses each position and swaps detour end/bank owners, with a lossless double reversal', () => {
    let state = createPathArrowFixture()
    for (const id of [
      'edge-b',
      'gap:edge-a:before:parent',
      'avoid:parent:entry',
      'avoid:parent:arc',
      'avoid:clearance:bank-entry',
    ])
      state = contourReducer(state, { type: 'arrowPosition', id, position: 0.25 })
    const reversed = contourReducer(state, { type: 'reverse' })
    expect(reversed.error).toBe('')
    expect(reversed.segments.find((s) => s.id === 'edge-b')?.arrowPosition).toBe(0.75)
    expect(reversed.segments.find((s) => s.id === 'edge-a')?.pieces?.[0]).toMatchObject({
      startAvoidanceId: 'parent',
      endAvoidanceId: null,
      arrowPosition: 0.75,
    })
    expect(reversed.avoidances[0].partArrowPositions).toEqual({ exit: 0.75, arc: 0.75 })
    expect(reversed.avoidances[1].partArrowPositions).toEqual({ 'bank-exit': 0.75 })
    const restored = contourReducer(reversed, { type: 'reverse' })
    expect(restored.segments).toEqual(state.segments)
    expect(restored.avoidances).toEqual(state.avoidances)
  })
})
