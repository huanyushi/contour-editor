import { describe, expect, it } from 'vitest'
import { snapToInteger } from './snap'

describe('screen-distance integer snapping', () => {
  it('snaps near positive and negative integer intersections', () => {
    expect(snapToInteger({ re: 1.1, im: -1.9 }, 40, true)).toEqual({ re: 1, im: -2 })
  })
  it('does not snap a distant point or only one axis', () => {
    expect(snapToInteger({ re: 1.01, im: 1.4 }, 40, true)).toEqual({ re: 1.01, im: 1.4 })
  })
  it('uses screen scale and can be bypassed without changing input', () => {
    const point = { re: -0.2, im: 2.2 }
    expect(snapToInteger(point, 20, true)).toEqual({ re: 0, im: 2 })
    expect(snapToInteger(point, 80, true)).toEqual(point)
    expect(snapToInteger(point, 20, false)).toEqual(point)
  })
})
