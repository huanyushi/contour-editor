import { act, renderHook } from '@testing-library/react'
import { useReducer } from 'react'
import { expect, it } from 'vitest'
import { createConnectedFixture } from '../../../test/connectedAvoidanceFixtures'
import { createAvoidanceFixture } from '../../../test/avoidanceFixtures'
import { createHistory, historyReducer } from '../history'
import { makeAvoidanceTarget } from './avoidanceTarget'
import { useAvoidanceDraft } from './useAvoidanceDraft'

it('uses the clicked circle location rather than an arbitrary closest point', () => {
  const state = createConnectedFixture()
  state.avoidances = []
  const { result } = renderHook(() => {
    const [history, dispatch] = useReducer(historyReducer, state, createHistory)
    return { history, workflow: useAvoidanceDraft(history.present, dispatch) }
  })
  act(() => result.current.workflow.start('center'))
  act(() => result.current.workflow.pickTarget('upper', { re: 1, im: 0 }))
  expect(result.current.workflow.draft).toMatchObject({
    kind: 'configure',
    avoidance: {
      kind: 'corridor',
      anchor: { kind: 'vertex', vertexId: 'right' },
      radius: 0.1,
      gap: 0.06,
    },
  })
  expect(result.current.workflow.preview?.ok).toBe(true)
  expect(result.current.history.present.avoidances).toEqual([])
  act(() => result.current.workflow.apply())
  expect(result.current.history.past).toHaveLength(1)
  expect(result.current.history.present.avoidances[0].kind).toBe('corridor')
})

it('clicking either generated bank creates the same child binding', () => {
  const state = createConnectedFixture({ clearanceRadius: 0.1 })
  state.avoidances.pop()
  const first = makeAvoidanceTarget(state, 'pole', {
    renderedId: 'avoid:parent:entry',
  })
  const second = makeAvoidanceTarget(state, 'pole', {
    renderedId: 'avoid:parent:exit',
  })
  expect(first).toEqual(second)
  expect(first).toMatchObject({
    ok: true,
    value: { kind: 'bank-clearance', parentAvoidanceId: 'parent' },
  })
})

it('does not reinterpret an unrelated generated arc as its source target', () => {
  const state = createConnectedFixture({ clearanceRadius: 0.1 })
  state.avoidances.pop()
  expect(makeAvoidanceTarget(state, 'pole', { renderedId: 'avoid:parent:arc' }).ok).toBe(false)
})

it('previews a parent gap change and commits it together with its child in one history step', () => {
  const state = createConnectedFixture({ clearanceRadius: 0.1 })
  state.avoidances.pop()
  const { result } = renderHook(() => {
    const [history, dispatch] = useReducer(historyReducer, state, createHistory)
    return { history, dispatch, workflow: useAvoidanceDraft(history.present, dispatch) }
  })
  act(() => result.current.workflow.start('pole'))
  act(() => result.current.workflow.pickTarget('avoid:parent:entry'))
  act(() => result.current.workflow.patchParentGap(0.06))
  expect(result.current.workflow.preview?.ok).toBe(true)
  expect(result.current.workflow.previewDocument!.avoidances[0]).toMatchObject({ gap: 0.06 })
  expect(result.current.history.present.avoidances[0]).toMatchObject({ gap: 0.04 })
  expect(result.current.history.past).toHaveLength(0)
  act(() => result.current.workflow.apply())
  expect(result.current.history.present.avoidances[0]).toMatchObject({ gap: 0.06 })
  expect(result.current.history.present.avoidances).toHaveLength(2)
  expect(result.current.history.past).toHaveLength(1)
  act(() => result.current.dispatch({ type: 'undo' }))
  expect(result.current.history.present.avoidances).toHaveLength(1)
  expect(result.current.history.present.avoidances[0]).toMatchObject({ gap: 0.04 })
})

it('refuses to apply a newly picked detour that needs the retained hidden closing edge', () => {
  const state = createConnectedFixture()
  state.avoidances = []
  state.closed = false
  const { result } = renderHook(() => {
    const [history, dispatch] = useReducer(historyReducer, state, createHistory)
    return { history, workflow: useAvoidanceDraft(history.present, dispatch) }
  })
  act(() => result.current.workflow.start('center'))
  act(() => result.current.workflow.pickTarget('upper', { re: 1, im: 0 }))
  expect(result.current.workflow.preview).toMatchObject({
    ok: false,
    error: expect.stringMatching(/可见|暂存/),
  })
  act(() => result.current.workflow.apply())
  expect(result.current.history.present.avoidances).toEqual([])
})

it('previews and applies a legacy parent spacing edit with its new child using the same geometry', () => {
  const state = createAvoidanceFixture()
  state.markers[0].im = 1
  state.markers.push({ ...state.markers[0], id: 'other', im: 0.25 })
  const { result } = renderHook(() => {
    const [history, dispatch] = useReducer(historyReducer, state, createHistory)
    return { history, workflow: useAvoidanceDraft(history.present, dispatch) }
  })
  act(() => result.current.workflow.start('other'))
  act(() => result.current.workflow.pickTarget('avoid:avoid-1:entry'))
  act(() => result.current.workflow.patch({ radius: 0.27 }))
  act(() => result.current.workflow.patchParentGap(0.4))
  expect(result.current.workflow.preview?.ok).toBe(true)
  expect(result.current.workflow.previewDocument!.avoidances[0]).toMatchObject({
    kind: 'corridor',
    radius: 0.5,
    gap: 0.4,
  })
  expect(result.current.history.present.avoidances[0].kind).toBeUndefined()
  act(() => result.current.workflow.apply())
  expect(result.current.history.present.error).toBe('')
  expect(result.current.history.present.avoidances).toHaveLength(2)
  expect(result.current.history.present.avoidances[0]).toMatchObject({
    kind: 'corridor',
    radius: 0.5,
    gap: 0.4,
  })
  expect(result.current.history.past).toHaveLength(1)
})
