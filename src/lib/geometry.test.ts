import { describe, expect, it } from 'vitest'
import { fromSvg, isValidPoint, toSvg } from './geometry'

describe('complex plane coordinates', () => {
  it.each([NaN, Infinity, Number.MAX_VALUE])('rejects unsafe coordinate %s', (re) => {
    expect(isValidPoint({ re, im: 0 })).toBe(false)
    expect(isValidPoint({ re: 0, im: re })).toBe(false)
  })
  it('accepts coordinates outside the current view without clipping', () => {
    expect(isValidPoint({ re: -1000, im: 1e20 })).toBe(true)
  })
  it('renders positive imaginary coordinates upward', () => {
    expect(toSvg({ re: 2, im: 3 })).toEqual({ x: 480, y: 180 })
    expect(fromSvg({ x: 320, y: 380 })).toEqual({ re: -2, im: -2 })
  })
  it('preserves fractional coordinates in a round trip', () => {
    const point = { re: -1.25, im: 2.75 }
    expect(fromSvg(toSvg(point))).toEqual(point)
  })
})
