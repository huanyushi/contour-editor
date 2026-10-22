import { describe, expect, it, vi } from 'vitest'
import {
  createAvoidanceFixture,
  createHugeOrdinaryArcFixture,
} from '../../../test/avoidanceFixtures'
import type { ComplexPoint } from '../../../lib/geometry'
import * as intersections from '../../../lib/geometryIntersections'
import { validateAvoidances } from './avoidanceValidation'
import type { ContourState } from '../model'
import { resolveScene } from '../scene/resolvedScene'

function addConnection(
  state: ContourState,
  start: ComplexPoint,
  end: ComplexPoint,
  through?: ComplexPoint,
) {
  state.markers.push(
    { ...state.markers[0], id: 'link-start', ...start },
    { ...state.markers[0], id: 'link-end', ...end },
  )
  const common = { id: 'link', startId: 'link-start', endId: 'link-end' }
  state.connections.push(
    through ? { ...common, kind: 'arc', through } : { ...common, kind: 'line' },
  )
}

function expectConflict(state: ContourState, ...contexts: string[]) {
  const snapshot = JSON.stringify(state)
  // Every collision fixture must first be a valid, resolvable source document.
  expect(resolveScene(state).ok).toBe(true)
  const result = validateAvoidances(state)
  expect(result.ok).toBe(false)
  if (result.ok) throw new Error('Expected a conflict')
  for (const context of contexts) expect(result.error).toContain(context)
  expect(result.error).toMatch(/[\u4e00-\u9fff]/)
  expect(JSON.stringify(state)).toBe(snapshot)
}

function illConditionedScene(reverse: boolean, semicircle: boolean): ContourState {
  const state = createAvoidanceFixture()
  const x = 1192934961.3821044,
    y = 2879999761.907751
  state.closed = false
  state.vertices = [
    { id: 'a', re: 1.3, im: 1.4 },
    { id: 'b', re: 0.1, im: 0.2 },
  ]
  state.segments = [
    {
      id: 'ordinary',
      kind: 'arc',
      startId: reverse ? 'b' : 'a',
      endId: reverse ? 'a' : 'b',
      through: { re: 2.5, im: 2.600000001 },
    },
  ]
  state.markers[0] = { ...state.markers[0], re: semicircle ? x : x + 100, im: y }
  addConnection(
    state,
    semicircle ? { re: x - 1024, im: y } : { re: x - 100, im: y - 64 },
    semicircle ? { re: x + 1024, im: y } : { re: x - 100, im: y + 64 },
  )
  state.avoidances[0] = {
    ...state.avoidances[0],
    targetSegmentId: 'link',
    radius: semicircle ? 256 : 16,
    openingRatio: 1,
  }
  return state
}

describe('avoidance scene validation', () => {
  it('bounds a huge accepted ordinary arc in a normalized frame before culling disjoint generated parts', () => {
    const state = createHugeOrdinaryArcFixture()
    const transform = (p: ComplexPoint) => ({ re: p.re * 1e305, im: p.im * 1e305 - 1e306 })
    state.vertices = state.vertices.map((p) => ({ ...p, ...transform(p) }))
    state.markers[0] = {
      ...state.markers[0],
      ...transform(state.markers[0]),
      mathematicalKind: 'pole',
    }
    state.avoidances = [{ ...createAvoidanceFixture().avoidances[0], radius: 5e304 }]
    const snapshot = JSON.stringify(state)
    expect(resolveScene(state).ok).toBe(true)
    expect(validateAvoidances(state).ok).toBe(true)
    expect(JSON.stringify(state)).toBe(snapshot)
  })

  it.each([false, true])(
    'does not cull a genuine connector crossing of an ill-conditioned arc, reversed %s',
    (reverse) => {
      const state = illConditionedScene(reverse, false)
      const result = resolveScene(state)
      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error(result.error)
      const entry = result.scene.connectionSegments.find(
        (s) => s.origin.kind === 'avoidance' && s.origin.part === 'entry',
      )!
      const ordinary = state.segments[0]
      expect(
        intersections.intersectEdges(
          {
            ...entry,
            start: result.scene.points.get(entry.startId)!,
            end: result.scene.points.get(entry.endId)!,
          },
          {
            ...ordinary,
            start: result.scene.points.get(ordinary.startId)!,
            end: result.scene.points.get(ordinary.endId)!,
          },
        ).kind,
      ).toBe('points')
      expectConflict(state, 'avoid-1', 'link', 'ordinary')
    },
  )

  it.each([false, true])(
    'rejects a genuine semicircle crossing of an ill-conditioned arc, reversed %s',
    (reverse) => {
      expectConflict(illConditionedScene(reverse, true), 'avoid-1', 'link', 'ordinary')
    },
  )

  it.each([false, true])(
    'accepts a separated semicircle beside an ill-conditioned arc, reversed %s',
    (reverse) => {
      const state = illConditionedScene(reverse, true)
      state.markers = state.markers.map((p) => ({ ...p, re: p.re + 1024 }))
      const snapshot = JSON.stringify(state)
      expect(validateAvoidances(state).ok).toBe(true)
      expect(JSON.stringify(state)).toBe(snapshot)
    },
  )

  it('rejects the generated circle crossing the actual rectangle top at im = 3', () => {
    const state = createAvoidanceFixture()
    state.markers[0].im = 2.8
    // Circle center (0, 2.8), r = .5 intersects y = 3 at x = ±sqrt(.21).
    // Both intersections lie on the major arc, beyond its ±.25 endpoint x values.
    expect(state.vertices.filter((p) => p.id === 'c' || p.id === 'd').map((p) => p.im)).toEqual([
      3, 3,
    ])
    expectConflict(state, 'avoid-1', 'edge-a', 'edge-c')
  })

  it('ignores unbound markers even when they lie on the generated arc', () => {
    const state = createAvoidanceFixture()
    state.markers.push({ ...state.markers[0], id: 'unbound', im: 0.5, mathematicalKind: 'branch' })
    const snapshot = JSON.stringify(state)
    const result = validateAvoidances(state)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error)
    expect(result.scene.contourSegments.map((s) => s.id)).toEqual([
      'gap:edge-a:before:avoid-1',
      'avoid:avoid-1:arc',
      'gap:edge-a:after:avoid-1',
      'edge-b',
      'edge-c',
      'edge-d',
    ])
    expect(result.scene.connectionSegments).toEqual([])
    expect(result.scene.points.get('unbound')).toBe(state.markers[1])
    expect(JSON.stringify(state)).toBe(snapshot)
  })

  it.each([
    ['overlapping', 0.8],
    ['touching', 1],
    ['within tolerance', 1 + 1e-10],
  ])('rejects %s full-radius footprints on the same source', (_name, separation) => {
    const state = createAvoidanceFixture()
    // Staggered heights keep the generated parts disjoint even though their
    // full-radius footprints conflict (actual openings only have width .5).
    state.markers[0].im = 1
    state.markers.push({ ...state.markers[0], id: 'second', re: separation, im: 2 })
    state.avoidances.unshift({ ...state.avoidances[0], id: 'avoid-2', markerId: 'second' })
    expectConflict(state, 'edge-a', 'avoid-1', 'avoid-2')
  })

  it('accepts separated footprints and preserves the positive gap between bindings', () => {
    const state = createAvoidanceFixture()
    state.markers.push({ ...state.markers[0], id: 'second', re: 1.01 })
    state.avoidances.unshift({ ...state.avoidances[0], id: 'avoid-2', markerId: 'second' })
    const result = validateAvoidances(state)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error)
    const chain = result.scene.chains.get('edge-a')!
    expect(chain.map((s) => s.origin.kind)).toEqual(['gap', 'avoidance', 'gap', 'avoidance', 'gap'])
    expect(result.scene.points.get(chain[2].startId)?.re).toBe(0.5)
    expect(result.scene.points.get(chain[2].endId)?.re).toBe(0.51)
  })

  it.each([
    ['crossing', 0.4],
    ['tangent', 0.5],
  ])('rejects a generated arc %s an independent line', (_name, height) => {
    const state = createAvoidanceFixture()
    addConnection(state, { re: -1, im: height }, { re: 1, im: height })
    expectConflict(state, 'avoid-1', 'edge-a', 'link')
  })

  it('rejects overlap between a generated arc and a source arc', () => {
    const state = createAvoidanceFixture()
    addConnection(state, { re: -0.5, im: 0 }, { re: 0.5, im: 0 }, { re: 0, im: 0.5 })
    expectConflict(state, 'avoid-1', 'edge-a', 'link')
  })

  it.each([
    ['crossing', { re: -0.5, im: 1 }, { re: 0, im: 1 }],
    ['overlapping', { re: -0.25, im: 0.5 }, { re: -0.25, im: 1 }],
  ] as const)('rejects %s involving an entry connector, not only the arc', (_name, start, end) => {
    const state = createAvoidanceFixture()
    state.markers[0].im = 2
    addConnection(state, start, end)
    expectConflict(state, 'avoid-1', 'edge-a', 'link')
  })

  it('rejects equal-coordinate endpoint contact with different endpoint IDs', () => {
    const state = createAvoidanceFixture()
    addConnection(state, { re: -0.5, im: 0 }, { re: -0.5, im: -1 })
    expectConflict(state, 'avoid-1', 'link')
  })

  it.each([0, 2])('accepts legal shared-ID joints with marker offset %s', (height) => {
    const state = createAvoidanceFixture()
    state.markers[0].im = height
    expect(validateAvoidances(state).ok).toBe(true)
  })

  it('retains ordinary source and gap crossings, touches and overlaps', () => {
    const state = createAvoidanceFixture()
    // This source connection crosses the retained bottom gap at (-2, 0).
    addConnection(state, { re: -2, im: -1 }, { re: -2, im: 1 })
    state.markers.push(
      { ...state.markers[0], id: 'gap-start', re: -3 },
      { ...state.markers[0], id: 'gap-end', re: -1 },
    )
    state.connections.push({
      id: 'old-overlap',
      kind: 'line',
      startId: 'gap-start',
      endId: 'gap-end',
    })
    expect(validateAvoidances(state).ok).toBe(true)
    state.avoidances = []
    expect(validateAvoidances(state).ok).toBe(true)
  })

  it.each([
    ['tangent', 1],
    ['overlapping', 0],
    ['crossing', 0.8],
  ])('rejects %s generated arcs belonging to different source paths', (_name, height) => {
    const state = createAvoidanceFixture()
    state.closed = false
    state.segments = state.segments.slice(0, 1)
    addConnection(state, { re: -4, im: height }, { re: 4, im: height })
    state.markers.push({ ...state.markers[0], id: 'second', im: height })
    state.avoidances.push({
      ...state.avoidances[0],
      id: 'avoid-2',
      markerId: 'second',
      targetSegmentId: 'link',
      side: 'right',
    })
    if (height === 0) state.avoidances[1].side = 'left'
    expectConflict(state, 'avoid-1', 'edge-a', 'link')
  })

  it('ignores hidden generated crossings until the closing edge is visible again', () => {
    const state = createAvoidanceFixture()
    state.closed = false
    state.avoidances[0].targetSegmentId = 'edge-d'
    state.markers[0] = { ...state.markers[0], re: 0, im: 1.5 }
    addConnection(state, { re: -1, im: 1.5 }, { re: 1, im: 1.5 })
    const result = validateAvoidances(state)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error)
    expect(result.scene.chains.has('edge-d')).toBe(false)
    expectConflict({ ...state, closed: true }, 'avoid-1', 'edge-d', 'link')
  })

  it('validates individual geometry of a hidden binding and forwards its contextual error', () => {
    const state = createAvoidanceFixture()
    state.closed = false
    state.avoidances[0].targetSegmentId = 'edge-d'
    state.markers[0] = { ...state.markers[0], re: -4, im: 1.5 }
    state.avoidances[0].radius = 2
    const snapshot = JSON.stringify(state)
    expect(validateAvoidances(state)).toMatchObject({
      ok: false,
      error: expect.stringMatching(/avoid-1.*edge-d.*半径/),
    })
    expect(JSON.stringify(state)).toBe(snapshot)
  })

  it('uses circle extrema rather than endpoint/through-point bounds for source arcs', () => {
    const state = createAvoidanceFixture()
    // Right-hand arc of the unit circle centered at (0, 1.5), traversed clockwise.
    // Its x maximum is 1, not the x=.6 of either endpoint or the chosen through point.
    state.markers[0] = { ...state.markers[0], re: 1.4, im: 1.5 }
    state.avoidances[0].radius = 0.5
    addConnection(state, { re: 0.6, im: 2.3 }, { re: 0.6, im: 0.7 }, { re: 0.8, im: 2.1 })
    expectConflict(state, 'avoid-1', 'link')
  })

  it('accepts disjoint finite arcs whose full supporting circles intersect', () => {
    const state = createAvoidanceFixture()
    addConnection(state, { re: -0.5, im: 0 }, { re: 0.5, im: 0 }, { re: 0, im: -0.5 })
    // Move source endpoints away from the avoidance endpoints so no contact remains.
    state.markers.find((p) => p.id === 'link-start')!.re = -0.4
    state.markers.find((p) => p.id === 'link-end')!.re = 0.4
    expect(validateAvoidances(state).ok).toBe(true)
  })

  it.each([
    [1e-7, 0],
    [1e7, 0],
    [1 / 1024, 2 ** 20],
  ])(
    'preserves valid joints and actual crossings at scale %s and translation %s',
    (scale, offset) => {
      for (const crossing of [false, true]) {
        const state = createAvoidanceFixture()
        if (crossing) state.markers[0].im = 2.8
        // Diameter openings and a binary translated scale keep the radius exactly
        // representable; the kernel deliberately rejects numerically unstable fits.
        state.avoidances[0].openingRatio = 1
        const transform = (p: ComplexPoint) => ({
          re: offset + scale * p.re,
          im: offset + scale * p.im,
        })
        state.vertices = state.vertices.map((p) => ({ ...p, ...transform(p) }))
        state.markers = state.markers.map((p) => ({ ...p, ...transform(p) }))
        state.avoidances[0].radius *= scale
        const resolved = resolveScene(state)
        expect(resolved.ok, resolved.ok ? '' : resolved.error).toBe(true)
        expect(validateAvoidances(state).ok).toBe(!crossing)
      }
    },
  )

  it('culls 10000 disjoint source edges before exact intersection while checking real joints', () => {
    const state = createAvoidanceFixture()
    for (let index = 0; index < 10000; index++) {
      const startId = `start-${index}`,
        endId = `end-${index}`
      state.markers.push(
        { ...state.markers[0], id: startId, re: -1, im: 10 + index },
        { ...state.markers[0], id: endId, re: 1, im: 10 + index },
      )
      state.connections.push({ id: `line-${index}`, kind: 'line', startId, endId })
    }
    // Calls pass through to the real analytic intersector. The bound is an
    // explicit broadphase contract, not a timing assertion or mocked result.
    const exact = vi.spyOn(intersections, 'intersectEdges')
    try {
      const result = validateAvoidances(state)
      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error(result.error)
      expect(result.scene.connectionSegments).toHaveLength(10000)
      expect(exact).toHaveBeenCalledTimes(2)
    } finally {
      exact.mockRestore()
    }
  })
})
