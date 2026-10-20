import { useState } from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { ColorField } from './StyleInputs'

function ColorEditor({ initialValue }: { initialValue: string | undefined }) {
  const [color, setColor] = useState(initialValue)
  return (
    <>
      <ColorField label="颜色" name="线条颜色" value={color} onChange={setColor} />
      <output aria-label="已应用颜色">{color ?? 'mixed'}</output>
    </>
  )
}

describe('ColorField', () => {
  it('applies each named preset and marks only the current color as pressed', async () => {
    const user = userEvent.setup()
    render(<ColorEditor initialValue="#263238" />)
    const presets = screen.getByRole('group', { name: '线条颜色预设颜色' })
    expect(within(presets).getAllByRole('button')).toHaveLength(8)

    for (const [name, value] of [
      ['深色', '#263238'],
      ['红色', '#cc3344'],
      ['橙色', '#d97706'],
      ['金色', '#ca8a04'],
      ['青绿色', '#237b6d'],
      ['蓝色', '#2563eb'],
      ['紫色', '#7c3aed'],
      ['灰色', '#66777c'],
    ]) {
      const swatch = within(presets).getByRole('button', { name: `线条颜色：${name}` })
      await user.click(swatch)
      expect(screen.getByLabelText('已应用颜色')).toHaveTextContent(value)
      expect(within(presets).getAllByRole('button', { pressed: true })).toEqual([swatch])
    }
  })

  it('supports tab focus and keyboard activation with the label as the default name', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<ColorField label="点颜色" value="#CC3344" onChange={() => {}} />)
    expect(screen.getByRole('button', { name: '点颜色：红色' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    rerender(<ColorEditor initialValue="#2563eb" />)
    await user.tab()
    expect(screen.getByRole('button', { name: '线条颜色：深色' })).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(screen.getByLabelText('已应用颜色')).toHaveTextContent('#263238')
    await user.tab()
    await user.keyboard(' ')
    expect(screen.getByLabelText('已应用颜色')).toHaveTextContent('#cc3344')
  })

  it('shows an existing custom color and reveals the native picker only through More', async () => {
    const user = userEvent.setup()
    render(<ColorEditor initialValue="#123456" />)
    expect(screen.getByText('自定义 #123456')).toBeVisible()
    expect(screen.queryByRole('button', { pressed: true })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('线条颜色', { exact: true })).not.toBeInTheDocument()
    const more = screen.getByRole('button', { name: '自定义线条颜色' })
    expect(more).toHaveAttribute('aria-expanded', 'false')
    await user.click(more)
    expect(more).toHaveAttribute('aria-expanded', 'true')
    const picker = screen.getByLabelText('线条颜色', { exact: true })
    expect(picker).toBeVisible()
    expect(picker).toHaveAttribute('type', 'color')
    expect(picker).toHaveValue('#123456')
    fireEvent.change(picker, { target: { value: '#abcdef' } })
    expect(screen.getByLabelText('已应用颜色')).toHaveTextContent('#abcdef')
    expect(screen.getByText('自定义 #abcdef')).toBeVisible()
    fireEvent.change(picker, { target: { value: '#2563eb' } })
    expect(screen.getByRole('button', { name: '线条颜色：蓝色' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.queryByText(/自定义 #/)).not.toBeInTheDocument()
    await user.click(more)
    expect(screen.queryByLabelText('线条颜色', { exact: true })).not.toBeInTheDocument()
    expect(more).toHaveFocus()
  })

  it('keeps mixed colors unselected until the user chooses a color', async () => {
    const user = userEvent.setup()
    render(<ColorEditor initialValue={undefined} />)
    expect(screen.getByText('颜色不一')).toBeVisible()
    expect(screen.queryByRole('button', { pressed: true })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '自定义线条颜色' }))
    expect(screen.getByLabelText('已应用颜色')).toHaveTextContent('mixed')
    expect(screen.queryByRole('button', { pressed: true })).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('线条颜色', { exact: true }), {
      target: { value: '#654321' },
    })
    expect(screen.getByLabelText('已应用颜色')).toHaveTextContent('#654321')
    expect(screen.queryByText('颜色不一')).not.toBeInTheDocument()
    expect(screen.getByText('自定义 #654321')).toBeVisible()
    await user.click(screen.getByRole('button', { name: '线条颜色：青绿色' }))
    expect(screen.getByLabelText('已应用颜色')).toHaveTextContent('#237b6d')
    expect(screen.queryByText(/自定义 #/)).not.toBeInTheDocument()
  })
})
