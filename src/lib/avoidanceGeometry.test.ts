import { expect, it } from 'vitest'
import { pointOnArc } from './arc'
import { buildAvoidance, type AvoidanceInput } from './avoidanceGeometry'
import type { ComplexPoint } from './geometry'

const input: AvoidanceInput = {
  start: { re: -4, im: 0 },
  end: { re: 4, im: 0 },
  center: { re: 0, im: 2 },
  radius: 1,
  side: 'left',
  openingRatio: 0.5,
}

function geometry(overrides: Partial<AvoidanceInput> = {}) {
  const result = buildAvoidance({ ...input, ...overrides })
  if (!result.ok) throw new Error(result.error)
  return result.geometry
}

function expectPoint(actual: ComplexPoint, expected: ComplexPoint) {
  expect(actual.re).toBeCloseTo(expected.re, 10)
  expect(actual.im).toBeCloseTo(expected.im, 10)
}

it('keeps an off-line detour centered on the pole and uses the outer major arc', () => {
  const g = geometry()
  expectPoint(g.arc.center, { re: 0, im: 2 })
  expect(g.arc.radius).toBeCloseTo(1)
  expect(g.arc.sweep).toBeCloseTo((-5 * Math.PI) / 3)
  expectPoint(g.entry, { re: -0.5, im: 2 - Math.sqrt(3) / 2 })
  expectPoint(g.exit, { re: 0.5, im: 2 - Math.sqrt(3) / 2 })
  expectPoint(g.entryBase, { re: -0.5, im: 0 })
  expectPoint(g.exitBase, { re: 0.5, im: 0 })
  expectPoint(g.through, { re: 0, im: 3 })
  expectPoint(pointOnArc(g.arc, 0.5), { re: 0, im: 3 })
  expect(g.signedDistance).toBeCloseTo(2)
  expect(g.preferredOpeningWidth).toBeCloseTo(1)
  expect(g.actualOpeningWidth).toBeCloseTo(1)
  expect(g.footprint).toEqual([3, 5])
  expect(g.onLine).toBe(false)
})

it.each(['left', 'right'] as const)(
  'keeps a unit detour off-line on a long baseline with side %s',
  (side) => {
    const g = geometry({
      start: { re: -4e9, im: 0 },
      end: { re: 4e9, im: 0 },
      side,
    })
    expect(g.onLine).toBe(false)
    expect(g.actualOpeningWidth).toBeCloseTo(1, 12)
    expect(g.arc.sweep).toBeCloseTo((-5 * Math.PI) / 3, 12)
    expectPoint(pointOnArc(g.arc, 0.5), { re: 0, im: 3 })
    expect(g.arc.center).toEqual(input.center)
  },
)

it('keeps the major arc when the radius is tiny relative to the baseline', () => {
  const radius = 1e-160
  const g = geometry({
    start: { re: -4e9, im: 0 },
    end: { re: 4e9, im: 0 },
    center: { re: 0, im: 2 * radius },
    radius,
    side: 'right',
  })
  expect(g.onLine).toBe(false)
  expect(g.actualOpeningWidth / radius).toBeCloseTo(1, 12)
  expect(g.arc.sweep).toBeCloseTo((-5 * Math.PI) / 3, 12)
  expect(pointOnArc(g.arc, 0.5).im / radius).toBeCloseTo(3, 12)
})

it.each([1e-6, 1, 1e6])(
  'preserves long-baseline classification under rotation, translation, and scale %s',
  (scale) => {
    // Rotation with tangent (3/5, 4/5), followed by a local translation.
    const transform = ({ re, im }: ComplexPoint): ComplexPoint => ({
      re: (0.6 * re - 0.8 * im + 7) * scale,
      im: (0.8 * re + 0.6 * im - 5) * scale,
    })
    const center = transform(input.center)
    const g = geometry({
      start: transform({ re: -4e9, im: 0 }),
      end: transform({ re: 4e9, im: 0 }),
      center,
      radius: scale,
      side: 'right',
    })
    expect(g.onLine).toBe(false)
    expect(g.actualOpeningWidth / scale).toBeCloseTo(1, 10)
    expect(g.arc.sweep).toBeCloseTo((-5 * Math.PI) / 3, 10)
    const midpoint = pointOnArc(g.arc, 0.5)
    const expected = transform({ re: 0, im: 3 })
    expectPoint(
      { re: midpoint.re / scale, im: midpoint.im / scale },
      { re: expected.re / scale, im: expected.im / scale },
    )
    expect(g.arc.center).toEqual(center)
  },
)

it.each(['left', 'right'] as const)(
  'recognizes a truly collinear pole on a long oblique baseline, side %s',
  (side) => {
    const center = { re: 7, im: -5 }
    const g = geometry({
      start: { re: -2.4e9 + 7, im: -3.2e9 - 5 },
      end: { re: 2.4e9 + 7, im: 3.2e9 - 5 },
      center,
      side,
    })
    expect(g.onLine).toBe(true)
    expect(g.signedDistance).toBe(0)
    expect(g.actualOpeningWidth).toBeCloseTo(2, 12)
    const direction = side === 'left' ? 1 : -1
    expect(g.arc.sweep).toBeCloseTo(-direction * Math.PI, 12)
    expectPoint(pointOnArc(g.arc, 0.5), {
      re: 7 - direction * 0.8,
      im: -5 + direction * 0.6,
    })
    expect(g.arc.center).toEqual(center)
  },
)

it('recognizes exact collinearity away from the midpoint of a long oblique source', () => {
  const g = geometry({
    start: { re: -1.2e9, im: -1.6e9 },
    end: { re: 3.6e9, im: 4.8e9 },
    center: { re: 0, im: 0 },
    side: 'right',
  })
  expect(g.onLine).toBe(true)
  expect(g.signedDistance).toBe(0)
  expect(g.arc.sweep).toBeCloseTo(Math.PI, 12)
  expectPoint(pointOnArc(g.arc, 0.5), { re: 0.8, im: -0.6 })
})

it('resolves a small off-line distance without subtracting it away on an oblique source', () => {
  const center = { re: 0, im: 1e-8 }
  const g = geometry({
    start: { re: -1.2e9, im: -1.6e9 },
    end: { re: 3.6e9, im: 4.8e9 },
    center,
    side: 'right',
  })
  expect(g.onLine).toBe(false)
  expect(g.signedDistance).toBeCloseTo(6e-9, 15)
  expectPoint(g.through, { re: -0.8, im: 0.60000001 })
  expect(g.arc.center).toEqual(center)
})

it('rejects a detour whose world-space endpoints cannot be resolved', () => {
  const result = buildAvoidance({
    ...input,
    start: { re: 2 ** 55 - 4e9, im: 0 },
    end: { re: 2 ** 55 + 4e9, im: 0 },
    center: { re: 2 ** 55, im: 2 },
    side: 'right',
  })
  expect(result.ok).toBe(false)
  if (result.ok) throw new Error('Expected unresolvable detour to be rejected')
  expect(result.error).toMatch(/[\u4e00-\u9fff]/)
})

it.each([
  ['left', 1, -Math.PI],
  ['right', -1, Math.PI],
] as const)(
  'uses the %s on-line semicircle regardless of preferred width',
  (side, height, sweep) => {
    const g = geometry({ center: { re: 0, im: 0 }, side, openingRatio: 0.2 })
    expectPoint(g.entry, { re: -1, im: 0 })
    expectPoint(g.exit, { re: 1, im: 0 })
    expectPoint(g.entryBase, g.entry)
    expectPoint(g.exitBase, g.exit)
    expectPoint(pointOnArc(g.arc, 0.5), { re: 0, im: height })
    expect(g.arc.sweep).toBeCloseTo(sweep)
    expect(g.actualOpeningWidth).toBeCloseTo(2)
    expect(g.preferredOpeningWidth).toBeCloseTo(0.4)
    expect(g.onLine).toBe(true)
  },
)

it.each([-2, 2])('opens toward the original line at height %s regardless of side', (im) => {
  const g = geometry({ center: { re: 0, im }, side: 'right' })
  expectPoint(pointOnArc(g.arc, 0.5), { re: 0, im: im + Math.sign(im) })
  expect(Math.sign(g.arc.sweep)).toBe(-Math.sign(im))
})

it.each([-0.1, 0.1])('expands the opening at height %s without negative connectors', (im) => {
  const g = geometry({ center: { re: 0, im } })
  expect(g.actualOpeningWidth).toBeCloseTo(2 * Math.sqrt(0.99), 12)
  expectPoint(g.entry, { re: -Math.sqrt(0.99), im: 0 })
  expectPoint(g.exit, { re: Math.sqrt(0.99), im: 0 })
  expect(Math.sign(im) * (g.entry.im - g.entryBase.im)).toBeGreaterThanOrEqual(0)
  expect(Math.sign(im) * (g.exit.im - g.exitBase.im)).toBeGreaterThanOrEqual(0)
  expectPoint(g.arc.center, { re: 0, im })
})

it.each([-1, 1])('does not reverse a connector just above the minimum opening, side %s', (sign) => {
  const g = geometry({
    center: { re: 0, im: sign * 0.00002 },
    openingRatio: 0.9999999998,
  })
  expect(sign * (g.entry.im - g.entryBase.im)).toBeGreaterThanOrEqual(0)
  expect(sign * (g.exit.im - g.exitBase.im)).toBeGreaterThanOrEqual(0)
  expect(g.entry).toEqual(g.entryBase)
  expect(g.exit).toEqual(g.exitBase)
})

it('rotates all derived points and preserves local lengths under a quarter turn', () => {
  const rotate = ({ re, im }: ComplexPoint): ComplexPoint => ({ re: -im, im: re })
  const original = geometry()
  const rotated = geometry({
    start: rotate(input.start),
    end: rotate(input.end),
    center: rotate(input.center),
  })
  for (const key of ['entryBase', 'entry', 'exit', 'exitBase', 'through'] as const)
    expectPoint(rotated[key], rotate(original[key]))
  expectPoint(rotated.arc.center, rotate(input.center))
  expect(rotated.arc.sweep).toBeCloseTo(original.arc.sweep)
  expect(rotated.signedDistance).toBeCloseTo(2)
})

it.each([0, -0.1, 2])(
  'reverses traversal without changing the visible geometry at height %s',
  (im) => {
    const forward = geometry({ center: { re: 1, im } })
    const reverse = geometry({
      start: input.end,
      end: input.start,
      center: { re: 1, im },
      side: 'right',
    })
    expectPoint(reverse.entryBase, forward.exitBase)
    expectPoint(reverse.entry, forward.exit)
    expectPoint(reverse.exit, forward.entry)
    expectPoint(reverse.exitBase, forward.entryBase)
    expectPoint(reverse.through, forward.through)
    expect(reverse.arc.sweep).toBeCloseTo(-forward.arc.sweep)
    expect(reverse.signedDistance).toBeCloseTo(-im)
    expect(reverse.footprint).toEqual([2, 4])
  },
)

it.each([1e-6, 1e6])('preserves normalized geometry and validity at scale %s', (scale) => {
  const scaledPoint = ({ re, im }: ComplexPoint) => ({ re: re * scale, im: im * scale })
  for (const height of [0, 0.1, 2]) {
    const original = geometry({ center: { re: 0, im: height } })
    const scaled = geometry({
      start: scaledPoint(input.start),
      end: scaledPoint(input.end),
      center: { re: 0, im: height * scale },
      radius: scale,
    })
    for (const key of ['entryBase', 'entry', 'exit', 'exitBase', 'through'] as const)
      expectPoint({ re: scaled[key].re / scale, im: scaled[key].im / scale }, original[key])
    expectPoint(
      { re: scaled.arc.center.re / scale, im: scaled.arc.center.im / scale },
      { re: 0, im: height },
    )
    expect(scaled.arc.radius / scale).toBeCloseTo(1, 10)
    expect(scaled.arc.sweep).toBeCloseTo(original.arc.sweep, 10)
    expect(scaled.actualOpeningWidth / scale).toBeCloseTo(original.actualOpeningWidth, 10)
    expect(scaled.signedDistance / scale).toBeCloseTo(height, 10)
    expect(scaled.footprint.map((value) => value / scale)).toEqual([3, 5])
    expect(scaled.onLine).toBe(original.onLine)
    expect(
      buildAvoidance({
        ...input,
        start: scaledPoint(input.start),
        end: scaledPoint(input.end),
        radius: 4 * scale,
        center: { re: 0, im: 2 * scale },
      }).ok,
    ).toBe(false)
  }
})

it.each([
  ['projection before start', { center: { re: -5, im: 2 } }],
  ['projection after end', { center: { re: 5, im: 2 } }],
  ['projection at endpoint', { center: { re: -4, im: 2 } }],
  ['radius touches start', { center: { re: -3, im: 2 } }],
  ['radius touches end', { center: { re: 3, im: 2 } }],
  ['radius crosses endpoint', { radius: 5 }],
  ['zero radius', { radius: 0 }],
  ['negative radius', { radius: -1 }],
  ['zero opening ratio', { openingRatio: 0 }],
  ['oversized opening ratio', { openingRatio: 1.1 }],
  ['nonfinite ratio', { openingRatio: NaN }],
  ['nonfinite radius', { radius: Infinity }],
  ['nonfinite center', { center: { re: NaN, im: 0 } }],
  ['nonfinite endpoint', { end: { re: 4, im: Infinity } }],
  ['zero source length', { end: input.start }],
  ['unrenderable coordinates', { center: { re: 0, im: 1e307 } }],
  ['nearly full unrenderable circle', { openingRatio: 1e-12 }],
] satisfies [string, Partial<AvoidanceInput>][])(
  'rejects %s with a Chinese error',
  (_, overrides) => {
    const result = buildAvoidance({ ...input, ...overrides })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('Expected invalid geometry')
    expect(result.error).toMatch(/[\u4e00-\u9fff]/)
  },
)

it('accepts a diameter opening for an off-line pole', () => {
  const g = geometry({ openingRatio: 1 })
  expectPoint(g.entry, { re: -1, im: 2 })
  expectPoint(g.exit, { re: 1, im: 2 })
  expect(g.arc.sweep).toBeCloseTo(-Math.PI)
})

it.each([1e-6, 1, 1e6])('does not snap a nearly on-line pole at scale %s', (scale) => {
  const center = { re: 0, im: 1e-10 * scale }
  const g = geometry({
    start: { re: -4 * scale, im: 0 },
    end: { re: 4 * scale, im: 0 },
    center,
    radius: scale,
  })
  expect(g.onLine).toBe(true)
  expect(g.arc.center).toEqual(center)
  expect(g.entry.im).toBe(center.im)
  expect(g.entryBase.im).toBe(0)
  expect(g.signedDistance / scale).toBeCloseTo(1e-10, 15)
})

it.each([1e-6, 1, 1e6])(
  'conservatively rejects an almost touching footprint at scale %s',
  (scale) => {
    const result = buildAvoidance({
      ...input,
      start: { re: -4 * scale, im: 0 },
      end: { re: 4 * scale, im: 0 },
      center: { re: (3 - 1e-10) * scale, im: 2 * scale },
      radius: scale,
    })
    expect(result.ok).toBe(false)
  },
)
