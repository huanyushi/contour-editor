import { useReducer } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it } from 'vitest'
import { contourReducer, createInitialState, type ContourState } from './model'
import { ObjectList } from './ObjectList'

function fixture(): ContourState {
  const state = createInitialState()
  const [start, end, opposite] = state.vertices
  state.segments[1] = { ...state.segments[1], kind: 'arc', through: { re: 5, im: 0 } }
  state.connections = [
    { id: 'connection-line', kind: 'line', startId: start.id, endId: opposite.id },
    {
      id: 'connection-arc',
      kind: 'arc',
      startId: end.id,
      endId: opposite.id,
      through: { re: 0, im: 4 },
    },
  ]
  return state
}

it('renders decorative non-focusable SVG icons without obscuring object names or statuses', () => {
  render(<ObjectList state={fixture()} dispatch={() => {}} />)

  for (const name of [
    '整体围道 闭合',
    '选择路径段 1',
    '选择路径段 2',
    '选择独立路径段 1',
    '选择独立路径段 2',
  ]) {
    const row = screen.getByRole('button', { name })
    const icon = row.querySelector('svg')
    expect(icon, name).not.toBeNull()
    expect(icon).toHaveAttribute('aria-hidden', 'true')
    expect(icon).toHaveAttribute('focusable', 'false')
    expect(row).not.toHaveTextContent(/[▱⌒╱]/)
  }
  expect(screen.getByRole('button', { name: '选择路径段 2' })).toHaveTextContent('圆弧')
  expect(screen.getByRole('button', { name: '选择独立路径段 1' })).toHaveTextContent('线段 1')
})

it('keeps row keyboard activation and modifier multi-selection working with icons', async () => {
  const user = userEvent.setup()
  function Editor() {
    const [state, dispatch] = useReducer(contourReducer, fixture())
    return <ObjectList state={state} dispatch={dispatch} />
  }
  render(<Editor />)
  const line = screen.getByRole('button', { name: '选择路径段 1' })
  const arc = screen.getByRole('button', { name: '选择路径段 2' })
  line.focus()
  await user.keyboard('{Enter}')
  expect(line).toHaveClass('selected')
  await user.keyboard('{Control>}')
  await user.click(arc.querySelector('svg')!)
  await user.keyboard('{/Control}')
  expect(line).toHaveClass('selected')
  expect(arc).toHaveClass('selected')
  await user.click(screen.getByRole('button', { name: '整体围道 闭合' }))
  expect(line).not.toHaveClass('selected')
  expect(arc).not.toHaveClass('selected')
})
