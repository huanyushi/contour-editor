import { describe, expect, it } from 'vitest'
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
const input = {
  source: circle,
  anchor: { kind: 'vertex' as const, vertexId: 'right', segmentId: 'upper' },
  center: { re: 0, im: 0 },
  radius: 0.1,
  gap: 0.04,
}

describe('parallel connected detours', () => {
  it('replaces the unit-circle seam across two true arcs', () => {
    const result = buildConnectedAvoidance(input)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error)
    const { geometry, trims, banks } = result.value
    expect(geometry.entryBase.re).toBeCloseTo(Math.sqrt(1 - 0.02 ** 2), 12)
    expect(geometry.entry.re).toBeCloseTo(Math.sqrt(0.1 ** 2 - 0.02 ** 2), 12)
    expect(trims).toHaveLength(2)
    expect(geometry.through).toEqual({ re: -0.1, im: 0 })
    expect(geometry.arc.sweep).toBeLessThan(-Math.PI)
    expect(banks.gap).toBe(0.04)
    expect(banks.entry.outward).toBe(-banks.exit.outward)
  })

  it('keeps a clicked interior arc location rather than choosing a closest point', () => {
    const result = buildConnectedAvoidance({
      ...input,
      anchor: { kind: 'segment', segmentId: 'upper', t: 0.5 },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error)
    expect(result.value.geometry.through.re).toBeCloseTo(0, 12)
    expect(result.value.geometry.through.im).toBeCloseTo(-0.1, 12)
    expect(result.value.trims).toHaveLength(1)
  })

  it('clips a full intermediate segment in an open mixed chain', () => {
    const points = [
      { re: -1, im: 0 },
      { re: -0.01, im: 0.02 },
      { re: 0.01, im: -0.02 },
      { re: 1, im: 0 },
    ]
    const source: SourceChain = {
      cyclic: false,
      edges: points.slice(1).map((end, i) => ({
        id: `s${i}`,
        startId: `p${i}`,
        endId: `p${i + 1}`,
        edge: { kind: 'line', start: points[i], end },
      })),
    }
    const result = buildConnectedAvoidance({
      ...input,
      source,
      center: { re: 0, im: 1 },
      anchor: { kind: 'segment', segmentId: 's1', t: 0.5 },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error)
    expect(result.value.trims).toHaveLength(3)
    expect(result.value.trims[1]).toEqual({ sourceSegmentId: 's1', startT: 0, endT: 1 })
  })

  it.each([0, -1, 0.2, Infinity, NaN])('rejects invalid gap %s without changing inputs', (gap) => {
    expect(buildConnectedAvoidance({ ...input, gap }).ok).toBe(false)
    expect(input.gap).toBe(0.04)
  })

  it('rejects an undefined direction', () => {
    expect(buildConnectedAvoidance({ ...input, center: { re: 1, im: 0 } }).ok).toBe(false)
  })

  it('reverses traversal without changing the circular locus', () => {
    const source: SourceChain = {
      cyclic: true,
      edges: [...circle.edges].reverse().map((s) => ({
        ...s,
        startId: s.endId,
        endId: s.startId,
        edge: { ...s.edge, start: s.edge.end, end: s.edge.start },
      })),
    }
    const result = buildConnectedAvoidance({ ...input, source })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error)
    expect(result.value.geometry.arc.sweep).toBeGreaterThan(Math.PI)
    expect(result.value.geometry.arc.center).toEqual({ re: 0, im: 0 })
  })

  it('connects to an eccentric source circle without requiring circle intersections', () => {
    const result = buildConnectedAvoidance({ ...input, center: { re: 0.2, im: 0 } })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error)
    expect(result.value.geometry.entryBase.re).toBeCloseTo(Math.sqrt(1 - 0.02 ** 2), 12)
    expect(result.value.geometry.entry.re).toBeCloseTo(0.2 + Math.sqrt(0.1 ** 2 - 0.02 ** 2), 12)
  })

  it('preserves the construction under a rotation and translation', () => {
    const transform = (p: { re: number; im: number }) => ({ re: 10 - p.im, im: -7 + p.re })
    const source: SourceChain = {
      ...circle,
      edges: circle.edges.map((s) => ({
        ...s,
        edge: {
          ...s.edge,
          start: transform(s.edge.start),
          end: transform(s.edge.end),
          ...(s.edge.kind === 'arc' ? { through: transform(s.edge.through) } : {}),
        },
      })),
    }
    const result = buildConnectedAvoidance({ ...input, source, center: transform(input.center) })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error)
    expect(result.value.geometry.arc.center).toEqual({ re: 10, im: -7 })
    expect(result.value.geometry.entryBase.im).toBeCloseTo(-7 + Math.sqrt(1 - 0.02 ** 2), 11)
    expect(result.value.geometry.arc.radius).toBe(0.1)
  })

  it('connects to a tilted finite line in an open component', () => {
    const source: SourceChain = {
      cyclic: false,
      edges: [
        {
          id: 'line',
          startId: 'a',
          endId: 'b',
          edge: { kind: 'line', start: { re: -1, im: -1 }, end: { re: 1, im: 1 } },
        },
      ],
    }
    const result = buildConnectedAvoidance({
      ...input,
      source,
      center: { re: -1, im: 1 },
      anchor: { kind: 'segment', segmentId: 'line', t: 0.5 },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error)
    expect(result.value.geometry.entryBase.re).toBeCloseTo(result.value.geometry.entryBase.im, 12)
    expect(result.value.trims).toHaveLength(1)
  })

  it('rejects an unresolvable gap rather than losing its two banks', () => {
    expect(buildConnectedAvoidance({ ...input, gap: 1e-20 }).ok).toBe(false)
  })

  it('can replace an entire open source segment while keeping both external endpoints', () => {
    const source: SourceChain = {
      cyclic: false,
      edges: [
        {
          id: 'line',
          startId: 'a',
          endId: 'b',
          edge: { kind: 'line', start: { re: -0.02, im: 0 }, end: { re: 0.02, im: 0 } },
        },
      ],
    }
    const result = buildConnectedAvoidance({
      ...input,
      source,
      center: { re: 0, im: 1 },
      anchor: { kind: 'segment', segmentId: 'line', t: 0.5 },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error)
    expect(result.value.trims).toEqual([{ sourceSegmentId: 'line', startT: 0, endT: 1 }])
  })

  it.each(['line', 'arc'] as const)(
    'ignores a %s bank contact beyond the selected source ports',
    (kind) => {
      const source: SourceChain = {
        cyclic: false,
        edges: [
          {
            id: 'base',
            startId: 'a',
            endId: 'b',
            edge: { kind: 'line', start: { re: -1, im: 0 }, end: { re: 1, im: 0 } },
          },
          {
            id: 'link',
            startId: 'b',
            endId: 'c',
            edge: {
              kind: 'line',
              start: { re: 1, im: 0 },
              end: kind === 'line' ? { re: -0.02, im: -2 } : { re: 0.98, im: -1 },
            },
          },
          {
            id: 'far',
            startId: 'c',
            endId: 'd',
            edge:
              kind === 'line'
                ? { kind: 'line', start: { re: -0.02, im: -2 }, end: { re: -0.02, im: -3 } }
                : {
                    kind: 'arc',
                    start: { re: 0.98, im: -1 },
                    end: { re: 0.98, im: -3 },
                    through: { re: -0.02, im: -2 },
                  },
          },
        ],
      }
      const result = buildConnectedAvoidance({
        ...input,
        source,
        center: { re: 0, im: 1 },
        anchor: { kind: 'segment', segmentId: 'base', t: 0.5 },
      })
      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error(result.error)
      expect(result.value.trims).toHaveLength(1)
      expect(result.value.trims[0].sourceSegmentId).toBe('base')
    },
  )
})
