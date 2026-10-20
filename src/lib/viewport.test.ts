import { describe, expect, it } from 'vitest'
import {
  defaultViewport,
  zoomViewport,
  panViewport,
  gridStep,
  validViewport,
  ticks,
  formatTick,
  viewBounds,
} from './viewport'
import { fromSvg, toSvg } from './geometry'
import { snapToInteger } from './snap'
import { fitScene } from '../features/contour/sceneView'
import { createArcFixture } from '../test/fixtures'
import { contourTemplates } from '../features/contour/templates'
import { canvasBounds } from './viewport'

describe('mathematical viewport', () => {
  it('expands visible bounds without changing the mathematical center or unit scale', () => {
    const view = { ...defaultViewport(), centerRe: 2, centerIm: -3 }
    expect(viewBounds(view, { width: 1200, height: 400 })).toEqual({
      min: { re: -13, im: -8 },
      max: { re: 17, im: 2 },
    })
    expect(toSvg({ re: 3, im: -2 }, view)).toEqual({ x: 440, y: 260 })
  })
  it('fits a semicircle and its labels inside a tall narrow canvas with equal units', () => {
    const state = createArcFixture()
    const view = fitScene(state, { width: 240, height: 700 })!
    expect(view).not.toBeNull()
    expect(view.scaleX).toBe(view.scaleY)
    for (const point of state.vertices) {
      const projected = toSvg(point, view)
      expect(projected.x).toBeGreaterThan(300)
      expect(projected.x).toBeLessThan(500)
    }
  })
  it('leaves space between fitted contours and the axis arrows and labels on desktop and narrow canvases', () => {
    const state = contourTemplates.find((template) => template.id === 'circle')!.create()
    for (const size of [
      { width: 800, height: 600 },
      { width: 330, height: 700 },
    ]) {
      const view = fitScene(state, size)!
      const bounds = canvasBounds(size)
      const extrema = [
        ...state.vertices,
        ...state.segments.flatMap((s) => (s.kind === 'arc' ? [s.through] : [])),
      ]
      for (const point of extrema) {
        const projected = toSvg(point, view)
        expect(projected.x - bounds.left).toBeGreaterThanOrEqual(55)
        expect(bounds.right - projected.x).toBeGreaterThanOrEqual(55)
        expect(projected.y - bounds.top).toBeGreaterThanOrEqual(55)
        expect(bounds.bottom - projected.y).toBeGreaterThanOrEqual(55)
      }
    }
  })
  it('keeps distinct ticks and labels at large translated centers', () => {
    const values = ticks(1e12 - 0.1, 1e12 + 0.1, 0.01)
    expect(values.length).toBeGreaterThan(10)
    expect(new Set(values).size).toBe(values.length)
    expect(formatTick(1e7, 1)).not.toBe(formatTick(1e7 + 1, 1))
    expect(new Set(values.map((n) => formatTick(n, 0.01))).size).toBe(values.length)
  })
  it('keeps a mouse anchor at the same mathematical position when zooming', () => {
    const view = defaultViewport()
    const anchor = { x: 520, y: 220 }
    const zoomed = zoomViewport(view, anchor, 2)
    expect(fromSvg(anchor, zoomed)).toEqual({ re: 3, im: 2 })
    expect(zoomed.scaleX).toBe(80)
    expect(zoomed.centerRe).toBe(1.5)
    expect(zoomed.centerIm).toBe(1)
  })
  it('round-trips unequal axis scales and pans without changing geometry', () => {
    const view = {
      ...defaultViewport(),
      centerRe: 2,
      centerIm: -1,
      scaleX: 80,
      scaleY: 20,
      locked: false,
    }
    expect(toSvg({ re: 3, im: 2 }, view)).toEqual({ x: 480, y: 240 })
    expect(fromSvg({ x: 480, y: 240 }, view)).toEqual({ re: 3, im: 2 })
    const panned = panViewport(view, 80, -20)
    expect(panned.centerRe).toBe(1)
    expect(panned.centerIm).toBe(-2)
  })
  it('uses a readable grid step and rejects invalid viewport scales', () => {
    expect(gridStep(40)).toBe(1)
    expect(gridStep(400)).toBe(0.1)
    expect(gridStep(4)).toBe(10)
    expect(validViewport({ ...defaultViewport(), scaleX: 0 })).toBe(false)
    expect(validViewport({ ...defaultViewport(), centerRe: Infinity })).toBe(false)
  })
  it('measures snapping using both axis screen scales', () => {
    const point = { re: 0.1, im: 0.1 }
    expect(snapToInteger(point, { x: 80, y: 20 }, true)).toEqual(point)
    expect(snapToInteger(point, { x: 40, y: 20 }, true)).toEqual({ re: 0, im: 0 })
  })
})
