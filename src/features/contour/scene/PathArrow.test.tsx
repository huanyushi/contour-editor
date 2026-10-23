import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { createArcFixture } from '../../../test/fixtures'
import { CanvasScene } from './CanvasScene'

it.each(['triangle', 'latex', 'open'] as const)(
  'draws a curved shaft and tangent %s head with pixel sizing',
  (shape) => {
    const state = createArcFixture()
    state.appearance.stroke = {
      ...state.appearance.stroke,
      arrowShape: shape,
      arrowSize: 20,
      color: '#123456',
    }
    state.segments[1].arrowPosition = 0.25
    const { container } = render(<CanvasScene state={state} />)
    const shaft = screen.getByTestId('arrow-edge-b')
    expect(shaft.tagName).toBe('path')
    expect(shaft.getAttribute('d')).toContain(' A 80 80 ')
    expect(shaft).toHaveAttribute('stroke', '#123456')
    const marker = container.querySelector('#direction-edge-b')!
    expect(marker).toHaveAttribute('markerUnits', 'userSpaceOnUse')
    expect(marker).toHaveAttribute('markerHeight', '20')
    expect(Number(marker.getAttribute('orient'))).toBeCloseTo(-135)
    expect(marker.querySelector('path')).toHaveAttribute(
      'fill',
      shape === 'open' ? 'none' : '#123456',
    )
    expect(container.querySelector('[data-testid^="arrow-hit-"]')).toBeNull()
  },
)

it.each([6, 10, 20])('renders %spx arrow heads independently of line width and zoom', (size) => {
  const state = createArcFixture()
  state.appearance.stroke.arrowSize = size
  state.appearance.stroke.width = 8
  state.viewport.scaleX = 80
  const { container } = render(<CanvasScene state={state} />)
  expect(container.querySelector('#direction-edge-a')).toHaveAttribute('markerHeight', `${size}`)
})
