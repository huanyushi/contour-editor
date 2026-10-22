import { expect, it } from 'vitest'
import { createConnectedFixture } from '../../test/connectedAvoidanceFixtures'
import { createAvoidanceFixture } from '../../test/avoidanceFixtures'
import { defaultLabel } from '../contour/appearance'
import { parseProject, serializeProject } from './project'

it('round-trips parents and independent bank appearances in version 4 without derived points', () => {
  const state = createConnectedFixture({ clearanceRadius: 0.1 })
  state.avoidances[1].partStyles = { 'bank-entry': { color: '#112233' }, 'bank-exit': { width: 3 } }
  state.avoidances[1].partLabels = {
    'bank-entry': defaultLabel('C_1'),
    'bank-exit': defaultLabel('C_2'),
  }
  const text = serializeProject(state)
  expect(JSON.parse(text).version).toBe(4)
  const restored = parseProject(text)
  expect(restored.avoidances).toEqual(state.avoidances)
  expect(restored.vertices).toEqual(state.vertices)
  expect(restored.markers).toEqual(state.markers)
})

it('continues to write legacy bindings as version 3', () => {
  const state = createAvoidanceFixture()
  expect(JSON.parse(serializeProject(state)).version).toBe(3)
  expect(parseProject(serializeProject(state)).avoidances).toEqual(state.avoidances)
})

it.each([1, 2, 3])('rejects new declarations incorrectly labeled version %s', (version) => {
  const file = JSON.parse(serializeProject(createConnectedFixture()))
  file.version = version
  expect(() => parseProject(JSON.stringify(file))).toThrow(/版本/)
})

it.each(['missing', 'clearance'])(
  'rejects invalid child parent %s without dropping the child',
  (reference) => {
    const file = JSON.parse(serializeProject(createConnectedFixture({ clearanceRadius: 0.1 })))
    file.document.avoidances[1].parentAvoidanceId = reference
    expect(() => parseProject(JSON.stringify(file))).toThrow()
  },
)

it('rejects invalid gaps, anchors and appearance keys', () => {
  const text = serializeProject(createConnectedFixture({ clearanceRadius: 0.1 }))
  for (const change of [
    (a: Record<string, unknown>[]) => {
      a[0].gap = 0
    },
    (a: Record<string, unknown>[]) => {
      a[0].gap = 0.2
    },
    (a: Record<string, unknown>[]) => {
      a[0].anchor = { kind: 'segment', segmentId: 'upper', t: 2 }
    },
    (a: Record<string, unknown>[]) => {
      a[1].partStyles = { arc: { width: 2 } }
    },
  ]) {
    const file = JSON.parse(text)
    change(file.document.avoidances)
    expect(() => parseProject(JSON.stringify(file))).toThrow()
  }
})

it('accepts children before parents and keeps no-cut child settings', () => {
  const state = createConnectedFixture({ clearanceRadius: 0.01 })
  state.avoidances.reverse()
  expect(parseProject(serializeProject(state)).avoidances).toEqual(state.avoidances)
})

it('loads a rotated translated parent with an exactly tangent no-cut child', () => {
  const state = createConnectedFixture({ clearanceRadius: 0.02 })
  const move = (p: { re: number; im: number }) => ({
    re: 2 + p.re * Math.cos(0.1) - p.im * Math.sin(0.1),
    im: 3 + p.re * Math.sin(0.1) + p.im * Math.cos(0.1),
  })
  state.vertices = state.vertices.map((p) => ({ ...p, ...move(p) }))
  state.markers = state.markers.map((p) => ({ ...p, ...move(p) }))
  state.segments = state.segments.map((s) =>
    s.kind === 'arc' ? { ...s, through: move(s.through) } : s,
  )
  expect(parseProject(serializeProject(state)).avoidances).toEqual(state.avoidances)
})
