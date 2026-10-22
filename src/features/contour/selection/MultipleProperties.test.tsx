import { useReducer } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { createAvoidanceFixture } from '../../../test/avoidanceFixtures'
import { defaultLabel } from '../appearance'
import { contourReducer } from '../model'
import { MultipleProperties } from './MultipleProperties'

it('shows mixed resolved part widths and labels, then applies the shared ColorField and sliders', () => {
  const initial = createAvoidanceFixture()
  initial.avoidances[0].partStyles = { arc: { width: 5, color: '#123456' } }
  initial.avoidances[0].partLabels = {
    arc: defaultLabel('A'),
    entry: { ...defaultLabel('E'), size: 24 },
  }
  initial.selection = {
    kind: 'multiple',
    items: [
      { kind: 'segment', id: 'avoid:avoid-1:arc' },
      { kind: 'segment', id: 'avoid:avoid-1:entry' },
      { kind: 'segment', id: 'avoid:avoid-1:arc', part: 'label' },
      { kind: 'segment', id: 'avoid:avoid-1:entry', part: 'label' },
    ],
  }
  function Editor() {
    const [state, dispatch] = useReducer(contourReducer, initial)
    return <MultipleProperties state={state} dispatch={dispatch} />
  }
  render(<Editor />)
  expect(screen.getAllByText('多种')).toHaveLength(2)
  expect(screen.getByRole('slider', { name: '所选线宽' })).toHaveValue('5')
  expect(screen.getByText('颜色不一')).toBeVisible()
  fireEvent.change(screen.getByRole('slider', { name: '所选线宽' }), { target: { value: '4' } })
  expect(screen.getByText('4 px')).toBeVisible()
  fireEvent.change(screen.getByRole('slider', { name: '所选文字字号' }), {
    target: { value: '20' },
  })
  expect(screen.queryByText('多种')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '所选对象颜色：蓝色' }))
  expect(screen.getByRole('button', { name: '所选对象颜色：蓝色' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
})
