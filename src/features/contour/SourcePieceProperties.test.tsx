import { fireEvent, render, screen } from '@testing-library/react'
import { useReducer } from 'react'
import { expect, it } from 'vitest'
import { createRectangleConnectedFixture } from '../../test/connectedAvoidanceFixtures'
import { createHistory, historyReducer } from './history'
import { ObjectProperties } from './ObjectProperties'
import { CanvasScene } from './CanvasScene'
import { sourcePieceId } from './sourcePieces'

it('edits only the selected retained edge and keeps its inspector after a shape edit', () => {
  function Editor() {
    const [history, dispatch] = useReducer(historyReducer, undefined, () => {
      const state = createRectangleConnectedFixture()
      state.selection = {
        kind: 'segment',
        id: sourcePieceId('edge-a', { startAvoidanceId: null, endAvoidanceId: 'parent' }),
      }
      return createHistory(state)
    })
    return (
      <>
        <ObjectProperties state={history.present} dispatch={dispatch} />
        <CanvasScene state={history.present} />
        <button
          onClick={() =>
            dispatch({ type: 'updateAvoidance', id: 'parent', patch: { radius: 0.5 } })
          }
        >
          Change shape
        </button>
        <output aria-label="文档">{JSON.stringify(history.present)}</output>
      </>
    )
  }
  render(<Editor />)
  fireEvent.change(screen.getByLabelText('线条粗细'), { target: { value: '6' } })
  expect(screen.getByTestId('segment-gap:edge-a:before:parent')).toHaveAttribute(
    'stroke-width',
    '6',
  )
  expect(screen.getByTestId('segment-gap:edge-a:after:parent')).toHaveAttribute('stroke-width', '2')
  expect(screen.getByTestId('segment-avoid:parent:entry')).toHaveAttribute('stroke-width', '2')
  fireEvent.click(screen.getByRole('checkbox', { name: '显示方向箭头' }))
  expect(screen.queryByTestId('arrow-gap:edge-a:before:parent')).toBeNull()
  expect(screen.getByTestId('arrow-gap:edge-a:after:parent')).toBeInTheDocument()
  fireEvent.click(screen.getByText('Change shape'))
  expect(screen.getByLabelText('线条粗细')).toHaveValue('6')
  const state = JSON.parse(screen.getByLabelText('文档').textContent!)
  expect(state.error).toBe('')
  expect(state.segments[0].style).toBeUndefined()
})

it('discards an unsubmitted label draft when the reused inspector switches to another piece', () => {
  const beforeId = sourcePieceId('edge-a', { startAvoidanceId: null, endAvoidanceId: 'parent' })
  const afterId = sourcePieceId('edge-a', { startAvoidanceId: 'parent', endAvoidanceId: null })
  function Editor() {
    const [history, dispatch] = useReducer(historyReducer, undefined, () => {
      const state = createRectangleConnectedFixture()
      state.selection = { kind: 'segment', id: beforeId }
      return createHistory(state)
    })
    return (
      <>
        <ObjectProperties state={history.present} dispatch={dispatch} />
        <button onClick={() => dispatch({ type: 'selectSegment', id: afterId })}>
          Select other piece
        </button>
        <output aria-label="文档">{JSON.stringify(history.present)}</output>
      </>
    )
  }
  render(<Editor />)
  fireEvent.change(screen.getByLabelText('LaTeX 标签'), { target: { value: 'C_left' } })
  fireEvent.click(screen.getByText('Select other piece'))
  expect(screen.getByLabelText('LaTeX 标签')).toHaveValue('')
  fireEvent.click(screen.getByRole('button', { name: '应用标签' }))
  const state = JSON.parse(screen.getByLabelText('文档').textContent!)
  expect(state.segments[0].pieces).toHaveLength(1)
  expect(state.segments[0].pieces[0]).toMatchObject({
    startAvoidanceId: 'parent',
    endAvoidanceId: null,
    label: { tex: '' },
  })
})
