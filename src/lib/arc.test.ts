import { describe, expect, it } from 'vitest'
import { arcThrough, pointOnArc, tangentOnArc } from './arc'

describe('three-point circular arcs', () => {
  it.each([0, 1e6])(
    'uses an endpoint-order invariant degeneracy decision at offset %s',
    (offset) => {
      const start = { re: offset, im: 0 }
      const end = { re: offset + 1, im: 0 }
      const through = { re: offset + 0.01, im: 5e-11 }
      expect(arcThrough(start, end, through).ok).toBe(false)
      expect(arcThrough(end, start, through).ok).toBe(false)
    },
  )
  it('keeps a shallow but accepted arc renderable and geometrically identical after reversal', () => {
    const start = { re: 0, im: 0 }
    const end = { re: 1, im: 0 }
    const through = { re: 0.01, im: 1e-8 }
    const forward = arcThrough(start, end, through)
    const backward = arcThrough(end, start, through)
    if (!forward.ok || !backward.ok) throw new Error('A well-conditioned shallow arc was rejected')
    expect(backward.arc.radius).toBeCloseTo(forward.arc.radius, 8)
    expect(backward.arc.center.re).toBeCloseTo(forward.arc.center.re, 8)
    expect(backward.arc.center.im).toBeCloseTo(forward.arc.center.im, 8)
    expect(backward.arc.sweep).toBeCloseTo(-forward.arc.sweep, 12)
    expect(pointOnArc(backward.arc, 0.5).re).toBeCloseTo(pointOnArc(forward.arc, 0.5).re)
  })
  it('constructs the counterclockwise upper semicircle and its true tangent', () => {
    const result = arcThrough({ re: 2, im: 0 }, { re: -2, im: 0 }, { re: 0, im: 2 })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error)
    expect(result.arc.center.re).toBeCloseTo(0)
    expect(result.arc.center.im).toBeCloseTo(0)
    expect(result.arc.radius).toBeCloseTo(2)
    expect(result.arc.sweep).toBeCloseTo(Math.PI)
    const midpoint = pointOnArc(result.arc, 0.5)
    expect(midpoint.re).toBeCloseTo(0)
    expect(midpoint.im).toBeCloseTo(2)
    const tangent = tangentOnArc(result.arc, 0.5)
    expect(tangent.re).toBeCloseTo(-1)
    expect(tangent.im).toBeCloseTo(0)
  })

  it('reverses the same circle without switching to the complementary arc', () => {
    const result = arcThrough({ re: -2, im: 0 }, { re: 2, im: 0 }, { re: 0, im: 2 })
    if (!result.ok) throw new Error(result.error)
    expect(result.arc.sweep).toBeCloseTo(-Math.PI)
    expect(pointOnArc(result.arc, 0.5).im).toBeCloseTo(2)
    expect(tangentOnArc(result.arc, 0.5).re).toBeCloseTo(1)
  })

  it('selects a major arc when the through point lies on the long route', () => {
    const result = arcThrough({ re: 1, im: 0 }, { re: 0, im: -1 }, { re: -1, im: 0 })
    if (!result.ok) throw new Error(result.error)
    expect(result.arc.sweep).toBeCloseTo((3 * Math.PI) / 2)
    expect(pointOnArc(result.arc, 2 / 3).re).toBeCloseTo(-1)
    expect(pointOnArc(result.arc, 1).im).toBeCloseTo(-1)
  })

  it('constructs a lower semicircle with negative sweep', () => {
    const result = arcThrough({ re: 2, im: 0 }, { re: -2, im: 0 }, { re: 0, im: -2 })
    if (!result.ok) throw new Error(result.error)
    expect(result.arc.sweep).toBeCloseTo(-Math.PI)
    expect(pointOnArc(result.arc, 0.5).im).toBeCloseTo(-2)
  })

  it('solves a translated quarter circle and its non-axis-aligned tangent', () => {
    const result = arcThrough(
      { re: 5, im: -1 },
      { re: 3, im: 1 },
      { re: 3 + Math.SQRT2, im: -1 + Math.SQRT2 },
    )
    if (!result.ok) throw new Error(result.error)
    expect(result.arc.center.re).toBeCloseTo(3)
    expect(result.arc.center.im).toBeCloseTo(-1)
    expect(result.arc.radius).toBeCloseTo(2)
    expect(result.arc.sweep).toBeCloseTo(Math.PI / 2)
    expect(tangentOnArc(result.arc, 0.5).re).toBeCloseTo(-Math.SQRT1_2)
    expect(tangentOnArc(result.arc, 0.5).im).toBeCloseTo(Math.SQRT1_2)
  })

  it.each([
    [
      { re: 0, im: 0 },
      { re: 2, im: 0 },
      { re: 1, im: 0 },
    ],
    [
      { re: 0, im: 0 },
      { re: 0, im: 0 },
      { re: 1, im: 1 },
    ],
    [
      { re: 0, im: 0 },
      { re: 2, im: 0 },
      { re: 0, im: 0 },
    ],
    [
      { re: 0, im: 0 },
      { re: 2, im: 0 },
      { re: 1, im: 1e-12 },
    ],
    [
      { re: Infinity, im: 0 },
      { re: 2, im: 0 },
      { re: 1, im: 1 },
    ],
  ])('rejects collinear, coincident and unsafe points: %j', (start, end, through) => {
    expect(arcThrough(start, end, through).ok).toBe(false)
  })

  it.each([1e-6, 1e6])('is scale invariant at scale %s', (scale) => {
    const result = arcThrough(
      { re: 2 * scale, im: 0 },
      { re: -2 * scale, im: 0 },
      { re: 0, im: 2 * scale },
    )
    if (!result.ok) throw new Error(result.error)
    expect(result.arc.radius / scale).toBeCloseTo(2)
    expect(result.arc.sweep).toBeCloseTo(Math.PI)
  })
})
