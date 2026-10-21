import { Utils } from '@flatten-js/core'
import { expect, it } from 'vitest'
import type { ComplexPoint } from './geometry'
import {
  intersectEdges,
  type GeometricEdge,
  type IntersectionResult,
} from './geometryIntersections'

const point = (re: number, im: number): ComplexPoint => ({ re, im })
const line = (start: ComplexPoint, end: ComplexPoint): GeometricEdge => ({
  kind: 'line',
  start,
  end,
})
const arc = (start: ComplexPoint, end: ComplexPoint, through: ComplexPoint): GeometricEdge => ({
  kind: 'arc',
  start,
  end,
  through,
})
const upper = arc(point(-1, 0), point(1, 0), point(0, 1))
const lower = arc(point(-1, 0), point(1, 0), point(0, -1))

it.each([1e306, 3e306])('fits huge finite arcs before common-frame conversion at %s', (scale) => {
  const huge = transformEdge(upper, (p) => point(p.re * scale, p.im * scale))
  for (const reversed of [false, true]) {
    const edge = reversed ? { ...huge, start: huge.end, end: huge.start } : huge
    for (const swap of [false, true]) {
      const probe = line(point(0, 0), point(0, 1.25 * scale))
      const result = intersectEdges(swap ? probe : edge, swap ? edge : probe)
      expect(result.kind).toBe('points')
      if (result.kind !== 'points') throw new Error('Expected the upper cardinal crossing')
      expect(result.points).toHaveLength(1)
      expect(result.points[0].re / scale).toBeCloseTo(0, 12)
      expect(result.points[0].im / scale).toBeCloseTo(1, 12)
      expect(
        intersectEdges(
          edge,
          transformEdge(lower, (p) => point(p.re * scale, p.im * scale)),
        ).kind,
      ).toBe('points')
      expect(intersectEdges(edge, edge)).toEqual({ kind: 'overlap' })
      expect(intersectEdges(edge, line(point(0, -scale), point(0, -scale / 2)))).toEqual({
        kind: 'none',
      })
    }
  }
})

it('refuses a common frame that collapses a finite arc instead of guessing no collision', () => {
  const huge = transformEdge(upper, (p) => point(p.re * 3e306, p.im * 3e306))
  expect(() => intersectEdges(upper, huge)).toThrow(/数值/)
  expect(() => intersectEdges(huge, upper)).toThrow(/数值/)
})

const cases: {
  name: string
  a: GeometricEdge
  b: GeometricEdge
  expected: IntersectionResult
}[] = [
  {
    name: 'does not count the unused half of a supporting circle as an arc intersection',
    a: upper,
    b: line(point(0, -2), point(0, -0.5)),
    expected: { kind: 'none' },
  },
  {
    name: 'returns the crossing of two finite lines',
    a: line(point(-1, -1), point(1, 1)),
    b: line(point(-1, 1), point(1, -1)),
    expected: { kind: 'points', points: [point(0, 0)] },
  },
  {
    name: 'does not mistake a short tilted crossing for a shared supporting line',
    a: line(point(-1, 0), point(1, 0)),
    b: line(point(-0.001, -1e-9), point(0.001, 1e-9)),
    expected: { kind: 'points', points: [point(0, 0)] },
  },
  {
    name: 'excludes intersections beyond a line endpoint',
    a: line(point(-1, 0), point(1, 0)),
    b: line(point(2, -1), point(2, 1)),
    expected: { kind: 'none' },
  },
  {
    name: 'returns a tangent arc endpoint only once',
    a: upper,
    b: line(point(1, 0), point(1, 2)),
    expected: { kind: 'points', points: [point(1, 0)] },
  },
  {
    name: 'returns an interior tangency only once',
    a: upper,
    b: line(point(-2, 1), point(2, 1)),
    expected: { kind: 'points', points: [point(0, 1)] },
  },
  {
    name: 'returns both intersections on a major arc',
    a: arc(point(1, 0), point(0, 1), point(-1, 0)),
    b: line(point(-2, 0), point(2, 0)),
    expected: { kind: 'points', points: [point(-1, 0), point(1, 0)] },
  },
  {
    name: 'classifies a positive length collinear interval as overlap',
    a: line(point(-2, 0), point(1, 0)),
    b: line(point(0, 0), point(2, 0)),
    expected: { kind: 'overlap' },
  },
  {
    name: 'keeps a collinear endpoint contact distinct from overlap',
    a: line(point(-1, 0), point(0, 0)),
    b: line(point(0, 0), point(1, 0)),
    expected: { kind: 'points', points: [point(0, 0)] },
  },
  {
    name: 'rejects separated collinear intervals',
    a: line(point(-2, 0), point(-1, 0)),
    b: line(point(0, 0), point(1, 0)),
    expected: { kind: 'none' },
  },
  {
    name: 'does not disguise overlapping same-circle major arcs as endpoint intersections',
    a: arc(point(1, 0), point(0, 1), point(-1, 0)),
    b: arc(point(-1, 0), point(0, -1), point(1, 0)),
    expected: { kind: 'overlap' },
  },
  {
    name: 'detects an identical arc as overlap',
    a: upper,
    b: upper,
    expected: { kind: 'overlap' },
  },
  {
    name: 'returns two endpoint contacts for complementary semicircles without overlap',
    a: upper,
    b: lower,
    expected: { kind: 'points', points: [point(-1, 0), point(1, 0)] },
  },
  {
    name: 'keeps same-circle arcs meeting only at one endpoint as a contact',
    a: arc(point(1, 0), point(0, 1), point(0.6, 0.8)),
    b: arc(point(0, 1), point(-1, 0), point(-0.6, 0.8)),
    expected: { kind: 'points', points: [point(0, 1)] },
  },
  {
    name: 'rejects disjoint arcs on the same circle',
    a: arc(point(1, 0), point(0, 1), point(0.6, 0.8)),
    b: arc(point(-1, 0), point(0, -1), point(-0.6, -0.8)),
    expected: { kind: 'none' },
  },
  {
    name: 'returns true arc-arc tangency once',
    a: upper,
    b: arc(point(1, 0), point(3, 0), point(2, 1)),
    expected: { kind: 'points', points: [point(1, 0)] },
  },
  {
    name: 'returns internal arc tangency regardless of which radius comes first',
    a: upper,
    b: arc(point(-1, 0), point(3, 0), point(1, 2)),
    expected: { kind: 'points', points: [point(-1, 0)] },
  },
  {
    name: 'filters arc-arc supporting-circle intersections outside the swept arcs',
    a: lower,
    b: arc(point(-1, 1), point(1, 1), point(0, 2)),
    expected: { kind: 'none' },
  },
  {
    name: 'returns two actual arc-arc crossings',
    a: upper,
    b: arc(point(-1, 1), point(1, 1), point(0, 0)),
    expected: {
      kind: 'points',
      points: [point(-Math.sqrt(3) / 2, 0.5), point(Math.sqrt(3) / 2, 0.5)],
    },
  },
  {
    name: 'does not merge nearby concentric arcs within the library default tolerance',
    a: upper,
    b: arc(point(-1 - 1e-8, 0), point(1 + 1e-8, 0), point(0, 1 + 1e-8)),
    expected: { kind: 'none' },
  },
  {
    name: 'does not merge nearby translated circles into a common arc',
    a: upper,
    b: arc(point(-1, 1e-8), point(1, 1e-8), point(0, -1 + 1e-8)),
    expected: { kind: 'points', points: [point(-1, 5e-9), point(1, 5e-9)] },
  },
  {
    name: 'rejects a line just outside arc tangency despite the library default tolerance',
    a: upper,
    b: line(point(-2, 1 + 1e-8), point(2, 1 + 1e-8)),
    expected: { kind: 'none' },
  },
  {
    name: 'keeps nearby parallel lines separate',
    a: line(point(-1, 0), point(1, 0)),
    b: line(point(-1, 1e-8), point(1, 1e-8)),
    expected: { kind: 'none' },
  },
  {
    name: 'keeps a short positive collinear overlap distinct from endpoint contact',
    a: line(point(-1, 0), point(1e-8, 0)),
    b: line(point(0, 0), point(1, 0)),
    expected: { kind: 'overlap' },
  },
  {
    name: 'keeps a small collinear gap distinct from endpoint contact',
    a: line(point(-1, 0), point(0, 0)),
    b: line(point(1e-8, 0), point(1, 0)),
    expected: { kind: 'none' },
  },
  {
    name: 'detects a short positive common arc rather than a single contact',
    a: arc(point(1, 0), point(0, 1), point(0.6, 0.8)),
    b: arc(point(1e-8, 1), point(-1, 0), point(-0.6, 0.8)),
    expected: { kind: 'overlap' },
  },
  {
    name: 'does not bridge a short gap between arcs on one circle',
    a: arc(point(1, 0), point(0, 1), point(0.6, 0.8)),
    b: arc(point(-1e-8, 1), point(-1, 0), point(-0.6, 0.8)),
    expected: { kind: 'none' },
  },
  {
    name: 'does not lose intersections near the end of an almost-full arc',
    a: arc(point(1, 0), point(Math.cos(1e-7), -Math.sin(1e-7)), point(-1, 0)),
    b: line(point(0, -2e-7), point(2, -2e-7)),
    expected: { kind: 'points', points: [point(Math.sqrt(1 - 4e-14), -2e-7)] },
  },
  {
    name: 'does not fill the unused gap of an almost-full arc',
    a: arc(point(1, 0), point(Math.cos(1e-7), -Math.sin(1e-7)), point(-1, 0)),
    b: line(point(0, -5e-8), point(2, -5e-8)),
    expected: { kind: 'none' },
  },
]

function transformEdge(
  edge: GeometricEdge,
  transform: (p: ComplexPoint) => ComplexPoint,
): GeometricEdge {
  return {
    ...edge,
    start: transform(edge.start),
    end: transform(edge.end),
    ...(edge.kind === 'arc' ? { through: transform(edge.through) } : {}),
  }
}

function expectResult(actual: IntersectionResult, expected: IntersectionResult, context = '') {
  expect(actual.kind, context).toBe(expected.kind)
  if (actual.kind !== 'points' || expected.kind !== 'points') return
  expect(actual.points, context).toHaveLength(expected.points.length)
  for (const wanted of expected.points) {
    expect(actual.points.some((p) => Math.hypot(p.re - wanted.re, p.im - wanted.im) < 1e-8)).toBe(
      true,
    )
  }
}

it.each(cases)('$name', ({ a, b, expected }) => {
  for (const reverseA of [false, true]) {
    for (const reverseB of [false, true]) {
      const first = reverseA ? { ...a, start: a.end, end: a.start } : a
      const second = reverseB ? { ...b, start: b.end, end: b.start } : b
      expectResult(intersectEdges(first, second), expected, `reversed: ${reverseA}, ${reverseB}`)
      expectResult(
        intersectEdges(second, first),
        expected,
        `swapped/reversed: ${reverseA}, ${reverseB}`,
      )
    }
  }
})

it.each([
  { scale: 1e-6, offset: 0 },
  { scale: 1e6, offset: 0 },
  { scale: 1, offset: 1e6 },
])('preserves geometry at scale $scale and translation $offset', ({ scale, offset }) => {
  const transform = (p: ComplexPoint): ComplexPoint => ({
    re: p.re * scale + offset,
    im: p.im * scale - offset,
  })
  for (const { a, b, expected } of cases) {
    const actual = intersectEdges(transformEdge(a, transform), transformEdge(b, transform))
    if (actual.kind === 'points') {
      actual.points = actual.points.map((p) => ({
        re: (p.re - offset) / scale,
        im: (p.im + offset) / scale,
      }))
    }
    expectResult(actual, expected)
  }
})

it('preserves the third-party tolerance and caller-owned geometry on every result path', () => {
  const tolerance = Utils.getTolerance()
  const before = structuredClone(cases)
  for (const { a, b } of cases) {
    intersectEdges(a, b)
    expect(Utils.getTolerance()).toBe(tolerance)
  }
  expect(cases).toEqual(before)
})

it('does not extend nearly parallel segments past their endpoints', () => {
  // This resolvable local 1e-15 offset would be lost after a world translation of 1e6.
  const a = line(point(-1, 0), point(0, 0))
  const b = line(point(-1, -1e-8 - 1e-15), point(1, 1e-8 - 1e-15))
  expect(intersectEdges(a, b)).toEqual({ kind: 'none' })
  expect(intersectEdges(b, a)).toEqual({ kind: 'none' })
})

it.each(
  [false, true].flatMap((reverseArc) =>
    [false, true].flatMap((reverseProbe) =>
      [false, true].map((swap) => ({ reverseArc, reverseProbe, swap })),
    ),
  ),
)(
  'finds the ill-conditioned major-arc crossing, reversed $reverseArc/$reverseProbe, swapped $swap',
  ({ reverseArc, reverseProbe, swap }) => {
    const x = 1192934961.3821044,
      y = 2879999761.907751
    const a = arc(point(1.3, 1.4), point(0.1, 0.2), point(2.5, 2.600000001))
    const b = arc(point(x - 256, y), point(x + 256, y), point(x, y + 256))
    const first = reverseArc ? { ...a, start: a.end, end: a.start } : a
    const second = reverseProbe ? { ...b, start: b.end, end: b.start } : b
    const tolerance = Utils.getTolerance()
    const result = intersectEdges(swap ? second : first, swap ? first : second)
    expect(result.kind).toBe('points')
    if (result.kind !== 'points') throw new Error('Expected a genuine arc crossing')
    expect(result.points).toHaveLength(1)
    // Independently determined intersection near the huge circle's rightmost point.
    expect(
      Math.hypot(result.points[0].re - 1192934961.3820963, result.points[0].im - 2880000017.907751),
    ).toBeLessThan(1e-3)
    expect(
      Math.abs(Math.hypot(result.points[0].re - x, result.points[0].im - y) - 256),
    ).toBeLessThan(1e-4)
    expect(Utils.getTolerance()).toBe(tolerance)
  },
)

it('keeps disjoint supports and unused finite arcs separate at extreme radius ratios', () => {
  const x = 1192934961.3821044,
    y = 2879999761.907751
  const ordinary = arc(point(1.3, 1.4), point(0.1, 0.2), point(2.5, 2.600000001))
  const probes = [
    arc(point(x + 768, y), point(x + 1280, y), point(x + 1024, y + 256)),
    // The same crossing supporting circle, but only its right-hand finite arc.
    arc(point(x + 153.6, y - 204.8), point(x + 153.6, y + 204.8), point(x + 256, y)),
  ]
  for (const probe of probes) {
    expect(intersectEdges(ordinary, probe)).toEqual({ kind: 'none' })
    expect(intersectEdges(probe, ordinary)).toEqual({ kind: 'none' })
  }
})

it.each([-1, 1])('preserves high-radius-ratio tangency from side %s', (side) => {
  // Integer Pythagorean fixture: the ordinary support is exactly C(0,0), r=100000001.
  const x = 100000001,
    y = 0
  const ordinary = arc(point(99999999, -20000), point(99999999, 20000), point(x, y))
  const center = x + side * 256
  const probe = arc(point(center - 256, y), point(center + 256, y), point(center, y + 256))
  for (const [a, b] of [
    [ordinary, probe],
    [probe, ordinary],
  ]) {
    const result = intersectEdges(a, b)
    expect(result.kind).toBe('points')
    if (result.kind !== 'points') throw new Error('Expected an actual tangent contact')
    expect(result.points).toHaveLength(1)
    expect(Math.hypot(result.points[0].re - x, result.points[0].im - y)).toBeLessThan(1e-3)
  }
})

it('preserves the radical axis of nearly concentric equal-radius arcs', () => {
  const delta = 2 ** -28
  const a = arc(point(-1, 0), point(1, 0), point(0, 1))
  const b = arc(point(-1 + delta, 0), point(1 + delta, 0), point(delta, 1))
  for (const [first, second] of [
    [a, b],
    [b, a],
  ]) {
    const result = intersectEdges(first, second)
    expect(result.kind).toBe('points')
    if (result.kind !== 'points') throw new Error('Expected one upper intersection')
    expect(result.points).toHaveLength(1)
    expect(Math.abs(result.points[0].re - delta / 2)).toBeLessThan(1e-12)
    expect(Math.abs(result.points[0].im - 1)).toBeLessThan(1e-12)
  }
})

it.each([2 ** -20, 1, 2 ** 20])(
  'preserves shallow same-circle overlap with exact power-of-two scale %s',
  (scale) => {
    // All six coordinates lie exactly on C(0, 0), r = 100000001.
    // The shallow right-hand arc shares its upper half with the upper semicircle.
    const a = transformEdge(
      arc(point(99999999, -20000), point(99999999, 20000), point(100000001, 0)),
      (p) => point(p.re * scale, p.im * scale),
    )
    const b = transformEdge(
      arc(point(-100000001, 0), point(100000001, 0), point(0, 100000001)),
      (p) => point(p.re * scale, p.im * scale),
    )
    for (const reverseA of [false, true]) {
      for (const reverseB of [false, true]) {
        const first = reverseA ? { ...a, start: a.end, end: a.start } : a
        const second = reverseB ? { ...b, start: b.end, end: b.start } : b
        expectResult(
          intersectEdges(first, second),
          { kind: 'overlap' },
          `reversed: ${reverseA}, ${reverseB}`,
        )
        expectResult(
          intersectEdges(second, first),
          { kind: 'overlap' },
          `swapped/reversed: ${reverseA}, ${reverseB}`,
        )
      }
    }
  },
)

it.each(
  [0, 1e6].flatMap((offset) =>
    [false, true].flatMap((reverseArc) =>
      [false, true].flatMap((reverseLine) =>
        [false, true].map((swap) => ({ offset, reverseArc, reverseLine, swap })),
      ),
    ),
  ),
)(
  'keeps an exact arc-line endpoint at origin $offset, reversed $reverseArc/$reverseLine, swapped $swap',
  ({ offset, reverseArc, reverseLine, swap }) => {
    const a = arc(
      point(offset, offset),
      point(offset + 0.01, offset),
      point(offset + 0.002, offset + 0.003),
    )
    const b = line(point(offset, offset), point(offset - 0.01, offset - 0.01))
    const first = reverseArc ? { ...a, start: a.end, end: a.start } : a
    const second = reverseLine ? { ...b, start: b.end, end: b.start } : b
    expectResult(intersectEdges(swap ? second : first, swap ? first : second), {
      kind: 'points',
      points: [point(offset, offset)],
    })
  },
)
