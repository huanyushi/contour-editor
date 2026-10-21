import { useReducer } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it } from 'vitest'
import { createAvoidanceFixture } from '../../test/avoidanceFixtures'
import { defaultLabel, type SelectionItem } from './appearance'
import { contourReducer, type ContourState } from './model'
import { createHistory, historyReducer } from './history'
import { PropertiesPanel } from './PropertiesPanel'
import { useAvoidanceDraft } from './useAvoidanceDraft'

const part: SelectionItem = { kind: 'segment', id: 'avoid:avoid-1:arc', part: 'label' }
const gap: SelectionItem = { kind: 'segment', id: 'gap:edge-d:before:avoid-1' }
const gapLabel: SelectionItem = { ...gap, part: 'label' }

function Editor({ initial }: { initial: ContourState }) {
  const [history, dispatch] = useReducer(historyReducer, initial, createHistory)
  const state = history.present
  const workflow = useAvoidanceDraft(state, dispatch)
  return (
    <>
      <button onClick={() => dispatch({ type: 'toggleClosed' })}>切换闭合状态</button>
      <PropertiesPanel
        state={state}
        dispatch={dispatch}
        gestureOwner={null}
        open
        onClose={() => {}}
        avoidanceWorkflow={workflow}
      />
    </>
  )
}

it('restores Inspector focus after keyboard activation replaces the focused hidden-binding entry', async () => {
  const user = userEvent.setup()
  const source = createAvoidanceFixture()
  source.markers[0] = { ...source.markers[0], re: -4, im: 1.5 }
  source.avoidances[0].targetSegmentId = 'edge-d'
  const selected = contourReducer(source, { type: 'selectMany', items: [part, gap] })
  render(<Editor initial={selected} />)
  fireEvent.click(screen.getByRole('button', { name: '切换闭合状态' }))
  const entry = screen.getByRole('button', { name: '编辑暂存绕行 1' })
  entry.focus()
  expect(entry).toHaveFocus()

  await user.keyboard('{Enter}')

  expect(entry).not.toBeInTheDocument()
  expect(screen.getByLabelText('绕行半径')).toHaveValue('0.5')
  await waitFor(() => expect(screen.getByLabelText('属性面板内容')).toHaveFocus())
})

it.each([
  { name: 'part label', items: [part] },
  { name: 'gap', items: [gap] },
  { name: 'gap label', items: [gapLabel] },
  {
    name: 'mixed selection',
    items: [part, gap, gapLabel, { kind: 'marker', id: 'pole' } as SelectionItem],
  },
])(
  'keeps a meaningful explained Inspector for a visible closing $name after opening',
  ({ items }) => {
    const source = createAvoidanceFixture()
    source.markers[0] = { ...source.markers[0], re: -4, im: 1.5 }
    source.avoidances[0].targetSegmentId = 'edge-d'
    source.avoidances[0].partLabels = { arc: defaultLabel('A') }
    source.segments[3] = { ...source.segments[3], label: defaultLabel('S') }
    const selected = contourReducer(source, { type: 'selectMany', items })
    render(<Editor initial={selected} />)
    if (items.length === 1 && items[0] === part)
      expect(screen.getByLabelText('绕行半径')).toHaveValue('0.5')
    fireEvent.click(screen.getByRole('button', { name: '切换闭合状态' }))
    expect(screen.getByText(/暂存.*不显示/)).toBeInTheDocument()
    if (items[0] !== part || items.length > 1)
      fireEvent.click(screen.getByRole('button', { name: /编辑.*绕行 1/ }))
    expect(screen.getByLabelText('绕行半径')).toHaveValue('0.5')
    expect(screen.getByRole('button', { name: '取消绕行' })).toBeEnabled()
    fireEvent.change(screen.getByLabelText('绕行半径'), { target: { value: '0.75' } })
    fireEvent.keyDown(screen.getByLabelText('绕行半径'), { key: 'Enter' })
    expect(screen.getByLabelText('绕行半径')).toHaveValue('0.75')
  },
)
