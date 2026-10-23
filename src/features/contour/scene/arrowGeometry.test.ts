import { describe, expect, it } from 'vitest'
import { createArcFixture } from '../../../test/fixtures'
import { createPathArrowFixture } from '../../../test/pathArrowFixtures'
import { buildContourGeometry } from './pathGeometry'
import { contourReducer } from '../model'
import { parseProject, serializeProject } from '../../project/project'

describe('path-following arrow geometry', () => {
  it('keeps a 12px shaft on a visible huge-radius arc instead of magnifying parameter roundoff', () => {
    const state = createArcFixture()
    state.vertices = [
      { id: 'a', re: -1e12, im: -1e12 },
      { id: 'b', re: 1e12, im: -1e12 },
    ]
    state.segments[1] = { ...state.segments[1], kind: 'arc', through: { re: 0, im: 0 } }
    state.viewport.scaleX = 4000
    state.viewport.scaleY = 4000
    const restored = parseProject(serializeProject(state))
    const arrow = buildContourGeometry(restored).segments[1].arrow!
    const coordinates = arrow.path.split(/\s+/)
    const dx = Number(coordinates[1]) - Number(coordinates.at(-2))
    const dy = Number(coordinates[2]) - Number(coordinates.at(-1))
    expect(Math.hypot(dx, dy)).toBeCloseTo(12, 5)
    expect(arrow.bounds.right - arrow.bounds.left).toBeLessThan(16)
  })
  it('places the tip at the saved line position and keeps a 12px shaft on the path', () => {
    const state = createArcFixture()
    state.segments[0].arrowPosition = 0.25
    const arrow = buildContourGeometry(state).segments[0].arrow!
    expect(arrow.point).toEqual({ x: 360, y: 300 })
    expect(arrow.path).toBe('M 348 300 L 360 300')
  })

  it('draws an exact subarc and uses its endpoint tangent rather than its chord', () => {
    const state = createArcFixture()
    state.segments[1].arrowPosition = 0.25
    state.viewport.scaleX = 80
    state.viewport.scaleY = 20
    const arrow = buildContourGeometry(state).segments[1].arrow!
    expect(arrow.point.x).toBeCloseTo(400 + 80 * Math.SQRT2)
    expect(arrow.point.y).toBeCloseTo(300 - 20 * Math.SQRT2)
    expect(arrow.tangent.x).toBeCloseTo(-4 / Math.sqrt(17))
    expect(arrow.tangent.y).toBeCloseTo(-1 / Math.sqrt(17))
    expect(arrow.path).toContain(' A 160 40 0 0 0 ')
    const [x, y] = arrow.path.split(' ').slice(1, 3).map(Number)
    expect(((x - 400) / 160) ** 2 + ((y - 300) / 40) ** 2).toBeCloseTo(1, 12)
    expect(arrow.bounds.left).toBeLessThanOrEqual(arrow.point.x)
    expect(arrow.bounds.top).toBeLessThanOrEqual(arrow.point.y)
  })

  it('clamps near the start without changing the requested position or leaving the segment', () => {
    const state = createArcFixture()
    state.segments[0].arrowPosition = 0
    const arrow = buildContourGeometry(state).segments[0].arrow!
    expect(arrow.point.x).toBeGreaterThanOrEqual(330)
    expect(arrow.path.startsWith('M 320 300 L ')).toBe(true)
    expect(state.segments[0].arrowPosition).toBe(0)
    const moved = contourReducer(state, { type: 'arrowPosition', id: 'edge-a', position: 1 })
    expect(buildContourGeometry(moved).segments[0].arrow!.point.x).toBe(480)
  })

  it('keeps short-object hiding and never rewrites positions when zooming', () => {
    const state = createArcFixture()
    state.appearance.stroke.arrowSize = 20
    state.segments[0].arrowPosition = 0.1
    state.viewport.scaleX = 4
    state.viewport.scaleY = 4
    expect(buildContourGeometry(state).segments[0].arrow).toBeUndefined()
    expect(state.segments[0].arrowPosition).toBe(0.1)
    state.viewport.scaleX = 40
    expect(buildContourGeometry(state).segments[0].arrow).toBeDefined()
  })

  it('keeps a parent arrow on one owned bank fragment and never draws across a child cut', () => {
    let state = createPathArrowFixture()
    state = contourReducer(state, {
      type: 'arrowPosition',
      id: 'avoid:parent:entry',
      position: 0.5,
    })
    const parts = buildContourGeometry(state).segments.filter(
      (s) => s.arrow?.objectId === 'avoid:parent:entry',
    )
    expect(parts).toHaveLength(1)
    expect(parts[0].segment.kind).toBe('line')
    expect(parts[0].arrow!.path).not.toContain('A')
    const nums = parts[0].arrow!.path.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi)!.map(Number)
    expect(Math.hypot(nums[2] - nums[0], nums[3] - nums[1])).toBeLessThanOrEqual(12.000001)
  })

  it.each([false, true])(
    'keeps large arcs finite under anisotropic projection, reversed=%s',
    (reverse) => {
      let state = createArcFixture()
      state.segments[1] = {
        ...state.segments[1],
        kind: 'arc',
        through: { re: 0, im: -4 },
        arrowPosition: 0.2,
      }
      state.viewport.scaleX = 4000
      state.viewport.scaleY = 0.01
      if (reverse) state = contourReducer(state, { type: 'reverse' })
      const arrow = buildContourGeometry(state).segments.find(
        (s) => s.segment.id === 'edge-b',
      )!.arrow!
      expect(arrow).toBeDefined()
      expect(arrow.path).not.toMatch(/NaN|Infinity/)
      expect(Object.values(arrow.bounds).every(Number.isFinite)).toBe(true)
      expect(Math.hypot(arrow.tangent.x, arrow.tangent.y)).toBeCloseTo(1)
    },
  )
})
