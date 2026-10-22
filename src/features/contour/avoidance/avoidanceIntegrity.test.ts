import { expect, it } from 'vitest'
import {
  createConnectedFixture,
  createRectangleConnectedFixture,
} from '../../../test/connectedAvoidanceFixtures'
import { arcThrough } from '../../../lib/arc'
import { contourReducer } from '../model'
import { constructAvoidances } from './avoidanceConstructionTable'
import { validateAvoidances } from './avoidanceValidation'
import { resolvedScene } from '../scene/sceneObjects'
import { serializeProject } from '../../project/format'
import { parseProject } from '../../project/project'

it('rejects a disk-contact merge that would consume a distant major source arc', () => {
  const state = createRectangleConnectedFixture()
  state.closed = false
  state.vertices = [
    { id: 'a', re: -2, im: 0 },
    { id: 'b', re: -0.1, im: 0 },
    { id: 'c', re: 0.1, im: 0 },
    { id: 'd', re: 2, im: 0 },
  ]
  state.segments = [
    { id: 'left', kind: 'line', startId: 'a', endId: 'b' },
    { id: 'outer', kind: 'arc', startId: 'b', endId: 'c', through: { re: 0, im: 10 } },
    { id: 'right', kind: 'line', startId: 'c', endId: 'd' },
  ]
  state.markers[0] = { ...state.markers[0], re: 0, im: 0 }
  state.avoidances = [
    {
      id: 'parent',
      kind: 'corridor',
      markerId: 'center',
      radius: 0.4,
      gap: 0.2,
      anchor: { kind: 'segment', segmentId: 'outer', t: 0.5 },
      alignment: { kind: 'direction', angle: 90 },
    },
  ]
  expect(validateAvoidances(state).ok).toBe(false)
  expect(() => parseProject(serializeProject(state))).toThrow()
})

it.each([-0.4, 0.4])(
  'reuses a real source joint when the boundary detour touches it at x=%s',
  (re) => {
    const state = createRectangleConnectedFixture()
    state.markers[0].im = 0
    state.vertices.splice(1, 0, { id: 'joint', re, im: 0 })
    state.segments[0] = { ...state.segments[0], endId: 'joint' }
    state.segments.splice(1, 0, { id: 'edge-joint', kind: 'line', startId: 'joint', endId: 'b' })
    state.avoidances = [
      {
        id: 'parent',
        kind: 'corridor',
        markerId: 'center',
        radius: 0.4,
        gap: 0.2,
        anchor:
          re < 0
            ? { kind: 'segment', segmentId: 'edge-joint', t: 0.4 / 2.4 }
            : { kind: 'segment', segmentId: 'edge-a', t: 2 / 2.4 },
        alignment: { kind: 'normal', angle: 270 },
      },
    ]
    const result = validateAvoidances(state)
    expect(result.ok, result.ok ? '' : result.error).toBe(true)
    const arc = resolvedScene(state).contourSegments.find((s) => s.id === 'avoid:parent:arc')!
    expect(re < 0 ? arc.startId : arc.endId).toBe('joint')
    expect(parseProject(serializeProject(state)).avoidances).toEqual(state.avoidances)
  },
)

it('rejects a nonexistent vertex anchor during both scene validation and project reading', () => {
  const state = createRectangleConnectedFixture()
  state.markers[0] = { ...state.markers[0], re: 2, im: 0.1 }
  state.avoidances = [
    {
      id: 'parent',
      kind: 'corridor',
      markerId: 'center',
      radius: 0.4,
      gap: 0.2,
      anchor: { kind: 'vertex', segmentId: 'edge-a', vertexId: 'missing' },
      alignment: { kind: 'direction', angle: -90 },
    },
  ]
  expect(validateAvoidances(state).ok).toBe(false)
  expect(() => parseProject(serializeProject(state))).toThrow(/接入|锚点|顶点/)
})

it('recomputes the normal contact when the bound source arc through-point changes', () => {
  let state = createConnectedFixture()
  state.avoidances = state.avoidances.map((a) =>
    a.kind === 'corridor' ? { ...a, alignment: { kind: 'normal' as const } } : a,
  )
  state = contourReducer(state, {
    type: 'moveObject',
    kind: 'marker',
    id: 'center',
    point: { re: 0.2, im: 0.4 },
  })
  const next = contourReducer(state, {
    type: 'moveThrough',
    id: 'upper',
    point: { re: 0, im: 1.2 },
  })
  expect(next.error).toBe('')
  const source = arcThrough(next.vertices[0], next.vertices[1], { re: 0, im: 1.2 })
  const table = constructAvoidances(next)
  if (!source.ok || !table.ok) throw new Error('Expected valid source and detour')
  const direction = table.value.parents.get('parent')!.bankPair!.direction
  const dx = 0.2 - source.arc.center.re,
    dy = 0.4 - source.arc.center.im
  expect(direction.re).toBeCloseTo(dx / Math.hypot(dx, dy), 9)
  expect(direction.im).toBeCloseTo(dy / Math.hypot(dx, dy), 9)
})
