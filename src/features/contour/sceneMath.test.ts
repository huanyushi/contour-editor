import { expect, it } from 'vitest'
import { defaultLabel, defaultPointStyle } from './appearance'
import { createInitialState } from './model'
import { resolveScene } from './resolvedScene'
import { sceneMathTexts } from './sceneMath'
import { createConnectedFixture } from '../../test/connectedAvoidanceFixtures'

it('collects implicit vertices, visible scene labels, measured hidden formulas and axis names', () => {
  const state = createInitialState()
  state.vertices[0].label = undefined
  state.vertices[1].label = { ...defaultLabel('hidden-point'), visible: false }
  state.markers = [
    { id: 'm', re: 0, im: 1, label: defaultLabel('M'), pointStyle: defaultPointStyle() },
  ]
  state.formulas = [
    {
      id: 'f',
      re: 0,
      im: 2,
      label: { ...defaultLabel('hidden-formula'), visible: false },
      pointStyle: defaultPointStyle(),
    },
  ]
  state.segments[0].label = defaultLabel('P')
  state.axes = { ...state.axes, visible: false, reLabel: 'R', imLabel: 'I' }
  const scene = resolveScene(state)
  if (!scene.ok) throw new Error(scene.error)
  const texts = sceneMathTexts(state, [scene.scene])
  for (const text of ['z_{1}', 'M', 'hidden-formula', 'P', 'R', 'I'])
    expect(texts.has(text)).toBe(true)
  expect(texts.has('hidden-point')).toBe(false)
})

it('unites applied and preview path labels and source arc handle names', () => {
  const state = createConnectedFixture()
  state.avoidances[0].partLabels = { arc: defaultLabel('applied') }
  const applied = resolveScene(state)
  const uncut = resolveScene({ ...state, avoidances: [] })
  const preview = resolveScene({
    ...state,
    avoidances: state.avoidances.map((a) => ({
      ...a,
      partLabels: { arc: defaultLabel('preview') },
    })),
  })
  if (!applied.ok || !preview.ok || !uncut.ok) throw new Error('Expected scenes')
  const texts = sceneMathTexts(state, [applied.scene, preview.scene, uncut.scene])
  expect(texts.has('applied')).toBe(true)
  expect(texts.has('preview')).toBe(true)
  expect(texts.has('q_{1}')).toBe(true)
  const withoutHandles = sceneMathTexts({ ...state, handles: false }, [applied.scene])
  expect([...withoutHandles].some((text) => text.startsWith('q_{'))).toBe(false)
})
