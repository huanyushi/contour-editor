import { act, renderHook } from '@testing-library/react'
import { useReducer } from 'react'
import { expect, it } from 'vitest'
import {
  createConnectedFixture,
  createRectangleConnectedFixture,
} from '../../test/connectedAvoidanceFixtures'
import { serializeProject } from '../project/format'
import { constructAvoidances } from './avoidanceConstructionTable'
import { avoidanceDirectionPatch } from './avoidanceParameters'
import { createHistory, historyReducer } from './history'
import { contourReducer, type ContourState } from './model'
import { resolvedScene } from './sceneObjects'
import { useAvoidanceDraft } from './useAvoidanceDraft'

function editor(state: ContourState, sourceId: string, point?: { re: number; im: number }) {
  state.avoidances = []
  const hook = renderHook(() => {
    const [history, dispatch] = useReducer(historyReducer, state, createHistory)
    return { history, dispatch, workflow: useAvoidanceDraft(history.present, dispatch) }
  })
  act(() => hook.result.current.workflow.start('center'))
  act(() => hook.result.current.workflow.pickTarget(sourceId, point))
  const move = (re: number, im: number) =>
    act(() =>
      hook.result.current.dispatch({
        type: 'moveObject',
        kind: 'marker',
        id: 'center',
        point: { re, im },
      }),
    )
  return { ...hook, move }
}

it.each([false, true])(
  'keeps the rectangle preview normal while moving the pole and matches apply, reversed=%s',
  (reversed) => {
    let source = createRectangleConnectedFixture()
    source.avoidances = []
    if (reversed) source = contourReducer(source, { type: 'reverse' })
    const { result, move } = editor(source, 'edge-a')
    const draft = result.current.workflow.draft
    if (draft.kind !== 'configure') throw new Error('Expected configured preview')
    const { radius } = draft.avoidance
    move(0.7, 1)
    expect(result.current.workflow.preview?.ok).toBe(true)
    expect(result.current.workflow.draft).toMatchObject({
      avoidance: { anchor: { t: expect.closeTo(reversed ? 0.325 : 0.675, 9) }, radius },
    })
    const table = constructAvoidances(result.current.workflow.previewDocument!)
    if (!table.ok) throw new Error(table.error)
    expect(table.value.parents.get(draft.avoidance.id)!.bankPair!.direction.re).toBeCloseTo(0, 9)
    move(0.7, 0)
    expect(result.current.workflow.preview?.ok).toBe(true)
    const boundary = constructAvoidances(result.current.workflow.previewDocument!)
    if (!boundary.ok) throw new Error(boundary.error)
    expect(boundary.value.parents.get(draft.avoidance.id)!.geometry.through.im).toBeGreaterThan(0)
    move(0.5, 1)
    const preview = result.current.workflow.preview
    if (!preview?.ok) throw new Error('Expected valid followed preview')
    const beforeApply = serializeProject(result.current.history.present)
    expect(JSON.parse(beforeApply).document.avoidances).toBeUndefined()
    const past = result.current.history.past.length
    act(() => result.current.workflow.apply())
    expect(result.current.history.present.error).toBe('')
    expect(result.current.history.past).toHaveLength(past + 1)
    expect(resolvedScene(result.current.history.present).contourSegments).toEqual(
      preview.scene.contourSegments,
    )
  },
)

it('follows a circular preview radially, remembers its direction at the center and can reach the seam', () => {
  const { result, move } = editor(createConnectedFixture(), 'upper', { re: 1, im: 0 })
  move(0.3, 0.4)
  const table = constructAvoidances(result.current.workflow.previewDocument!)
  if (!table.ok) throw new Error(table.error)
  const parent = [...table.value.parents.values()][0]
  expect(parent.bankPair!.direction).toMatchObject({
    re: expect.closeTo(0.6, 9),
    im: expect.closeTo(0.8, 9),
  })
  const draft = result.current.workflow.draft
  if (draft.kind !== 'configure' || draft.avoidance.kind !== 'corridor')
    throw new Error('Expected corridor')
  const anchor = draft.avoidance.anchor
  move(0, 0)
  expect(result.current.workflow.draft).toMatchObject({ avoidance: { anchor } })
  move(1, 0)
  expect(result.current.workflow.preview?.ok).toBe(true)
  expect(result.current.history.present.avoidances).toEqual([])
})

it('keeps a manually directed preview at its mathematical angle while moving the pole', () => {
  const { result, move } = editor(createRectangleConnectedFixture(), 'edge-a')
  const draft = result.current.workflow.draft
  if (draft.kind !== 'configure') throw new Error('Expected configured preview')
  const patch = avoidanceDirectionPatch(
    result.current.workflow.previewDocument!,
    draft.avoidance,
    -65,
  )
  if (!patch.ok) throw new Error(patch.error)
  act(() => result.current.workflow.patch(patch.value))
  move(0.5, 1.2)
  const table = constructAvoidances(result.current.workflow.previewDocument!)
  if (!table.ok) throw new Error(table.error)
  const direction = table.value.parents.get(draft.avoidance.id)!.bankPair!.direction
  expect(direction.re).toBeCloseTo(Math.cos((-65 * Math.PI) / 180), 9)
  expect(direction.im).toBeCloseTo(Math.sin((-65 * Math.PI) / 180), 9)
})

it('keeps an invalid following preview repairable and out of the document', () => {
  const { result, move } = editor(createRectangleConnectedFixture(), 'edge-a')
  move(2.1, 0.1)
  expect(result.current.workflow.draft.kind).toBe('configure')
  expect(result.current.workflow.preview).toMatchObject({
    ok: false,
    error: expect.stringMatching(/法向|有限源/),
  })
  const before = result.current.history.present
  act(() => result.current.workflow.apply())
  expect(result.current.history.present).toBe(before)
  expect(before.avoidances).toEqual([])
  move(0.6, 1)
  expect(result.current.workflow.preview?.ok).toBe(true)
  act(() => result.current.workflow.cancel())
  expect(result.current.history.present.avoidances).toEqual([])
})
