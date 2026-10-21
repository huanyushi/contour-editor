import { describe, expect, it } from 'vitest'
import { nearestPath } from '../../lib/pathSnap'
import { createAvoidanceFixture } from '../../test/avoidanceFixtures'
import { createInitialState } from './model'
import { captureMarkerPath, snapPathInteger, sourceSnapPaths } from './pathSnap'

const metric = { a: 40, b: 0, c: 0, d: -40 }

describe('integer snapping on finite paths', () => {
  const line = {
    kind: 'line' as const,
    start: { re: -3, im: 0 },
    end: { re: 3, im: 0 },
  }
  function snap(
    path: Parameters<typeof nearestPath>[0][number],
    re: number,
    im: number,
    screen = metric,
    enabled = true,
  ) {
    const raw = { re, im }
    const hit = nearestPath([path], raw, screen)!
    return snapPathInteger(raw, hit, screen, enabled)
  }

  it('snaps near an integer on the source without disabling ordinary path projection', () => {
    expect(snap(line, 1.1, 0.05)).toEqual({ re: 1, im: 0 })
    expect(snap(line, 1.3, 0.05).re).toBeCloseTo(1.3)
    expect(snap(line, 1.1, 0.05, metric, false).re).toBeCloseTo(1.1)
  })

  it('uses exact lattice points on sloped lines, never rounding a point off-path', () => {
    const sloped = { ...line, start: { re: -3, im: -1.5 }, end: { re: 3, im: 1.5 } }
    expect(snap(sloped, 1.98, 1.08)).toEqual({ re: 2, im: 1 })
    const point = snap(sloped, 1.06, 0.55)
    expect(point.im).toBeCloseTo(point.re / 2, 12)
    expect(point.re).not.toBe(1)
    // Multiple grid candidates are nearby at extreme zoom-out; choose one on the path.
    expect(snap(sloped, 1.1, 0.55, { a: 2, b: 0, c: 0, d: -2 })).toEqual({ re: 2, im: 1 })
  })

  it('accepts true arc lattice points but rejects its chord, extension and neighboring lattice', () => {
    const arc = {
      kind: 'arc' as const,
      start: { re: 5, im: 0 },
      end: { re: -5, im: 0 },
      through: { re: 0, im: 5 },
    }
    expect(snap(arc, 3.05, 4.02)).toEqual({ re: 3, im: 4 })
    const nonLattice = snap(arc, 1.05, 4.95)
    expect(Math.hypot(nonLattice.re, nonLattice.im)).toBeCloseTo(5, 12)
    expect(nonLattice.im).not.toBe(5)
    const short = { ...line, start: { re: 0.2, im: 0 }, end: { re: 0.8, im: 0 } }
    expect(snap(short, 1, 0)).toEqual(short.end)
  })

  it('measures the 8px threshold in the full CSS screen metric', () => {
    const screen = { a: 80, b: 15, c: 25, d: -30 }
    expect(snap(line, 1.09, 0, screen)).toEqual({ re: 1, im: 0 })
    expect(snap(line, 1.11, 0, screen).re).toBeCloseTo(1.11)
    for (const cssScale of [0.75, 1.2]) {
      const scaled = { a: 80 * cssScale, b: 0, c: 0, d: -30 * cssScale }
      expect(snap(line, 1 + 7.9 / scaled.a, 0, scaled)).toEqual({ re: 1, im: 0 })
      expect(snap(line, 1 + 8.1 / scaled.a, 0, scaled).re).not.toBe(1)
    }
  })

  it('does not let a large coordinate hide an off-path error on either axis', () => {
    for (const [large, small] of [
      [1e15, 0.125],
      [1e12, 0.0001],
    ]) {
      const horizontal = {
        ...line,
        start: { re: large - 3, im: small },
        end: { re: large + 3, im: small },
      }
      expect(snap(horizontal, large, small)).toEqual({ re: large, im: small })
      const vertical = {
        ...line,
        start: { re: small, im: large - 3 },
        end: { re: small, im: large + 3 },
      }
      expect(snap(vertical, small, large)).toEqual({ re: small, im: large })
      const onGrid = {
        ...horizontal,
        start: { ...horizontal.start, im: 0 },
        end: { ...horizontal.end, im: 0 },
      }
      expect(snap(onGrid, large + 1.125, 0)).toEqual({ re: large + 1, im: 0 })
    }
  })
})

describe('gesture source paths', () => {
  it('uses active source edges and independent connections, never the hidden closing edge', () => {
    const state = createInitialState()
    state.closed = false
    state.connections = [
      { id: 'independent', kind: 'arc', startId: 'a', endId: 'c', through: { re: 0, im: 5 } },
    ]
    const paths = sourceSnapPaths(state)
    expect(paths.map((p) => p.id)).toEqual(['edge-a', 'edge-b', 'edge-c', 'independent'])
    expect(paths.at(-1)?.kind).toBe('arc')
  })

  it('captures the connected active contour component across corners, not disconnected edges', () => {
    const state = createInitialState()
    state.closed = false
    state.vertices.push({ id: 'loose-a', re: 10, im: 0 }, { id: 'loose-b', re: 12, im: 0 })
    state.segments = [
      ...state.segments.slice(0, 2),
      { id: 'loose', kind: 'line', startId: 'loose-a', endId: 'loose-b' },
    ]
    const captured = captureMarkerPath(sourceSnapPaths(state), { re: 0, im: 0.1 }, metric)!
    expect(captured.map((p) => p.id)).toEqual(['edge-a', 'edge-b'])
    const aroundCorner = nearestPath(captured, { re: 4.2, im: 2 }, metric)!
    expect(aroundCorner.point).toEqual({ re: 4, im: 2 })
    expect(captureMarkerPath(sourceSnapPaths(state), { re: 0, im: -2 }, metric)).toBeNull()
  })

  it('excludes incident connections to prevent self-dependent constraints and locks other branches individually', () => {
    const state = createAvoidanceFixture()
    state.connections = [
      { id: 'incident', kind: 'line', startId: 'pole', endId: 'a' },
      { id: 'other', kind: 'line', startId: 'a', endId: 'c' },
      { id: 'branch', kind: 'line', startId: 'c', endId: 'd' },
    ]
    const paths = sourceSnapPaths(state, 'pole')
    expect(paths.some((p) => p.id === 'incident')).toBe(false)
    expect(captureMarkerPath(paths, { re: 0, im: 1.5 }, metric)?.map((p) => p.id)).toEqual([
      'other',
    ])
  })

  it('captures original avoidance baselines, never generated arcs or gaps, and freezes geometry for a gesture', () => {
    const state = createAvoidanceFixture()
    const paths = sourceSnapPaths(state, 'pole')
    expect(paths.map((p) => p.id)).toEqual(state.segments.map((s) => s.id))
    const captured = captureMarkerPath(paths, { re: 0, im: 0 }, metric)!
    expect(nearestPath(captured, { re: 1, im: 0.6 }, metric)?.point).toEqual({ re: 1, im: 0 })
    state.vertices[0].im = -5
    state.vertices[1].im = 5
    expect(nearestPath(captured, { re: 1, im: 0.6 }, metric)?.point).toEqual({ re: 1, im: 0 })
  })
})
