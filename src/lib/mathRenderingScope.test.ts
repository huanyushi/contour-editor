import { expect, it, vi } from 'vitest'
import { createMathRenderingScope } from './mathRenderingScope'
import type { MathRendering } from './math'

it('retains only the current distinct strings, including errors, without eager rendering', () => {
  const renderer = vi.fn((tex: string): MathRendering => ({
    svg: tex,
    width: 12,
    height: 8,
    error: tex === 'bad' ? 'invalid' : '',
  }))
  const scope = createMathRenderingScope(renderer)
  const texts = Array.from({ length: 400 }, (_, i) => `z_{${i}}`)
  texts[0] = 'bad'
  scope.retain(texts)
  expect(renderer).not.toHaveBeenCalled()
  for (let scan = 0; scan < 2; scan++)
    for (const text of texts) expect(scope.render(text).svg).toBe(text)
  expect(renderer).toHaveBeenCalledTimes(400)
  scope.retain([...texts.slice(1), 'new'])
  expect(scope.render('new').svg).toBe('new')
  expect(renderer).toHaveBeenCalledTimes(401)
  scope.render('outside')
  scope.render('outside')
  expect(renderer).toHaveBeenCalledTimes(403)
  scope.retain([])
  scope.retain(['new'])
  scope.render('new')
  expect(renderer).toHaveBeenCalledTimes(404)
})

it('does not share retained results or eviction between scopes', () => {
  const renderer = vi.fn(() => ({ svg: '', width: 1, height: 2, error: '' }))
  const a = createMathRenderingScope(renderer),
    b = createMathRenderingScope(renderer)
  a.retain(['a'])
  b.retain(['a'])
  a.render('a')
  b.render('a')
  a.retain([])
  b.render('a')
  expect(renderer).toHaveBeenCalledTimes(2)
})
