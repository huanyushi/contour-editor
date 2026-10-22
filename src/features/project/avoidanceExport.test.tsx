import { describe, expect, it } from 'vitest'
import { arcExtrema } from '../../lib/arc'
import { toSvg, type SvgPoint } from '../../lib/geometry'
import { createAvoidanceFixture } from '../../test/avoidanceFixtures'
import { defaultLabel } from '../contour/appearance'
import { createHistory, historyReducer } from '../contour/history'
import { buildContourGeometry } from '../contour/scene/pathGeometry'
import { defaultExportOptions } from './export'
import { computeExportLayout } from './exportLayout'
import { serializeProject } from './project'
import { renderExport } from './renderExport'

const options = { ...defaultExportOptions(), axes: false }

function parseSvg(text: string) {
  const document = new DOMParser().parseFromString(text, 'image/svg+xml')
  expect(document.querySelector('parsererror')).toBeNull()
  const svg = document.documentElement
  const box = svg.getAttribute('viewBox')!.split(/\s+/).map(Number)
  expect(box).toHaveLength(4)
  expect(box.every(Number.isFinite)).toBe(true)
  expect(box[2]).toBeGreaterThan(0)
  expect(box[3]).toBeGreaterThan(0)
  expect(svg.getAttribute('width')).toBe(String(box[2]))
  expect(svg.getAttribute('height')).toBe(String(box[3]))
  return svg
}

function expectInside(svg: Element, point: SvgPoint, radius = 0) {
  const [left, top, width, height] = svg.getAttribute('viewBox')!.split(/\s+/).map(Number)
  expect(point.x - radius).toBeGreaterThanOrEqual(left + 24)
  expect(point.x + radius).toBeLessThanOrEqual(left + width - 24)
  expect(point.y - radius).toBeGreaterThanOrEqual(top + 24)
  expect(point.y + radius).toBeLessThanOrEqual(top + height - 24)
}

function expectLabelInside(svg: Element, tex: string, anchor: SvgPoint) {
  const labels = svg.querySelectorAll(`g[aria-label="${tex}"]`)
  expect(labels).toHaveLength(1)
  const label = labels[0]
  expect(label.querySelector('path')).not.toBeNull()
  const transform = label
    .getAttribute('transform')!
    .match(/translate\((\S+) (\S+)\) scale\((\S+)\)/)!
  const [, x, y, scale] = transform.map(Number)
  expect(x).toBeCloseTo(anchor.x)
  expect(y).toBeCloseTo(anchor.y)
  const glyph = label.querySelector('svg')!
  // Read actual serialized glyph dimensions, independently of export's mathSize.
  expectInside(svg, { x, y })
  expectInside(svg, {
    x: x + Number(glyph.getAttribute('width')) * scale,
    y: y + Number(glyph.getAttribute('height')) * scale,
  })
}

describe('actual avoidance SVG export', () => {
  it('exports and measures the real semantic corner circle with optional endpoints hidden', () => {
    const state = createAvoidanceFixture()
    state.markers = []
    state.vertices = state.vertices.map((v) => ({
      ...v,
      label: { ...defaultLabel(), visible: false },
    }))
    state.vertices[1].mathematicalKind = 'pole'
    state.vertices[1].pointStyle = { color: '#dc2626', radius: 12 }
    state.avoidances = [{ ...state.avoidances[0], markerId: 'b', exitSegmentId: 'edge-b' }]
    state.handles = false
    const exportOptions = { ...options, endpoints: false }
    const layout = computeExportLayout(state, exportOptions)
    const svg = parseSvg(renderExport(state, exportOptions))
    expect(svg.querySelectorAll('circle')).toHaveLength(1)
    const circle = svg.querySelector('circle')!
    expect(circle.getAttribute('fill')).toBe('#dc2626')
    expect(circle.getAttribute('r')).toBe('12')
    expect(circle.getAttribute('visibility')).not.toBe('hidden')
    expectInside(svg, toSvg(state.vertices[1], layout.state.viewport), 12.5)
    expect(state.markers).toHaveLength(0)
  })

  it.each([false, true])(
    'contains off-line arc extrema and chain arrows, exporting only source endpoints (endpoints=%s)',
    (endpoints) => {
      const state = createAvoidanceFixture()
      state.markers[0].im = -3
      state.viewport = { ...state.viewport, scaleX: 80, scaleY: 20, locked: false }
      state.avoidances[0].partStyles = { entry: { arrows: true, width: 8 } }
      const before = JSON.stringify(state)
      const exportOptions = { ...options, endpoints, background: 'transparent' as const }
      const layout = computeExportLayout(state, exportOptions)
      const text = renderExport(state, exportOptions)
      const svg = parseSvg(text)
      const arc = buildContourGeometry(layout.state).segments.find((part) => part.arc)!.arc!
      expect(arc.center.re).toBeCloseTo(0)
      expect(arc.center.im).toBeCloseTo(-3)
      expect(arc.radius).toBeCloseTo(0.5)
      const extrema = arcExtrema(arc)
      // The 300° lower detour includes both horizontal extrema and the bottom;
      // its uppermost points are its ends, not the circle's omitted upper cap.
      const expectedExtrema = [
        { re: -0.25, im: -3 + Math.sqrt(3) / 4 },
        { re: 0.25, im: -3 + Math.sqrt(3) / 4 },
        { re: -0.5, im: -3 },
        { re: 0.5, im: -3 },
        { re: 0, im: -3.5 },
      ]
      expect(extrema).toHaveLength(expectedExtrema.length)
      for (const point of expectedExtrema) {
        expect(extrema.some((p) => Math.hypot(p.re - point.re, p.im - point.im) < 1e-9)).toBe(true)
        expectInside(svg, toSvg(point, layout.state.viewport), 1)
      }
      const path = [...svg.querySelectorAll('path[stroke]')].find((p) =>
        /^M \S+ \S+ A /.test(p.getAttribute('d') ?? ''),
      )!
      const command = path.getAttribute('d')!.split(/\s+/)
      expect(command[3]).toBe('A')
      expect(Number(command[4])).toBeCloseTo(40)
      expect(Number(command[5])).toBeCloseTo(10)
      expect(command.slice(6, 9)).toEqual(['0', '1', '0'])
      const start = toSvg(expectedExtrema[0], layout.state.viewport)
      const end = toSvg(expectedExtrema[1], layout.state.viewport)
      expect(Number(command[1])).toBeCloseTo(start.x)
      expect(Number(command[2])).toBeCloseTo(start.y)
      expect(Number(command[9])).toBeCloseTo(end.x)
      expect(Number(command[10])).toBeCloseTo(end.y)

      const arrows = svg.querySelectorAll('line[marker-end]')
      expect(arrows).toHaveLength(8) // Five independent replacement objects plus three uncut sides.
      for (const line of arrows) {
        const x1 = Number(line.getAttribute('x1'))
        const y1 = Number(line.getAttribute('y1'))
        const x2 = Number(line.getAttribute('x2'))
        const y2 = Number(line.getAttribute('y2'))
        const tx = (x2 - x1) / 12
        const ty = (y2 - y1) / 12
        const radius = Number(line.getAttribute('stroke-width')) / 2
        expectInside(svg, { x: x1, y: y1 }, radius)
        expectInside(svg, { x: x2, y: y2 }, radius)
        // Measure the real serialized marker triangle in the shaft's frame.
        const markerId = line.getAttribute('marker-end')!.slice(5, -1)
        const marker = svg.querySelector(`[id="${markerId}"]`)!
        expect(marker.getAttribute('markerUnits')).toBe('userSpaceOnUse')
        const refX = Number(marker.getAttribute('refX'))
        const refY = Number(marker.getAttribute('refY'))
        const [, , markerWidth, markerHeight] = marker
          .getAttribute('viewBox')!
          .split(/\s+/)
          .map(Number)
        const scale = Math.min(
          Number(marker.getAttribute('markerWidth')) / markerWidth,
          Number(marker.getAttribute('markerHeight')) / markerHeight,
        )
        const vertices = marker
          .querySelector('path')!
          .getAttribute('d')!
          .match(/-?\d+(?:\.\d+)?/g)!
          .map(Number)
        expect(vertices).toHaveLength(6)
        for (let i = 0; i < vertices.length; i += 2) {
          const along = (vertices[i] - refX) * scale
          const normal = (vertices[i + 1] - refY) * scale
          expectInside(svg, { x: x2 + along * tx - normal * ty, y: y2 + along * ty + normal * tx })
        }
      }
      const arcArrow = [...arrows].find((line) =>
        line.getAttribute('marker-end')?.includes('avoid:avoid-1:arc'),
      )!
      const bottom = toSvg({ re: 0, im: -3.5 }, layout.state.viewport)
      expect(Number(arcArrow.getAttribute('x1'))).toBeCloseTo(bottom.x - 6)
      expect(Number(arcArrow.getAttribute('y1'))).toBeCloseTo(bottom.y)
      expect(svg.querySelectorAll('circle')).toHaveLength(endpoints ? 5 : 1)
      if (endpoints) {
        for (const vertex of state.vertices) {
          const p = toSvg(vertex, layout.state.viewport)
          const group = [...svg.querySelectorAll('g')].find(
            (g) => g.getAttribute('transform') === `translate(${p.x} ${p.y})`,
          )!
          expect(group.querySelector('circle[stroke="#fff"]')).not.toBeNull()
        }
      }
      expect(svg.querySelector('rect')?.getAttribute('fill')).toBe('none')
      expect(
        [...svg.querySelectorAll('[aria-label]')].some(
          (node) => node.getAttribute('aria-label') === '\\mathrm{Re}',
        ),
      ).toBe(false)
      expect(
        svg.querySelector('[data-export-omit], [data-source-segment-id], [data-testid]'),
      ).toBeNull()
      expect(JSON.stringify(state)).toBe(before)
    },
  )

  it.each(['contour', 'connection'] as const)(
    'contains source and all part label offsets once for a bound %s line',
    (collection) => {
      const state = createAvoidanceFixture()
      state.markers[0].im = -3
      state.segments[0].label = { ...defaultLabel('S'), dx: -700, dy: -450, size: 24 }
      state.avoidances[0].partLabels = {
        arc: { ...defaultLabel('D'), dx: 650, dy: 450, size: 32 },
        entry: { ...defaultLabel('E'), dx: -800, dy: 280 },
        exit: { ...defaultLabel('X'), dx: 720, dy: -700 },
      }
      if (collection === 'connection') {
        state.connections = [state.segments[0]]
        state.segments = state.segments.slice(1)
        state.closed = false
      }
      const before = JSON.stringify(state)
      const layout = computeExportLayout(state, options)
      const svg = parseSvg(renderExport(state, options))
      // The inherited source label belongs to the first retained piece, not the detour arc.
      const bottom = toSvg({ re: 0, im: -3.5 }, layout.state.viewport)
      const retained = toSvg({ re: -2.125, im: 0 }, layout.state.viewport)
      const entry = toSvg({ re: -0.25, im: (-3 + Math.sqrt(3) / 4) / 2 }, layout.state.viewport)
      const exit = toSvg({ re: 0.25, im: (-3 + Math.sqrt(3) / 4) / 2 }, layout.state.viewport)
      expectLabelInside(svg, 'S', { x: retained.x - 700, y: retained.y - 450 })
      expectLabelInside(svg, 'D', { x: bottom.x + 650, y: bottom.y + 450 })
      expectLabelInside(svg, 'E', { x: entry.x - 800, y: entry.y + 280 })
      expectLabelInside(svg, 'X', { x: exit.x + 720, y: exit.y - 700 })
      expect(JSON.stringify(state)).toBe(before)
    },
  )

  it('adapts only the export viewport while preserving bindings, coordinates, selection and history', () => {
    const initial = createAvoidanceFixture()
    initial.markers[0].im = -3
    initial.viewport = { ...initial.viewport, scaleX: 4000, scaleY: 1000, locked: false }
    initial.avoidances[0].partLabels = { arc: { ...defaultLabel('D'), dx: 700, dy: 350 } }
    let history = createHistory(initial)
    for (const radius of [0.6, 0.7])
      history = historyReducer(history, {
        type: 'updateAvoidance',
        id: 'avoid-1',
        patch: { radius },
      })
    history = historyReducer(history, { type: 'undo' })
    expect(history.past).toHaveLength(1)
    expect(history.future).toHaveLength(1)
    const state = history.present
    const before = JSON.stringify(history)
    const saved = serializeProject(state)
    const layout = computeExportLayout(state, options)
    const svg = parseSvg(renderExport(state, options))
    expect(layout.state.viewport.scaleX).toBeLessThan(state.viewport.scaleX)
    expect(layout.state.viewport.scaleY / layout.state.viewport.scaleX).toBeCloseTo(0.25)
    expect(Math.max(layout.size.width, layout.size.height)).toBeLessThanOrEqual(2400)
    const bottom = toSvg({ re: 0, im: -3.6 }, layout.state.viewport)
    expectLabelInside(svg, 'D', { x: bottom.x + 700, y: bottom.y + 350 })
    expect(layout.state.avoidances).toEqual(state.avoidances)
    expect(layout.state.markers).toEqual(state.markers)
    expect(layout.state.vertices).toEqual(state.vertices)
    expect(JSON.stringify(history)).toBe(before)
    expect(serializeProject(state)).toBe(saved)
  })

  it('keeps the current 800×600 view even when a detour and its label are outside it', () => {
    const state = createAvoidanceFixture()
    state.markers[0].im = -30
    state.avoidances[0].partLabels = { arc: { ...defaultLabel('D'), dx: 700, dy: 350 } }
    state.viewport = { ...state.viewport, centerRe: 1, centerIm: 2 }
    const before = JSON.stringify(state)
    const viewOptions = { ...options, region: 'view' as const }
    const layout = computeExportLayout(state, viewOptions)
    const svg = parseSvg(renderExport(state, viewOptions))
    expect(svg.getAttribute('viewBox')).toBe('0 0 800 600')
    expect(layout.state.viewport).toEqual(state.viewport)
    expect(svg.querySelector('g[aria-label="D"] path')).not.toBeNull()
    expect(svg.getAttribute('overflow')).toBe('hidden')
    expect(JSON.stringify(state)).toBe(before)
  })
})
