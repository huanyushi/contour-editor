import { describe, expect, it } from 'vitest'
import { toSvg } from '../../lib/geometry'
import { renderMath } from '../../lib/math'
import { canvasBounds } from '../../lib/viewport'
import { defaultLabel, defaultPointStyle } from '../contour/appearance'
import type { ContourState } from '../contour/model'
import { createArcFixture } from '../../test/fixtures'
import { defaultExportOptions } from './export'
import { computeExportLayout } from './exportLayout'

const options = { ...defaultExportOptions(), axes: false }

function emptyScene(): ContourState {
  return { ...createArcFixture(), vertices: [], segments: [], closed: false }
}

describe('content export layout', () => {
  it('keeps current unequal scales and contains wide geometry, strokes and offset text', () => {
    const state = createArcFixture()
    state.viewport = { ...state.viewport, scaleX: 60, scaleY: 30, locked: false }
    state.vertices = [
      { id: 'a', re: -12, im: -1, label: { ...defaultLabel(), visible: false } },
      { id: 'b', re: 12, im: 1, label: { ...defaultLabel('R'), dx: 180, dy: -130 } },
    ]
    state.segments = [state.segments[0]]
    state.closed = false
    const before = JSON.stringify(state)
    const layout = computeExportLayout(state, options)
    const bounds = canvasBounds(layout.size)
    const a = toSvg(state.vertices[0], layout.state.viewport)
    const b = toSvg(state.vertices[1], layout.state.viewport)
    expect(layout.size.width).toBeGreaterThan(1600)
    expect(layout.size.width / layout.size.height).toBeGreaterThan(4)
    expect(a.x - 1).toBeGreaterThanOrEqual(bounds.left + 24)
    expect(a.y + 1).toBeLessThanOrEqual(bounds.bottom - 24)
    expect(b.x + 180 + renderMath('R').width).toBeLessThanOrEqual(bounds.right - 24)
    expect(b.y - 130).toBeGreaterThanOrEqual(bounds.top + 24)
    expect(layout.state.viewport.scaleX).toBe(60)
    expect(layout.state.viewport.scaleY).toBe(30)
    expect(layout.state).not.toBe(state)
    expect(layout.state.viewport).not.toBe(state.viewport)
    expect(JSON.stringify(state)).toBe(before)
  })

  it('includes independent major arcs and markers even with contour endpoints hidden', () => {
    const state = emptyScene()
    const hiddenLabel = { ...defaultLabel(), visible: false }
    state.markers = [
      { id: 'p', re: 2, im: 0, pointStyle: defaultPointStyle(), label: hiddenLabel },
      { id: 'q', re: 0, im: 2, pointStyle: defaultPointStyle(), label: hiddenLabel },
    ]
    state.connections = [
      { id: 'major', kind: 'arc', startId: 'p', endId: 'q', through: { re: -2, im: 0 } },
    ]
    const { state: scene, size } = computeExportLayout(state, options)
    const bounds = canvasBounds(size)
    // This is the 270° arc of the radius-2 circle, including the bottom extremum.
    for (const point of [
      { re: -2, im: 0 },
      { re: 0, im: -2 },
      { re: 2, im: 0 },
    ]) {
      const p = toSvg(point, scene.viewport)
      expect(p.x).toBeGreaterThan(bounds.left + 24)
      expect(p.x).toBeLessThan(bounds.right - 24)
      expect(p.y).toBeGreaterThan(bounds.top + 24)
      expect(p.y).toBeLessThan(bounds.bottom - 24)
    }
    expect(size.width).toBeGreaterThanOrEqual(208)
    expect(size.height).toBeGreaterThanOrEqual(208)
  })

  it('includes vertex labels without endpoint markers but omits hidden-only anchors', () => {
    const state = emptyScene()
    state.vertices = [{ id: 'lonely', re: 0, im: 0, label: { ...defaultLabel(), visible: false } }]
    expect(computeExportLayout(state, options).size).toEqual({ width: 800, height: 600 })
    expect(computeExportLayout(state, { ...options, endpoints: true }).size.width).toBeLessThan(800)
    state.vertices[0].label = { ...defaultLabel('z'), dx: 700, dy: -120 }
    const { state: scene, size } = computeExportLayout(state, options)
    const anchor = toSvg(state.vertices[0], scene.viewport)
    const bounds = canvasBounds(size)
    expect(anchor.x + 700).toBeGreaterThanOrEqual(bounds.left + 24)
    expect(anchor.x + 700 + renderMath('z').width).toBeLessThanOrEqual(bounds.right - 24)
  })

  it('retains an isolated marker radius and a formula pixel offset', () => {
    const state = emptyScene()
    state.markers = [
      {
        id: 'm',
        re: 0,
        im: 0,
        pointStyle: { ...defaultPointStyle(), radius: 12 },
        label: { ...defaultLabel(), visible: false },
      },
    ]
    state.formulas = [
      {
        id: 'f',
        re: 1,
        im: 0,
        pointStyle: defaultPointStyle(),
        label: { ...defaultLabel('\\frac{1}{z}'), dx: 700, dy: -180, size: 32 },
      },
    ]
    const { state: scene, size } = computeExportLayout(state, options)
    const bounds = canvasBounds(size)
    const p = toSvg(state.markers[0], scene.viewport)
    const f = toSvg(state.formulas[0], scene.viewport)
    expect(p.x - 12).toBeGreaterThanOrEqual(bounds.left + 24)
    expect(p.y + 12).toBeLessThanOrEqual(bounds.bottom - 24)
    expect(f.x + 700 + renderMath('\\frac{1}{z}').width * 2).toBeLessThanOrEqual(bounds.right - 24)
    expect(f.y - 180).toBeGreaterThanOrEqual(bounds.top + 24)
  })

  it('caps a huge wide scene without distortion and recomputes fixed-size labels', () => {
    const state = createArcFixture()
    state.vertices = [
      { id: 'a', re: -1000, im: -10, label: { ...defaultLabel('L'), dx: -200 } },
      { id: 'b', re: 1000, im: 10, label: { ...defaultLabel('R'), dx: 200 } },
    ]
    state.segments = [state.segments[0]]
    state.closed = false
    state.viewport = { ...state.viewport, scaleX: 80, scaleY: 40, locked: false }
    const original = JSON.stringify(state)
    const { state: scene, size } = computeExportLayout(state, options)
    expect(Math.max(size.width, size.height)).toBeLessThanOrEqual(2400)
    expect(size.width / size.height).toBeGreaterThan(4)
    expect(scene.viewport.scaleX).toBeLessThan(80)
    expect(scene.viewport.scaleY / scene.viewport.scaleX).toBeCloseTo(0.5)
    const bounds = canvasBounds(size)
    const right = toSvg(state.vertices[1], scene.viewport)
    expect(right.x + 200 + renderMath('R').width).toBeLessThanOrEqual(bounds.right - 24)
    expect(JSON.stringify(state)).toBe(original)
  })

  it.each(['wide', 'tall'])(
    'fits a very %s figure with fixed-pixel offset text without forcing text into a narrow provisional canvas',
    (shape) => {
      const state = createArcFixture()
      const wide = shape === 'wide'
      state.vertices = [
        {
          id: 'a',
          re: wide ? -100 : 0,
          im: wide ? 0 : -100,
          label: { ...defaultLabel(), visible: false },
        },
        {
          id: 'b',
          re: wide ? 100 : 0,
          im: wide ? 0 : 100,
          label: { ...defaultLabel('R'), dx: wide ? 12 : 100, dy: wide ? -100 : -24 },
        },
      ]
      state.segments = [state.segments[0]]
      state.closed = false
      const original = JSON.stringify(state)
      const layout = computeExportLayout(state, defaultExportOptions())
      const bounds = canvasBounds(layout.size)
      const point = toSvg(state.vertices[1], layout.state.viewport)
      const label = state.vertices[1].label!
      expect(Math.max(layout.size.width, layout.size.height)).toBeLessThanOrEqual(2400)
      expect(point.x + label.dx).toBeGreaterThanOrEqual(bounds.left + 56)
      expect(point.x + label.dx + renderMath('R').width).toBeLessThanOrEqual(bounds.right - 56)
      expect(point.y + label.dy).toBeGreaterThanOrEqual(bounds.top + 56)
      expect(JSON.stringify(state)).toBe(original)
    },
  )

  it('rejects nonfinite geometry and unshrinkable text rather than silently clipping', () => {
    const state = emptyScene()
    state.formulas = [
      {
        id: 'f',
        re: 0,
        im: 0,
        pointStyle: defaultPointStyle(),
        label: { ...defaultLabel('R'), size: 10000 },
      },
    ]
    expect(() => computeExportLayout(state, options)).toThrow(/导出|尺寸/)
    state.formulas[0].label = defaultLabel('z')
    state.formulas[0].re = Infinity
    expect(() => computeExportLayout(state, options)).toThrow(/导出|有限/)
  })

  it('rejects oversized axis names even when the figure is empty', () => {
    const state = emptyScene()
    state.axes.reLabel = '\\rule{180em}{1em}'
    expect(() => computeExportLayout(state, defaultExportOptions())).toThrow(/导出|尺寸/)
  })

  it('contains long numeric axis ticks on a translated figure', () => {
    const state = emptyScene()
    state.markers = [
      {
        id: 'm',
        re: 1e12 - 4.25,
        im: 0,
        pointStyle: defaultPointStyle(),
        label: { ...defaultLabel(), visible: false },
      },
    ]
    state.viewport.centerRe = 1e12 - 4.25
    state.axes.reLabel = '\\frac{\\mathrm{Real}}{z}'
    state.axes.imLabel = '\\frac{1}{\\frac{1}{z}}'
    const { size } = computeExportLayout(state, defaultExportOptions())
    // Tick 999999999995 is 30px left of center. Its conservative 84px text
    // box starts at x=328; the marker-only canvas would start at x=339.
    expect(canvasBounds(size).left).toBeLessThanOrEqual(328)
    expect(size.width).toBeLessThanOrEqual(2400)
  })

  it('uses the old view for fixed mode and for an empty figure', () => {
    const state = createArcFixture()
    state.viewport.centerRe = 100
    const view = computeExportLayout(state, { ...options, region: 'view' })
    expect(view.size).toEqual({ width: 800, height: 600 })
    expect(view.state.viewport).toEqual(state.viewport)
    expect(computeExportLayout(emptyScene(), options).size).toEqual({ width: 800, height: 600 })
  })
})
