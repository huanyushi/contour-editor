import { describe, expect, it } from 'vitest'
import { snapToGrid as snap } from './snap'
import { defaultViewport, panViewport } from './viewport'

describe('screen-distance adaptive grid snapping', () => {
  it('snaps near positive and negative integer intersections', () => {
    expect(snap({ re: 1.1, im: -1.9 }, 40, true, defaultViewport())).toEqual({ re: 1, im: -2 })
  })

  it.each([
    [400, 0.31, -0.21, 0.3, -0.2],
    [4, 10.5, -19.5, 10, -20],
    [0.01, 5001, -9999, 5000, -10000],
  ])('uses the displayed grid at %s pixels per unit', (scale, re, im, x, y) => {
    const view = { ...defaultViewport(), scaleX: scale, scaleY: scale }
    expect(snap({ re, im }, scale, true, view)).toEqual({ re: x, im: y })
  })

  it('uses separate axis grid steps and a circular CSS-pixel threshold', () => {
    const view = { ...defaultViewport(), scaleX: 400, scaleY: 4, locked: false }
    expect(snap({ re: 0.31, im: 10.5 }, { x: 400, y: 4 }, true, view)).toEqual({
      re: 0.3,
      im: 10,
    })
    const far = { re: 0.32, im: 10.5 }
    expect(snap(far, { x: 400, y: 4 }, true, view)).toBe(far)
  })

  it('keeps the grid step independent of CSS scaling', () => {
    const view = { ...defaultViewport(), scaleX: 400, scaleY: 400 }
    expect(snap({ re: 0.31, im: 0.3 }, 600, true, view)).toEqual({ re: 0.3, im: 0.3 })
    const far = { re: 0.32, im: 0.3 }
    expect(snap(far, 600, true, view)).toBe(far)
    expect(snap(far, 200, true, view)).toEqual({ re: 0.3, im: 0.3 })
    expect(snap(far, 200, false, view)).toBe(far)
  })

  it('updates spacing after a large pan without offsetting the mathematical grid', () => {
    const view = panViewport(defaultViewport(), -4e7, 0)
    expect(snap({ re: 1000001.1, im: 1.1 }, 40, true, view)).toEqual({
      re: 1000001.1,
      im: 1.1,
    })
    expect(snap({ re: 1000000.1, im: 2.1 }, 40, true, view)).toEqual({
      re: 1000000,
      im: 2,
    })
  })
  it('does not snap a distant point or only one axis', () => {
    expect(snap({ re: 1.01, im: 1.4 }, 40, true, defaultViewport())).toEqual({ re: 1.01, im: 1.4 })
  })
  it('uses screen scale and can be bypassed without changing input', () => {
    const point = { re: -0.2, im: 2.2 }
    expect(snap(point, 20, true, defaultViewport())).toEqual({ re: 0, im: 2 })
    expect(snap(point, 80, true, defaultViewport())).toEqual(point)
    expect(snap(point, 20, false, defaultViewport())).toEqual(point)
  })
})
