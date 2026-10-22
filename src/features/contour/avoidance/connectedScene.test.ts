import { expect, it } from 'vitest'
import { createConnectedFixture } from '../../../test/connectedAvoidanceFixtures'
import { validateAvoidances } from './avoidanceValidation'
import { resolveScene } from '../scene/resolvedScene'

it('splices a wrapped multi-source interval without restoring the seam', () => {
  const state = createConnectedFixture()
  const original = structuredClone(state.segments)
  const result = validateAvoidances(state)
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(result.error)
  const segments = result.scene.contourSegments
  expect(segments.filter((s) => s.origin.kind === 'gap')).toHaveLength(2)
  expect(segments.filter((s) => s.origin.kind === 'gap').every((s) => s.kind === 'arc')).toBe(true)
  const starts = new Map(segments.map((s) => [s.startId, s.id]))
  for (const s of segments) expect(starts.has(s.endId)).toBe(true)
  expect(new Set(segments.map((s) => s.startId)).size).toBe(segments.length)
  expect(state.segments).toEqual(original)
})

it('renders only post-clearance banks with independent child origins', () => {
  const result = validateAvoidances(createConnectedFixture({ clearanceRadius: 0.1 }))
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(result.error)
  expect(result.scene.origins.get('avoid:clearance:bank-entry')).toMatchObject({
    avoidanceId: 'clearance',
    part: 'bank-entry',
    parentAvoidanceId: 'parent',
  })
  expect(result.scene.origins.get('avoid:clearance:bank-exit')).toMatchObject({
    avoidanceId: 'clearance',
    part: 'bank-exit',
  })
  expect(result.scene.contourSegments.some((s) => s.id === 'avoid:parent:entry')).toBe(false)
  const child = result.scene.contourSegments.filter(
    (s) => s.origin.kind === 'avoidance' && s.origin.avoidanceId === 'clearance',
  )
  expect(child).toHaveLength(2)
  for (const s of child) {
    expect(s.resolvedArc!.radius).toBe(0.1)
    expect(s.resolvedArc!.center).toEqual({ re: 0.5, im: 0 })
    expect(Math.abs(s.resolvedArc!.sweep)).toBeLessThan(Math.PI)
  }
})

it('retains a child without visible cuts and suspends all parents on a hidden dependency', () => {
  const state = createConnectedFixture({ clearanceRadius: 0.01 })
  const visible = resolveScene(state)
  expect(visible.ok).toBe(true)
  if (!visible.ok) throw new Error(visible.error)
  expect(visible.scene.origins.has('avoid:clearance:bank-entry')).toBe(true)
  expect(visible.scene.contourSegments.some((s) => s.id.includes('clearance'))).toBe(false)
  state.closed = false
  const hidden = resolveScene(state)
  expect(hidden.ok).toBe(true)
  if (!hidden.ok) throw new Error(hidden.error)
  expect(hidden.scene.contourSegments.map((s) => s.id)).toEqual(['upper'])
  expect(hidden.scene.origins.has('avoid:clearance:bank-exit')).toBe(true)
})

it('rejects overlapping siblings and is independent of valid sibling order', () => {
  const state = createConnectedFixture({ clearanceRadius: 0.05 })
  state.markers.push({ ...state.markers[1], id: 'pole2', re: 0.75 })
  state.avoidances.push({
    kind: 'bank-clearance',
    id: 'second',
    markerId: 'pole2',
    parentAvoidanceId: 'parent',
    radius: 0.05,
  })
  const first = validateAvoidances(state)
  expect(first.ok).toBe(true)
  state.avoidances.reverse()
  const reversed = validateAvoidances(state)
  expect(reversed.ok).toBe(true)
  if (!first.ok || !reversed.ok) throw new Error('valid siblings')
  expect(reversed.scene.contourSegments).toEqual(first.scene.contourSegments)
  state.markers[2].re = 0.55
  expect(validateAvoidances(state).ok).toBe(false)
})

it('keeps real shared-vertex IDs when rotated ports trim an entire middle segment', () => {
  const state = createConnectedFixture()
  const move = (re: number, im: number) => ({
    re: 2 + re * Math.cos(0.3) - im * Math.sin(0.3),
    im: 3 + re * Math.sin(0.3) + im * Math.cos(0.3),
  })
  state.closed = false
  state.vertices = [-1, -0.02, 0.02, 1].map((re, i) => ({ id: `p${i}`, ...move(re, 0) }))
  state.segments = state.vertices.slice(1).map((p, i) => ({
    id: `s${i}`,
    kind: 'line',
    startId: `p${i}`,
    endId: p.id,
  }))
  state.markers[0] = { ...state.markers[0], ...move(0, 1) }
  state.avoidances = [
    {
      kind: 'corridor',
      id: 'parent',
      markerId: 'center',
      anchor: { kind: 'segment', segmentId: 's1', t: 0.5 },
      radius: 0.1,
      gap: 0.04,
    },
  ]
  const result = validateAvoidances(state)
  expect(result.ok, result.ok ? '' : result.error).toBe(true)
  if (!result.ok) throw new Error(result.error)
  const entry = result.scene.contourSegments.find((s) => s.id === 'avoid:parent:entry')!
  const exit = result.scene.contourSegments.find((s) => s.id === 'avoid:parent:exit')!
  expect(entry.startId).toBe('p1')
  expect(exit.endId).toBe('p2')
  expect(result.scene.points.get(exit.endId)).toBe(state.vertices[2])
  expect(result.scene.contourSegments.map((s) => s.id)).not.toContain('s1')
})
