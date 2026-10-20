import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ContourCanvas } from '../contour/ContourCanvas'
import { contourReducer } from '../contour/model'
import { createArcFixture } from '../../test/fixtures'
import { serializeSvg, defaultExportOptions } from './export'
import { renderExport } from './renderExport'

function canvas(handles = true) {
  let state = contourReducer(createArcFixture(), {
    type: 'addMarker',
    id: 'pole',
    point: { re: 0, im: 1 },
  })
  state = contourReducer(state, { type: 'selectSegment', id: 'edge-b' })
  state = { ...state, handles, grid: false }
  render(
    <ContourCanvas
      state={state}
      dispatch={() => {}}
      tool="select"
      onArcPoint={() => {}}
      gestureOwner={null}
    />,
  )
  return screen.getByTestId('contour-canvas') as unknown as SVGSVGElement
}

describe('standalone SVG export', () => {
  it('renders a separate fixed export region with full axes without changing the document', () => {
    const state = createArcFixture()
    const original = JSON.stringify(state)
    const text = renderExport(state, defaultExportOptions())
    const result = new DOMParser().parseFromString(text, 'image/svg+xml')
    expect(result.querySelector('parsererror')).toBeNull()
    expect(result.documentElement.namespaceURI).toBe('http://www.w3.org/2000/svg')
    expect(result.querySelector('path')?.namespaceURI).toBe('http://www.w3.org/2000/svg')
    expect(result.documentElement.getAttribute('viewBox')).toBe('0 0 800 600')
    expect(result.querySelector('rect')?.getAttribute('width')).toBe('800')
    expect(result.querySelector('path[d="M 20 300 H 780"]')).not.toBeNull()
    expect(
      result.querySelector('path[d="M 320 300 L 480 300 A 80 80 0 0 0 320 300 Z"]'),
    ).not.toBeNull()
    expect(JSON.stringify(state)).toBe(original)
  })
  it('preserves real curves, markers and math paths while omitting editing handles', () => {
    const svg = canvas()
    const original = svg.innerHTML
    const text = serializeSvg(svg, defaultExportOptions())
    const result = new DOMParser().parseFromString(text, 'image/svg+xml')
    expect(result.querySelector('parsererror')).toBeNull()
    expect(result.documentElement.getAttribute('viewBox')).toBe('0 0 800 600')
    expect(
      result.querySelector('path[d="M 320 300 L 480 300 A 80 80 0 0 0 320 300 Z"]'),
    ).not.toBeNull()
    expect(result.querySelector('[aria-label="q_{2}"]')).toBeNull()
    expect(result.querySelector('[aria-label="z_0"] path')).not.toBeNull()
    expect(
      [...result.querySelectorAll('[aria-label]')].some(
        (node) => node.getAttribute('aria-label') === '\\mathrm{Re}',
      ),
    ).toBe(true)
    expect(result.querySelectorAll('circle')).toHaveLength(1)
    expect(text).not.toContain('data-testid')
    expect(text).not.toContain('segment-hit')
    expect(svg.innerHTML).toBe(original)
  })

  it('exports grid and endpoint markers independently of the live view switches', () => {
    const svg = canvas(false)
    const text = serializeSvg(svg, {
      ...defaultExportOptions(),
      grid: true,
      axes: false,
      endpoints: true,
      background: 'transparent',
    })
    const result = new DOMParser().parseFromString(text, 'image/svg+xml')
    expect(result.querySelector('[fill="url(#grid)"]')?.getAttribute('visibility')).not.toBe(
      'hidden',
    )
    expect(result.querySelectorAll('circle')).toHaveLength(3)
    expect(
      [...result.querySelectorAll('[aria-label]')].some(
        (node) => node.getAttribute('aria-label') === '\\mathrm{Re}',
      ),
    ).toBe(false)
    expect(result.querySelector('rect')?.getAttribute('fill')).toBe('none')
    expect(result.querySelector('[visibility="hidden"]')).toBeNull()
  })
})
