import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { defaultStroke } from './appearance'
import { StrokeFields } from './StyleFields'

it('edits arrow appearance and hides only the arrow-specific controls when disabled', () => {
  function Editor() {
    const [style, setStyle] = useState(defaultStroke)
    return <StrokeFields value={style} onChange={(patch) => setStyle({ ...style, ...patch })} />
  }
  render(<Editor />)
  fireEvent.change(screen.getByRole('combobox', { name: '方向箭头形状' }), {
    target: { value: 'latex' },
  })
  expect(screen.getByRole('combobox', { name: '方向箭头形状' })).toHaveValue('latex')
  const size = screen.getByRole('slider', { name: '方向箭头大小' })
  expect(size).toHaveAttribute('min', '6')
  expect(size).toHaveAttribute('max', '20')
  fireEvent.change(size, { target: { value: '18' } })
  expect(size).toHaveValue('18')
  fireEvent.click(screen.getByRole('checkbox', { name: '显示方向箭头' }))
  expect(screen.queryByRole('combobox', { name: '方向箭头形状' })).toBeNull()
  expect(screen.getByRole('slider', { name: '线条粗细' })).toBeVisible()
  fireEvent.click(screen.getByRole('checkbox', { name: '显示方向箭头' }))
  expect(screen.getByRole('slider', { name: '方向箭头大小' })).toHaveValue('18')
})
