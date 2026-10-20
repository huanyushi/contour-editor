import { describe, expect, it } from 'vitest'
import { renderMath } from './math'

describe('local MathJax SVG with standard TeX and AMS', () => {
  it('keeps every term of an inline expression in one canvas SVG', () => {
    const result = renderMath('x+y=z')
    const node = new DOMParser().parseFromString(result.svg, 'image/svg+xml')
    expect(node.querySelector('[data-latex="y"]')).not.toBeNull()
    expect(node.querySelector('[data-latex="z"]')).not.toBeNull()
  })
  it.each([
    '\\left(\\frac{1}{z}\\right)',
    '\\oint_\\gamma f(z)\\,\\mathrm{d}z',
    '\\begin{aligned}f(z)&=z^2\\\\g(z)&=1/z\\end{aligned}',
  ])('renders %s without external fonts', (tex) => {
    const result = renderMath(tex)
    expect(result.error).toBe('')
    expect(result.svg).toContain('<svg')
    expect(result.svg).toContain('<path')
    expect(result.svg).not.toContain('href="http')
    expect(result.width).toBeGreaterThan(0)
  })
  it('reports invalid TeX instead of silently saving an error graphic', () => {
    expect(renderMath('\\frac{').error).not.toBe('')
    expect(renderMath('\\unknownCommand{z}').error).not.toBe('')
  })
  it.each(['\\mathfrak{R}', '\\mathbb{C}'])('includes local font data for %s', (tex) => {
    expect(renderMath(tex).error).toBe('')
    expect(renderMath(tex).svg).toContain('<path')
  })
  it('rejects formula dimensions that cannot form a finite SVG', () => {
    expect(renderMath(`\\rule{${'9'.repeat(310)}em}{1em}`).error).not.toBe('')
  })
})
