import { describe, expect, it } from 'vitest'
import { createInitialState, contourReducer } from './model'
import { createArcFixture } from '../../test/fixtures'
import { buildContourGeometry } from './pathGeometry'

describe('mixed SVG geometry', () => {
  it('keeps arrows finite between opposite large endpoints', () => {
    const state = createInitialState()
    state.vertices[0].re = -3e306
    state.vertices[1].re = 3e306
    const geometry = buildContourGeometry(state)
    expect(geometry.segments[0].arrow?.tangent.x).toBe(1)
    for (const { arrow } of geometry.segments) {
      expect(arrow).toBeDefined()
      expect(
        [arrow!.point.x, arrow!.point.y, arrow!.tangent.x, arrow!.tangent.y].every(Number.isFinite),
      ).toBe(true)
    }
  })
  it('renders a continuous semicircle path with correct SVG sweep and tangent arrows', () => {
    const geometry = buildContourGeometry(createArcFixture())
    expect(geometry.path).toBe('M 320 300 L 480 300 A 80 80 0 0 0 320 300 Z')
    expect(geometry.segments[0].arrow?.tangent).toEqual({ x: 1, y: 0 })
    expect(geometry.segments[1].arrow?.point.x).toBeCloseTo(400)
    expect(geometry.segments[1].arrow?.point.y).toBeCloseTo(220)
    expect(geometry.segments[1].arrow?.tangent.x).toBeCloseTo(-1)
    expect(geometry.segments[1].arrow?.tangent.y).toBeCloseTo(0)
  })
  it('reverses sweep and arrows while preserving the filled boundary', () => {
    const reversed = buildContourGeometry(contourReducer(createArcFixture(), { type: 'reverse' }))
    expect(reversed.path).toBe('M 480 300 L 320 300 A 80 80 0 0 1 480 300 Z')
    expect(reversed.segments[0].arrow?.tangent.x).toBe(-1)
    expect(reversed.segments[1].arrow?.tangent.x).toBeCloseTo(1)
    expect(reversed.segments[1].arrow?.point.y).toBeCloseTo(220)
  })
  it('hides the closing arc when open and restores it when closed again', () => {
    const state = contourReducer(createArcFixture(), { type: 'toggleClosed' })
    expect(buildContourGeometry(state).path).toBe('M 320 300 L 480 300')
    expect(
      buildContourGeometry(contourReducer(state, { type: 'toggleClosed' })).segments,
    ).toHaveLength(2)
  })
})
