import { describe, expect, it } from 'vitest'
import { createArcFixture } from '../../test/fixtures'
import { serializeSvg, defaultExportOptions } from './export'
import { renderExport } from './renderExport'

describe('adaptive standalone SVG export', () => {
  it('exports the same curved shaft and sized head without editable hit geometry', () => {
    const state = createArcFixture()
    state.segments[1].arrowPosition = 0.8
    state.appearance.stroke.arrowShape = 'open'
    state.appearance.stroke.arrowSize = 20
    const before = JSON.stringify(state)
    const text = renderExport(state, { ...defaultExportOptions(), axes: false })
    const result = new DOMParser().parseFromString(text, 'image/svg+xml')
    const shaft = result.querySelector('path[marker-end="url(#direction-edge-b)"]')!
    expect(shaft.tagName).toBe('path')
    expect(shaft.getAttribute('d')).toContain(' A 80 80 ')
    expect(result.querySelector('#direction-edge-b')?.getAttribute('markerHeight')).toBe('20')
    expect(result.querySelector('#direction-edge-b path')?.getAttribute('fill')).toBe('none')
    expect(text).not.toContain('arrow-hit-')
    expect(JSON.stringify(state)).toBe(before)
  })
  it('exports a wide figure and offset labels at their natural dimensions by default', () => {
    const state = createArcFixture()
    state.vertices[0].re = -15
    state.vertices[1].re = 15
    state.segments = [state.segments[0]]
    state.closed = false
    state.vertices[1].label = {
      tex: 'R_{\\mathrm{outside}}',
      visible: true,
      size: 24,
      color: '#202a30',
      dx: 140,
      dy: -110,
    }
    const original = JSON.stringify(state)
    const text = renderExport(state, { ...defaultExportOptions(), axes: false })
    const result = new DOMParser().parseFromString(text, 'image/svg+xml')
    const [left, top, width, height] = result.documentElement
      .getAttribute('viewBox')!
      .split(/\s+/)
      .map(Number)
    expect(width).toBeGreaterThan(1400)
    expect(width / height).toBeGreaterThan(4)
    expect(left).toBeLessThan(0)
    expect(Number.isFinite(top)).toBe(true)
    expect(result.documentElement.getAttribute('width')).toBe(String(width))
    expect(result.documentElement.getAttribute('height')).toBe(String(height))
    expect(
      [...result.querySelectorAll('[aria-label]')]
        .find((node) => node.getAttribute('aria-label') === 'R_{\\mathrm{outside}}')
        ?.querySelector('path'),
    ).toBeTruthy()
    expect(text).not.toContain('data-export-omit')
    expect(JSON.stringify(state)).toBe(original)
  })

  it('serializes the actual viewBox including its nonzero origin', () => {
    const source = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    source.setAttribute('viewBox', '-300.5 12 1401 260')
    const result = new DOMParser().parseFromString(
      serializeSvg(source, defaultExportOptions()),
      'image/svg+xml',
    ).documentElement
    expect(result.getAttribute('viewBox')).toBe('-300.5 12 1401 260')
    expect(result.getAttribute('width')).toBe('1401')
    expect(result.getAttribute('height')).toBe('260')
  })
})
