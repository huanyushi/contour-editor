import { Utils } from '@flatten-js/core'
import { expect, it } from 'vitest'
import { arcThrough, pointOnArc } from './arc'
import type { ComplexPoint } from './geometry'
import type { GeometricEdge } from './geometryIntersections'
import {
  buildArcAvoidance,
  buildCornerAvoidance,
  type PathAvoidanceResult,
} from './pathAvoidanceGeometry'

const p = (re: number, im: number): ComplexPoint => ({ re, im })
const arc = (
  start: ComplexPoint,
  end: ComplexPoint,
  through: ComplexPoint,
): Extract<GeometricEdge, { kind: 'arc' }> => ({ kind: 'arc', start, end, through })
const line = (start: ComplexPoint, end: ComplexPoint): GeometricEdge => ({
  kind: 'line',
  start,
  end,
})
const upper = arc(p(-3, 0), p(3, 0), p(0, 3))
const incoming = line(p(0, 2), p(0, 0))
const outgoing = line(p(0, 0), p(3, 0))

function value(result: PathAvoidanceResult) {
  expect(result.ok, result.ok ? '' : result.error).toBe(true)
  if (!result.ok) throw new Error(result.error)
  return result.value
}

function expectPoint(actual: ComplexPoint, expected: ComplexPoint, tolerance = 1e-9) {
  expect(Math.hypot(actual.re - expected.re, actual.im - expected.im)).toBeLessThan(tolerance)
}

it('clips the actual radius-3 source circle, orders source parameters, and selects both pole arcs', () => {
  const center = p(0, 3)
  const left = value(buildArcAvoidance({ source: upper, center, radius: 0.5, side: 'left' }))
  const right = value(buildArcAvoidance({ source: upper, center, radius: 0.5, side: 'right' }))
  const x = Math.sqrt(143) / 24
  const halfAngle = 2 * Math.asin(1 / 12)
  for (const result of [left, right]) {
    const g = result.geometry
    expect(result.mode).toBe('arc')
    expectPoint(g.entry, p(-x, 71 / 24))
    expectPoint(g.exit, p(x, 71 / 24))
    for (const endpoint of [g.entry, g.exit]) {
      expect(Math.hypot(endpoint.re, endpoint.im)).toBeCloseTo(3, 12)
      expect(Math.hypot(endpoint.re, endpoint.im - 3)).toBeCloseTo(0.5, 12)
    }
    expect(result.entryT).toBeCloseTo(0.5 - halfAngle / Math.PI, 12)
    expect(result.exitT).toBeCloseTo(0.5 + halfAngle / Math.PI, 12)
    expect(g.footprint[0]).toBeCloseTo(3 * (Math.PI / 2 - halfAngle), 12)
    expect(g.footprint[1]).toBeCloseTo(3 * (Math.PI / 2 + halfAngle), 12)
    expect(g.entryBase).toEqual(g.entry)
    expect(g.exitBase).toEqual(g.exit)
    expect(g.onLine).toBe(true)
    expect(g.arc.center).toEqual(center)
    expect(g.arc.radius).toBe(0.5)
    expect(result.defaultSide).toBe('right')
    expectPoint(pointOnArc(g.arc, 0), g.entry)
    expectPoint(pointOnArc(g.arc, 1), g.exit)
    expectPoint(pointOnArc(g.arc, 0.5), g.through)
  }
  expectPoint(left.geometry.through, p(0, 3.5))
  expectPoint(right.geometry.through, p(0, 2.5))
  expect(Math.abs(left.geometry.arc.sweep)).toBeGreaterThan(Math.PI)
  expect(Math.abs(right.geometry.arc.sweep)).toBeLessThan(Math.PI)
})

it('returns the rectangle corner quarter-circle by default and the other three-quarter-circle by side', () => {
  const left = value(
    buildCornerAvoidance({ incoming, outgoing, center: p(0, 0), radius: 0.5, side: 'left' }),
  )
  const right = value(
    buildCornerAvoidance({ incoming, outgoing, center: p(0, 0), radius: 0.5, side: 'right' }),
  )
  for (const result of [left, right]) {
    expect(result.mode).toBe('corner')
    expect(result.defaultSide).toBe('left')
    expectPoint(result.geometry.entry, p(0, 0.5))
    expectPoint(result.geometry.exit, p(0.5, 0))
    expect(result.entryT).toBeCloseTo(0.75, 12)
    expect(result.exitT).toBeCloseTo(1 / 6, 12)
    expect(result.geometry.footprint[0]).toBeCloseTo(1.5, 12)
    expect(result.geometry.footprint[1]).toBeCloseTo(2, 12)
    expect(result.geometry.arc.center).toEqual(p(0, 0))
    expect(result.geometry.arc.radius).toBe(0.5)
    expect(result.geometry.entryBase).toEqual(result.geometry.entry)
    expect(result.geometry.exitBase).toEqual(result.geometry.exit)
    expect(result.geometry.onLine).toBe(true)
  }
  expect(left.geometry.arc.sweep).toBeCloseTo(-Math.PI / 2, 12)
  expect(right.geometry.arc.sweep).toBeCloseTo((3 * Math.PI) / 2, 12)
  expectPoint(left.geometry.through, p(Math.SQRT1_2 / 2, Math.SQRT1_2 / 2))
  expectPoint(right.geometry.through, p(-Math.SQRT1_2 / 2, -Math.SQRT1_2 / 2))
})

it.each([
  {
    name: 'minor arc',
    source: arc(p(-1.8, 2.4), p(1.8, 2.4), p(0, 3)),
    midpointT: 0.5,
    sweep: 2 * Math.atan(0.75),
  },
  {
    name: 'major arc crossing the angular branch cut',
    source: arc(p(3, 0), p(0, -3), p(-3, 0)),
    midpointT: 1 / 3,
    sweep: (3 * Math.PI) / 2,
  },
])(
  'uses the finite $name parameterization rather than its chord',
  ({ source, midpointT, sweep }) => {
    const result = value(buildArcAvoidance({ source, center: p(0, 3), radius: 0.5, side: 'right' }))
    const halfAngle = 2 * Math.asin(1 / 12)
    // The major fixture traverses the upper circle right→left, unlike the minor one.
    const direction = source.start.re === 3 ? -1 : 1
    expectPoint(result.geometry.entry, p((-direction * Math.sqrt(143)) / 24, 71 / 24))
    expectPoint(result.geometry.exit, p((direction * Math.sqrt(143)) / 24, 71 / 24))
    expect(result.entryT).toBeCloseTo(midpointT - halfAngle / sweep, 11)
    expect(result.exitT).toBeCloseTo(midpointT + halfAngle / sweep, 11)
    expect(result.geometry.footprint[0]).toBeCloseTo(3 * (midpointT * sweep - halfAngle), 10)
    expect(result.geometry.footprint[1]).toBeCloseTo(3 * (midpointT * sweep + halfAngle), 10)
  },
)

const curvedIncoming = arc(p(-2, 2), p(0, 0), p(-2, 0))
const curvedOutgoing = arc(p(0, 0), p(2, 2), p(2, 0))

it.each([
  { name: 'line/arc', before: incoming, after: curvedOutgoing },
  { name: 'arc/line', before: curvedIncoming, after: outgoing },
  { name: 'arc/arc', before: curvedIncoming, after: curvedOutgoing },
])('clips a directed $name corner on the true source circles', ({ before, after }) => {
  const a = (1 + Math.sqrt(31)) / 16
  const b = (1 - Math.sqrt(31)) / 16
  const result = value(
    buildCornerAvoidance({
      incoming: before,
      outgoing: after,
      center: p(0, 0),
      radius: 0.5,
      side: 'left',
    }),
  )
  const entry = before.kind === 'arc' ? p(-a, b) : p(0, 0.5)
  const exit = after.kind === 'arc' ? p(a, b) : p(0.5, 0)
  expectPoint(result.geometry.entry, entry)
  expectPoint(result.geometry.exit, exit)
  const halfAngle = 2 * Math.asin(0.5 / (2 * Math.SQRT2))
  expect(result.entryT).toBeCloseTo(before.kind === 'arc' ? 1 - halfAngle / Math.PI : 0.75, 11)
  expect(result.exitT).toBeCloseTo(after.kind === 'arc' ? halfAngle / Math.PI : 1 / 6, 11)
  const incomingLength = before.kind === 'arc' ? Math.SQRT2 * Math.PI : 2
  expect(result.geometry.footprint[0]).toBeCloseTo(incomingLength * result.entryT, 11)
  expect(result.geometry.footprint[1]).toBeCloseTo(incomingLength, 11)
  for (const side of ['left', 'right'] as const) {
    const selected = value(
      buildCornerAvoidance({
        incoming: before,
        outgoing: after,
        center: p(0, 0),
        radius: 0.5,
        side,
      }),
    )
    const chord = p(exit.re - entry.re, exit.im - entry.im)
    const through = selected.geometry.through
    const cross = chord.re * (through.im - entry.im) - chord.im * (through.re - entry.re)
    expect(Math.sign(cross)).toBe(side === 'left' ? 1 : -1)
    expect(Math.abs(selected.geometry.arc.sweep) < Math.PI).toBe(side === selected.defaultSide)
    expectPoint(pointOnArc(selected.geometry.arc, 0), entry)
    expectPoint(pointOnArc(selected.geometry.arc, 1), exit)
    expectPoint(pointOnArc(selected.geometry.arc, 0.5), through)
  }
})

function reverse<T extends GeometricEdge>(edge: T): T {
  return { ...edge, start: edge.end, end: edge.start }
}

it.each(['left', 'right'] as const)(
  'preserves the visible source detour when reversed from %s',
  (side) => {
    const original = value(buildArcAvoidance({ source: upper, center: p(0, 3), radius: 0.5, side }))
    const reversed = value(
      buildArcAvoidance({
        source: reverse(upper),
        center: p(0, 3),
        radius: 0.5,
        side: side === 'left' ? 'right' : 'left',
      }),
    )
    expectPoint(reversed.geometry.entry, original.geometry.exit)
    expectPoint(reversed.geometry.exit, original.geometry.entry)
    expectPoint(reversed.geometry.through, original.geometry.through)
    expect(reversed.geometry.arc.sweep).toBeCloseTo(-original.geometry.arc.sweep, 12)
    expect(reversed.entryT).toBeCloseTo(1 - original.exitT, 12)
    expect(reversed.exitT).toBeCloseTo(1 - original.entryT, 12)
    expect(reversed.defaultSide).not.toBe(original.defaultSide)
  },
)

it.each([
  [incoming, outgoing],
  [incoming, curvedOutgoing],
  [curvedIncoming, outgoing],
  [curvedIncoming, curvedOutgoing],
])('preserves a corner under directed edge swap/reversal and side flip', (before, after) => {
  for (const side of ['left', 'right'] as const) {
    const original = value(
      buildCornerAvoidance({
        incoming: before,
        outgoing: after,
        center: p(0, 0),
        radius: 0.5,
        side,
      }),
    )
    const reversed = value(
      buildCornerAvoidance({
        incoming: reverse(after),
        outgoing: reverse(before),
        center: p(0, 0),
        radius: 0.5,
        side: side === 'left' ? 'right' : 'left',
      }),
    )
    expectPoint(reversed.geometry.entry, original.geometry.exit)
    expectPoint(reversed.geometry.exit, original.geometry.entry)
    expectPoint(reversed.geometry.through, original.geometry.through)
    expect(reversed.geometry.arc.sweep).toBeCloseTo(-original.geometry.arc.sweep, 12)
    expect(reversed.entryT).toBeCloseTo(1 - original.exitT, 12)
    expect(reversed.exitT).toBeCloseTo(1 - original.entryT, 12)
    expect(reversed.defaultSide).not.toBe(original.defaultSide)
  }
})

function transformEdge<T extends GeometricEdge>(
  edge: T,
  transform: (point: ComplexPoint) => ComplexPoint,
): T {
  return {
    ...edge,
    start: transform(edge.start),
    end: transform(edge.end),
    ...(edge.kind === 'arc' ? { through: transform(edge.through) } : {}),
  }
}

it.each([
  { scale: 1e-6, offset: 0, angle: 0.73 },
  { scale: 1e6, offset: 0, angle: -1.2 },
  { scale: 1, offset: 1e6, angle: Math.PI / 2 },
  { scale: 1, offset: 1e12, angle: 0 },
])(
  'preserves exact pole data at scale $scale, offset $offset, rotation $angle',
  ({ scale, offset, angle }) => {
    const transform = (point: ComplexPoint) =>
      p(
        offset + scale * (point.re * Math.cos(angle) - point.im * Math.sin(angle)),
        -offset + scale * (point.re * Math.sin(angle) + point.im * Math.cos(angle)),
      )
    const tolerance = Math.max(1e-8, (8 * Number.EPSILON * Math.abs(offset)) / scale)
    const expectTransformed = (actual: ComplexPoint, expected: ComplexPoint) => {
      const wanted = transform(expected)
      expect(
        Math.hypot((actual.re - wanted.re) / scale, (actual.im - wanted.im) / scale),
      ).toBeLessThan(tolerance)
    }
    const arcCenter = transform(p(0, 3))
    const cornerCenter = transform(p(0, 0))
    for (const side of ['left', 'right'] as const) {
      const sourceResult = value(
        buildArcAvoidance({
          source: transformEdge(upper, transform),
          center: arcCenter,
          radius: 0.5 * scale,
          side,
        }),
      )
      expectTransformed(sourceResult.geometry.entry, p(-Math.sqrt(143) / 24, 71 / 24))
      expectTransformed(sourceResult.geometry.exit, p(Math.sqrt(143) / 24, 71 / 24))
      expectTransformed(sourceResult.geometry.through, p(0, side === 'left' ? 3.5 : 2.5))
      expect(sourceResult.geometry.arc.center).toEqual(arcCenter)
      expect(sourceResult.geometry.arc.radius).toBe(0.5 * scale)
      const cornerResult = value(
        buildCornerAvoidance({
          incoming: transformEdge(incoming, transform),
          outgoing: transformEdge(outgoing, transform),
          center: cornerCenter,
          radius: 0.5 * scale,
          side,
        }),
      )
      expectTransformed(cornerResult.geometry.entry, p(0, 0.5))
      expectTransformed(cornerResult.geometry.exit, p(0.5, 0))
      expect(cornerResult.geometry.arc.center).toEqual(cornerCenter)
      expect(cornerResult.geometry.arc.radius).toBe(0.5 * scale)
      expect(cornerResult.geometry.arc.sweep).toBeCloseTo(
        side === 'left' ? -Math.PI / 2 : (3 * Math.PI) / 2,
        8,
      )
    }
  },
)

it('fits a shallow large-radius source before intersection and keeps the pole radius exact', () => {
  // Integer Pythagorean source support C(0,0), R=100000001, not a vertical chord.
  const source = arc(p(99999999, -20000), p(99999999, 20000), p(100000001, 0))
  const center = p(100000001, 0)
  for (const side of ['left', 'right'] as const) {
    const result = value(buildArcAvoidance({ source, center, radius: 256, side }))
    const g = result.geometry
    expect(g.entry.im).toBeCloseTo(-256, 5)
    expect(g.exit.im).toBeCloseTo(256, 5)
    expect(g.entry.re).toBeGreaterThan(100000000.99)
    for (const endpoint of [g.entry, g.exit]) {
      expect(Math.hypot(endpoint.re, endpoint.im)).toBeCloseTo(100000001, 5)
      expect(Math.hypot(endpoint.re - center.re, endpoint.im)).toBeCloseTo(256, 6)
    }
    expect(g.arc.center).toEqual(center)
    expect(g.arc.radius).toBe(256)
    expect(result.entryT).toBeLessThan(0.5)
    expect(result.exitT).toBeGreaterThan(0.5)
  }
})

it.each(
  (['left', 'right'] as const).flatMap((side) =>
    [false, true].map((reversed) => ({ side, reversed })),
  ),
)(
  'preserves radius-scale offsets near the origin for a large source, side $side, reversed $reversed',
  ({ side, reversed }) => {
    const source = arc(p(-1e8, -1e8), p(1e8, -1e8), p(0, 0))
    const result = value(
      buildArcAvoidance({
        source: reversed ? reverse(source) : source,
        center: p(0, 0),
        radius: 0.3,
        side,
      }),
    )
    const g = result.geometry
    // Subtracting the circle equations gives y = -r²/(2R), independently of
    // the source fit. The x correction is below double precision at this radius.
    const y = -(0.3 * 0.3) / (2 * 1e8)
    expectPoint(g.entry, p(reversed ? 0.3 : -0.3, y), 1e-13)
    expectPoint(g.exit, p(reversed ? -0.3 : 0.3, y), 1e-13)
    const above = (side === 'left') !== reversed
    expectPoint(g.through, p(0, above ? 0.3 : -0.3), 1e-13)
    expect(g.arc.center).toEqual(p(0, 0))
    expect(g.arc.radius).toBe(0.3)
    for (const point of [g.entry, g.exit, g.through]) {
      expect(Math.abs(Math.hypot(point.re, point.im) / 0.3 - 1)).toBeLessThan(1e-9)
    }
    const fitted = arcThrough(g.entry, g.exit, g.through)
    expect(fitted.ok).toBe(true)
    if (!fitted.ok) throw new Error(fitted.error)
    expect(Math.abs(fitted.arc.radius / 0.3 - 1)).toBeLessThan(1e-9)
    expect(Math.hypot(fitted.arc.center.re, fitted.arc.center.im) / 0.3).toBeLessThan(1e-9)
    expect(result.entryT).toBeLessThan(result.exitT)
  },
)

it('rejects a world-space refit that drifts beyond pole-scale and output-ULP precision', () => {
  const center = p(1e12, -1e12)
  const result = buildCornerAvoidance({
    incoming: line(p(center.re, center.im + 2), center),
    outgoing: line(center, p(center.re + 0.2, center.im + 2)),
    center,
    radius: 0.3,
    side: 'left',
  })
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.error).toMatch(/圆心|半径|精度/)
})

it.each([
  {
    name: 'source circle is smaller',
    source: arc(p(-1, 0), p(1, 0), p(0, 1)),
    center: p(0, 2),
    radius: 1.5,
    entry: p((-3 * Math.sqrt(15)) / 16, 11 / 16),
    exit: p((3 * Math.sqrt(15)) / 16, 11 / 16),
  },
  {
    name: 'near-concentric support difference',
    source: upper,
    center: p(0, 0.5),
    radius: 2.75,
    entry: p((-15 * Math.sqrt(7)) / 16, 27 / 16),
    exit: p((15 * Math.sqrt(7)) / 16, 27 / 16),
  },
])('retains exact pole offsets when $name', ({ source, center, radius, entry, exit }) => {
  for (const side of ['left', 'right'] as const) {
    const g = value(buildArcAvoidance({ source, center, radius, side })).geometry
    expectPoint(g.entry, entry, 1e-12)
    expectPoint(g.exit, exit, 1e-12)
    const fitted = arcThrough(g.entry, g.exit, g.through)
    expect(fitted.ok).toBe(true)
    if (!fitted.ok) throw new Error(fitted.error)
    expectPoint(fitted.arc.center, center, 1e-12)
    expect(fitted.arc.radius).toBeCloseTo(radius, 12)
  }
})

it.each([0, 1e12])(
  'does not round the pole radius to world-coordinate spacing at origin %s',
  (offset) => {
    const move = (point: ComplexPoint) => p(point.re + offset, point.im - offset)
    const halfAngle = 2 * Math.asin(0.3 / 6)
    const result = value(
      buildArcAvoidance({
        source: transformEdge(upper, move),
        center: move(p(0, 3)),
        radius: 0.3,
        side: 'right',
      }),
    )
    expect(result.entryT).toBeCloseTo(0.5 - halfAngle / Math.PI, 12)
    expect(result.exitT).toBeCloseTo(0.5 + halfAngle / Math.PI, 12)
    expect(result.geometry.arc.sweep).toBeCloseTo(Math.PI - halfAngle, 12)
    expect(result.geometry.arc.radius).toBe(0.3)
    const corner = value(
      buildCornerAvoidance({
        incoming: transformEdge(incoming, move),
        outgoing: transformEdge(outgoing, move),
        center: move(p(0, 0)),
        radius: 0.3,
        side: 'left',
      }),
    )
    expect(corner.entryT).toBeCloseTo(0.85, 12)
    expect(corner.exitT).toBeCloseTo(0.1, 12)
  },
)

it('deduplicates exact semicircle-seam intersections without rejecting a valid source arc', () => {
  const result = value(
    buildArcAvoidance({
      source: arc(p(-2, 0), p(2, 0), p(0, 2)),
      center: p(0, 1),
      radius: Math.sqrt(3),
      side: 'left',
    }),
  )
  expectPoint(result.geometry.entry, p(-Math.sqrt(3), 1))
  expectPoint(result.geometry.exit, p(Math.sqrt(3), 1))
  expect(result.entryT).toBeCloseTo(1 / 6, 10)
  expect(result.exitT).toBeCloseTo(5 / 6, 10)
  expect(Math.abs(result.geometry.arc.sweep)).toBeCloseTo(Math.PI, 10)
})

it.each([
  { name: 'external tangency', source: upper, center: p(0, 3.5), radius: 0.5 },
  { name: 'internal tangency', source: upper, center: p(0, 2.5), radius: 0.5 },
  { name: 'coincident circle', source: upper, center: p(0, 0), radius: 3 },
  { name: 'concentric disjoint circle', source: upper, center: p(0, 0), radius: 2 },
  { name: 'no finite intersections', source: upper, center: p(0, -3), radius: 0.5 },
  {
    name: 'unused major arc gap',
    source: arc(p(-1.8, 2.4), p(1.8, 2.4), p(0, -3)),
    center: p(0, 3),
    radius: 0.5,
  },
  {
    name: 'only one finite hit',
    source: arc(p(0, 3), p(3, 0), p(1.8, 2.4)),
    center: p(0, 3),
    radius: 0.5,
  },
  { name: 'endpoint on circle', source: upper, center: p(0, 3), radius: Math.sqrt(18) },
  { name: 'overlarge radius', source: upper, center: p(0, 3), radius: 5 },
  { name: 'collinear arc', source: arc(p(-3, 0), p(3, 0), p(0, 0)), center: p(0, 0), radius: 0.5 },
])('rejects $name without throwing', ({ source, center, radius }) => {
  const result = buildArcAvoidance({ source, center, radius, side: 'left' })
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.error.length).toBeGreaterThan(0)
})

it.each([
  { name: 'incoming has wrong direction', before: reverse(incoming), after: outgoing, radius: 0.5 },
  { name: 'outgoing has wrong direction', before: incoming, after: reverse(outgoing), radius: 0.5 },
  { name: 'no shared corner', before: incoming, after: line(p(0.1, 0), p(3, 0)), radius: 0.5 },
  { name: 'incoming endpoint reached', before: incoming, after: outgoing, radius: 2 },
  { name: 'outgoing endpoint reached', before: line(p(0, 4), p(0, 0)), after: outgoing, radius: 3 },
  { name: 'both edges swallowed', before: incoming, after: outgoing, radius: 4 },
  { name: 'zero length', before: line(p(0, 0), p(0, 0)), after: outgoing, radius: 0.5 },
  {
    name: 'collinear source arc',
    before: incoming,
    after: arc(p(0, 0), p(2, 0), p(1, 0)),
    radius: 0.5,
  },
  {
    name: 'retracing corner with identical joints',
    before: incoming,
    after: reverse(incoming),
    radius: 0.5,
  },
])('rejects a corner with $name', ({ before, after, radius }) => {
  expect(
    buildCornerAvoidance({
      incoming: before,
      outgoing: after,
      center: p(0, 0),
      radius,
      side: 'left',
    }).ok,
  ).toBe(false)
})

it.each([0, -1, NaN, Infinity])('rejects invalid radius %s for both modes', (radius) => {
  expect(buildArcAvoidance({ source: upper, center: p(0, 3), radius, side: 'left' }).ok).toBe(false)
  expect(
    buildCornerAvoidance({ incoming, outgoing, center: p(0, 0), radius, side: 'left' }).ok,
  ).toBe(false)
})

it('rejects nonfinite coordinates and runtime-invalid sides', () => {
  expect(
    buildArcAvoidance({ source: upper, center: p(NaN, 3), radius: 0.5, side: 'left' }).ok,
  ).toBe(false)
  expect(
    buildArcAvoidance({
      source: { ...upper, through: p(0, Infinity) },
      center: p(0, 3),
      radius: 0.5,
      side: 'left',
    }).ok,
  ).toBe(false)
  expect(
    buildCornerAvoidance({ incoming, outgoing, center: p(0, Infinity), radius: 0.5, side: 'left' })
      .ok,
  ).toBe(false)
  const side = 'invalid' as 'left'
  expect(buildArcAvoidance({ source: upper, center: p(0, 3), radius: 0.5, side }).ok).toBe(false)
  expect(buildCornerAvoidance({ incoming, outgoing, center: p(0, 0), radius: 0.5, side }).ok).toBe(
    false,
  )
})

it('rejects joints that collapse at the output world-coordinate precision', () => {
  const move = (point: ComplexPoint) => p(point.re + 1e12, point.im - 1e12)
  expect(
    buildArcAvoidance({
      source: transformEdge(upper, move),
      center: move(p(0, 3)),
      radius: 1e-6,
      side: 'left',
    }).ok,
  ).toBe(false)
  expect(
    buildCornerAvoidance({
      incoming: transformEdge(incoming, move),
      outgoing: transformEdge(outgoing, move),
      center: move(p(0, 0)),
      radius: 1e-6,
      side: 'left',
    }).ok,
  ).toBe(false)
})

it('leaves caller-owned data and third-party tolerance unchanged on success and failure', () => {
  const before = structuredClone({ upper, incoming, outgoing })
  const tolerance = Utils.getTolerance()
  for (const radius of [0.5, 0, 3, 5]) {
    buildArcAvoidance({ source: upper, center: p(0, 3), radius, side: 'left' })
    buildCornerAvoidance({ incoming, outgoing, center: p(0, 0), radius, side: 'left' })
    expect(Utils.getTolerance()).toBe(tolerance)
  }
  expect({ upper, incoming, outgoing }).toEqual(before)
})
