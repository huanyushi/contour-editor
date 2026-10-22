import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SceneThumbnail } from './SceneThumbnail'
import { createInitialState } from '../model'
import { createBlankCanvasState } from '../../project/canvasWorkspace'
import { defaultLabel, defaultPointStyle } from '../appearance'

describe('scene thumbnails', () => {
  it('renders formulas and independent objects through the complete scene', () => {
    const state = createBlankCanvasState()
    state.formulas = [
      { id: 'f', re: 1, im: 1, label: defaultLabel('x^2'), pointStyle: defaultPointStyle() },
    ]
    render(<SceneThumbnail state={state} label="作品预览" />)
    const image = screen.getByRole('img', { name: '作品预览' })
    const svg = decodeURIComponent(image.getAttribute('src')!.split(',')[1])
    expect(svg).toContain('x^2')
    expect(svg).not.toContain('data-export-omit')
    expect(svg).not.toContain('tabindex')
  })

  it('keeps the same thumbnail when only selection or view changes', () => {
    const state = createInitialState()
    const { rerender } = render(<SceneThumbnail state={state} label="作品预览" />)
    const image = screen.getByRole('img')
    const before = image.getAttribute('src')
    rerender(
      <SceneThumbnail
        state={{
          ...state,
          selection: { kind: 'none' },
          viewport: { ...state.viewport, centerRe: 50 },
        }}
        label="作品预览"
      />,
    )
    expect(image.getAttribute('src')).toBe(before)
    rerender(
      <SceneThumbnail
        state={{ ...state, vertices: state.vertices.map((v) => ({ ...v, re: v.re * 2 })) }}
        label="作品预览"
      />,
    )
    expect(image.getAttribute('src')).not.toBe(before)
  })
})
