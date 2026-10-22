import { expect, it } from 'vitest'
import { anchorForConnectedDirection, anchorForConnectedPort } from './connectedAvoidanceControls'
import { buildConnectedAvoidance, type SourceChain } from './connectedAvoidanceGeometry'

const circle: SourceChain = {
  cyclic: true,
  edges: [
    {
      id: 'upper',
      startId: 'right',
      endId: 'left',
      edge: {
        kind: 'arc',
        start: { re: 1, im: 0 },
        end: { re: -1, im: 0 },
        through: { re: 0, im: 1 },
      },
    },
    {
      id: 'lower',
      startId: 'left',
      endId: 'right',
      edge: {
        kind: 'arc',
        start: { re: -1, im: 0 },
        end: { re: 1, im: 0 },
        through: { re: 0, im: -1 },
      },
    },
  ],
}

it.each([0, 45, 270, -90])(
  'sets a circular opening to %s degrees without changing radius or gap',
  (degrees) => {
    const angle = (degrees * Math.PI) / 180
    const input = {
      source: circle,
      center: { re: 0, im: 0 },
      radius: 0.2,
      gap: 0.1,
      direction: { re: Math.cos(angle), im: Math.sin(angle) },
    }
    const anchor = anchorForConnectedDirection(input)
    expect(anchor.ok, anchor.ok ? '' : anchor.error).toBe(true)
    if (!anchor.ok) throw new Error(anchor.error)
    const built = buildConnectedAvoidance({ ...input, anchor: anchor.value })
    if (!built.ok) throw new Error(built.error)
    expect(built.value.geometry.arc.radius).toBe(0.2)
    expect(built.value.banks.gap).toBe(0.1)
    expect(built.value.banks.direction.re).toBeCloseTo(Math.cos(angle), 10)
    expect(built.value.banks.direction.im).toBeCloseTo(Math.sin(angle), 10)
  },
)

it('rejects a direction with no finite source contact', () => {
  const source: SourceChain = {
    cyclic: false,
    edges: [
      {
        id: 'base',
        startId: 'a',
        endId: 'b',
        edge: {
          kind: 'line',
          start: { re: -2, im: 0 },
          end: { re: 2, im: 0 },
        },
      },
    ],
  }
  expect(
    anchorForConnectedDirection({
      source,
      center: { re: 0, im: 1 },
      radius: 0.2,
      gap: 0.1,
      direction: { re: 0, im: 1 },
    }).ok,
  ).toBe(false)
})

it.each([-1, 1] as const)(
  'inverts the actual %s bank contact without changing the disk or gap',
  (outward) => {
    const source: SourceChain = {
      cyclic: false,
      edges: [
        {
          id: 'base',
          startId: 'a',
          endId: 'b',
          edge: { kind: 'line', start: { re: -2, im: 0 }, end: { re: 2, im: 0 } },
        },
      ],
    }
    const point = { re: 0.7 + outward * 0.1 * Math.sqrt(1.49), im: 0 }
    const input = { source, center: { re: 0, im: 1 }, radius: 0.4, gap: 0.2, point, outward }
    const result = anchorForConnectedPort(input)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error)
    expect(result.value).toMatchObject({
      kind: 'segment',
      segmentId: 'base',
      t: expect.closeTo(0.675, 10),
    })
    const built = buildConnectedAvoidance({ ...input, anchor: result.value })
    if (!built.ok) throw new Error(built.error)
    expect(built.value.banks.gap).toBe(0.2)
    expect(built.value.geometry.arc.radius).toBe(0.4)
  },
)

it.each([0, 45, 270, -90])(
  'moves either circular-source contact to %s degrees across the seam',
  (degrees) => {
    for (const outward of [-1, 1] as const) {
      const angle = (degrees * Math.PI) / 180 + outward * Math.asin(0.02)
      const result = anchorForConnectedPort({
        source: circle,
        center: { re: 0, im: 0 },
        radius: 0.1,
        gap: 0.04,
        point: { re: Math.cos(angle), im: Math.sin(angle) },
        outward,
      })
      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error(result.error)
      const built = buildConnectedAvoidance({
        source: circle,
        center: { re: 0, im: 0 },
        radius: 0.1,
        gap: 0.04,
        anchor: result.value,
      })
      if (!built.ok) throw new Error(built.error)
      expect(built.value.banks.direction.re).toBeCloseTo(Math.cos((degrees * Math.PI) / 180), 9)
      expect(built.value.banks.direction.im).toBeCloseTo(Math.sin((degrees * Math.PI) / 180), 9)
    }
  },
)

it('inverts a contact on a reversed circular source without changing the requested ray', () => {
  const reversed: SourceChain = {
    cyclic: true,
    edges: [...circle.edges].reverse().map((s) => ({
      ...s,
      startId: s.endId,
      endId: s.startId,
      edge: { ...s.edge, start: s.edge.end, end: s.edge.start },
    })),
  }
  const angle = Math.PI / 4 + Math.asin(0.02)
  const result = anchorForConnectedPort({
    source: reversed,
    center: { re: 0, im: 0 },
    radius: 0.1,
    gap: 0.04,
    point: { re: Math.cos(angle), im: Math.sin(angle) },
    outward: 1,
  })
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(result.error)
  const built = buildConnectedAvoidance({
    source: reversed,
    center: { re: 0, im: 0 },
    radius: 0.1,
    gap: 0.04,
    anchor: result.value,
  })
  if (!built.ok) throw new Error(built.error)
  expect(built.value.banks.direction.re).toBeCloseTo(Math.SQRT1_2, 9)
  expect(built.value.banks.direction.im).toBeCloseTo(Math.SQRT1_2, 9)
})
