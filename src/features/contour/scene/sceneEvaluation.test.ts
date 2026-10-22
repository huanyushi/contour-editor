import { afterEach, expect, it, vi } from 'vitest'
import * as construction from '../avoidance/avoidanceConstructionTable'
import { createConnectedFixture } from '../../../test/connectedAvoidanceFixtures'
import { validateAvoidances } from '../avoidance/avoidanceValidation'
import { projectSceneError } from '../../project/validation'
import { canProjectScene, fitScene } from './sceneView'
import { resolveScene } from './resolvedScene'
import { parseProject } from '../../project/project'
import { serializeProject } from '../../project/format'

afterEach(() => vi.restoreAllMocks())

it.each(['validate', 'accept', 'fit'] as const)(
  'constructs parent/child geometry only once per %s check',
  (operation) => {
    const state = createConnectedFixture({ clearanceRadius: 0.12 })
    const spy = vi.spyOn(construction, 'constructAvoidances')
    if (operation === 'validate') expect(validateAvoidances(state).ok).toBe(true)
    if (operation === 'accept') expect(projectSceneError(state)).toBe('')
    if (operation === 'fit') expect(fitScene(state)).not.toBeNull()
    expect(spy).toHaveBeenCalledTimes(1)
  },
)

it('never reuses a valid scene for a different candidate or skips source and projection safety', () => {
  const state = createConnectedFixture({ clearanceRadius: 0.12 })
  expect(projectSceneError(state)).toBe('')
  const invalidSource = {
    ...state,
    segments: state.segments.map((s, i) => (i ? s : { ...s, startId: 'missing' })),
  }
  expect(projectSceneError(invalidSource)).toMatch(/端点引用/)
  const crossed = {
    ...state,
    markers: state.markers.map((m) => (m.id === 'pole' ? { ...m, re: 0.05 } : m)),
  }
  expect(projectSceneError(crossed)).not.toBe('')
  expect(projectSceneError(state)).toBe('')
  expect(canProjectScene(state, { ...state.viewport, scaleX: Infinity })).toBe(false)
  expect(parseProject(serializeProject(state)).avoidances).toEqual(state.avoidances)
  const scene = resolveScene(state)
  if (!scene.ok) throw new Error(scene.error)
  // Two source remnants, two banks with line/child-arc/line, one parent arc.
  expect(scene.scene.contourSegments).toHaveLength(9)
  const arc = scene.scene.contourSegments.find((s) => s.id === 'avoid:parent:arc')!
  expect(arc.kind).toBe('arc')
})
