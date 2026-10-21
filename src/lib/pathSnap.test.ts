import { describe, expect, it } from 'vitest'
import { nearestPath, nearestPathPoint, type PathGeometry } from './pathSnap'

const metric = { a: 40, b: 0, c: 0, d: -40 }
const line: PathGeometry = {
  kind: 'line',
  start: { re: 0, im: 0 },
  end: { re: 4, im: 2 },
}
const upper: PathGeometry = {
  kind: 'arc',
  start: { re: 1, im: 0 },
  end: { re: -1, im: 0 },
  through: { re: 0, im: 1 },
}

describe('nearest source path geometry in the CSS screen metric', () => {
  it('projects onto a rotated bounded line without integer rounding', () => {
    const hit = nearestPathPoint(line, { re: 1, im: 1 }, metric)!
    expect(hit.point.re).toBeCloseTo(1.2, 12)
    expect(hit.point.im).toBeCloseTo(0.6, 12)
    expect(hit.t).toBeCloseTo(0.3, 12)
    expect(nearestPathPoint(line, { re: -2, im: -1 }, metric)?.point).toEqual(line.start)
    expect(nearestPathPoint(line, { re: 8, im: 4 }, metric)?.point).toEqual(line.end)
  })

  it('uses anisotropic CSS scaling and shear rather than mathematical distance', () => {
    const diagonal: PathGeometry = { ...line, end: { re: 2, im: 2 } }
    const hit = nearestPathPoint(diagonal, { re: 1, im: 0 }, { a: 80, b: 0, c: 0, d: 40 })!
    expect(hit.point.re).toBeCloseTo(0.8, 12)
    expect(hit.point.im).toBeCloseTo(0.8, 12)
    const sheared = nearestPathPoint(diagonal, { re: 1, im: 0 }, { a: 2, b: 0, c: 1, d: 1 })!
    expect(sheared.point.re).toBeCloseTo(0.6, 12)
  })

  it('applies the 8 CSS pixel threshold before rounding and chooses the closest path', () => {
    const horizontal: PathGeometry = { ...line, end: { re: 4, im: 0 } }
    expect(nearestPath([horizontal], { re: 1.02, im: 0.2 }, metric, 8)?.point).toEqual({
      re: 1.02,
      im: 0,
    })
    expect(nearestPath([horizontal], { re: 1.02, im: 0.201 }, metric, 8)).toBeNull()
    expect(
      nearestPath([horizontal], { re: 1.02, im: 0.1 }, { ...metric, d: -80 }, 8),
    ).not.toBeNull()
    expect(nearestPath([horizontal], { re: 1.02, im: 0.101 }, { ...metric, d: -80 }, 8)).toBeNull()
    expect(nearestPath([line, horizontal], { re: 1, im: 0.01 }, metric)?.path).toBe(horizontal)
  })

  it('projects onto a true circle, not its chord, with exact bounded endpoints', () => {
    const hit = nearestPathPoint(upper, { re: 0.9, im: 0.9 }, metric)!
    expect(hit.point.re).toBeCloseTo(Math.SQRT1_2, 12)
    expect(hit.point.im).toBeCloseTo(Math.SQRT1_2, 12)
    expect(hit.t).toBeCloseTo(0.25, 12)
    expect(nearestPathPoint(upper, { re: 2, im: -1 }, metric)?.point).toEqual(upper.start)
  })

  it('finds the true ellipse nearest parameter under anisotropic scaling', () => {
    // On x²+y²=1 at (.6,.8), the metric normal is proportional to (.6/4,.8).
    // Thus (.75,1.6) projects to (.6,.8) for screen scales (2,1).
    const hit = nearestPathPoint(upper, { re: 0.75, im: 1.6 }, { a: 2, b: 0, c: 0, d: 1 })!
    expect(hit.point.re).toBeCloseTo(0.6, 11)
    expect(hit.point.im).toBeCloseTo(0.8, 11)
    expect(hit.distance).toBeCloseTo(Math.hypot(0.3, 0.8), 11)
    // For M=[[2,1],[0,1]], (MᵀM)⁻¹(.6,.8)=(-.1,.5).
    const sheared = nearestPathPoint(upper, { re: 0.5, im: 1.3 }, { a: 2, b: 0, c: 1, d: 1 })!
    expect(sheared.point.re).toBeCloseTo(0.6, 11)
    expect(sheared.point.im).toBeCloseTo(0.8, 11)
  })

  it('includes major-arc interiors, reversed sweeps, center queries and all ellipse minima', () => {
    const major: PathGeometry = { ...upper, end: { re: 0, im: -1 } }
    expect(nearestPathPoint(major, { re: -2, im: 0 }, metric)?.point.re).toBeCloseTo(-1, 12)
    const reversed: PathGeometry = { ...major, start: major.end, end: major.start }
    const hit = nearestPathPoint(reversed, { re: -2, im: 0 }, metric)!
    expect(hit.point.re).toBeCloseTo(-1, 12)
    expect(hit.point.im).toBeCloseTo(0, 12)
    expect(nearestPathPoint(major, { re: 3, im: -2 }, metric)?.point).toEqual(major.start)
    const center = nearestPathPoint(upper, { re: 0, im: 0 }, { a: 5, b: 0, c: 0, d: 1 })!
    expect(center.point.re).toBeCloseTo(0, 12)
    expect(center.point.im).toBeCloseTo(1, 12)
    expect(nearestPathPoint(upper, { re: 0, im: 0 }, metric)?.distance).toBeCloseTo(40, 12)
  })

  it('rejects degenerate source geometry without snapping to a fake chord', () => {
    expect(nearestPathPoint({ ...line, end: line.start }, { re: 1, im: 0 }, metric)).toBeNull()
    expect(
      nearestPathPoint({ ...upper, through: { re: 0, im: 0 } }, { re: 0, im: 0 }, metric),
    ).toBeNull()
    expect(nearestPath([], { re: 0, im: 0 }, metric)).toBeNull()
  })
})
