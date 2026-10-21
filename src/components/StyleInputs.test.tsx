import { useState } from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { ColorField } from './StyleInputs'
import { CUSTOM_PALETTE_KEY } from './customPalette'

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

  it('shows document colors without saving them and opens the picker with the add swatch', async () => {
    const user = userEvent.setup()
    render(<ColorEditor initialValue="#123456" />)
    expect(screen.getByText('自定义 #123456')).toBeVisible()
    expect(screen.queryByRole('button', { pressed: true })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('线条颜色', { exact: true })).not.toBeInTheDocument()
    const more = screen.getByRole('button', { name: '自定义线条颜色' })
    expect(more.textContent).toBe('')
    expect(screen.queryByText('更多…')).not.toBeInTheDocument()
    expect(
      within(screen.getByRole('group', { name: '线条颜色自定义颜色' })).getAllByRole('button'),
    ).toEqual([more])
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

  it('shares only the final native chooser sample across fields and remembers it after remount', async () => {
    const user = userEvent.setup()
    const { unmount } = render(
      <>
        <ColorEditor initialValue="#123456" />
        <ColorField label="填充" name="填充颜色" value="#ffffff" onChange={() => {}} />
      </>,
    )
    await user.click(screen.getByRole('button', { name: '自定义线条颜色' }))
    const picker = screen.getByLabelText('线条颜色', { exact: true })
    for (const value of ['#111111', '#222222', '#333333', '#444444', '#555555', '#abcdef']) {
      fireEvent.input(picker, { target: { value } })
      expect(screen.getByLabelText('已应用颜色')).toHaveTextContent(value)
    }
    fireEvent.change(picker, { target: { value: '#abcdef' } })
    const fillPalette = screen.getByRole('group', { name: '填充颜色自定义颜色' })
    expect(within(fillPalette).getAllByRole('button')).toHaveLength(2)
    expect(within(fillPalette).getByRole('button', { name: /#abcdef/ })).toBeVisible()
    expect(screen.queryByRole('button', { name: /#111111/ })).not.toBeInTheDocument()
    fireEvent.blur(picker)
    unmount()
    render(<ColorEditor initialValue="#263238" />)
    await user.click(screen.getByRole('button', { name: /线条颜色：自定义 #abcdef/ }))
    expect(screen.getByLabelText('已应用颜色')).toHaveTextContent('#abcdef')
    expect(screen.getByLabelText('线条颜色', { exact: true })).toHaveValue('#abcdef')
    expect(screen.getByLabelText('线条颜色', { exact: true })).toHaveFocus()
  })

  it('caps the second row at eight, edits on click, and releases a deleted slot for re-addition', async () => {
    const user = userEvent.setup()
    render(
      <>
        <ColorEditor initialValue="#263238" />
        <ColorField label="填充" name="填充颜色" value="#ffffff" onChange={() => {}} />
      </>,
    )
    const colors = [
      '#111111',
      '#222222',
      '#333333',
      '#444444',
      '#555555',
      '#666666',
      '#777777',
      '#888888',
    ]
    for (const value of colors) {
      await user.click(screen.getByRole('button', { name: '自定义线条颜色' }))
      const picker = screen.getByLabelText('线条颜色', { exact: true })
      fireEvent.change(picker, { target: { value } })
      fireEvent.blur(picker)
      // Close the editor through a preset so the next + starts a new addition.
      await user.click(screen.getByRole('button', { name: '线条颜色：深色' }))
    }
    expect(screen.queryByRole('button', { name: '自定义线条颜色' })).not.toBeInTheDocument()
    const palette = screen.getByRole('group', { name: '线条颜色自定义颜色' })
    expect(within(palette).getAllByRole('button')).toHaveLength(8)
    const first = within(palette).getByRole('button', { name: /#111111/ })
    await user.click(first)
    expect(screen.getByLabelText('已应用颜色')).toHaveTextContent('#111111')
    const picker = screen.getByLabelText('线条颜色', { exact: true })
    expect(picker).toHaveValue('#111111')
    expect(picker).toHaveFocus()
    fireEvent.input(picker, { target: { value: '#aaaaaa' } })
    fireEvent.change(picker, { target: { value: '#abcdef' } })
    fireEvent.blur(picker)
    expect(within(palette).getAllByRole('button')).toHaveLength(8)
    expect(within(palette).queryByRole('button', { name: /#111111/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '删除自定义线条颜色' }))
    expect(screen.getByLabelText('已应用颜色')).toHaveTextContent('#abcdef')
    expect(within(palette).queryByRole('button', { name: /#abcdef/ })).not.toBeInTheDocument()
    const add = screen.getByRole('button', { name: '自定义线条颜色' })
    expect(add).toHaveFocus()
    await user.click(add)
    fireEvent.change(screen.getByLabelText('线条颜色', { exact: true }), {
      target: { value: '#fedcba' },
    })
    expect(within(palette).getAllByRole('button')).toHaveLength(8)
    expect(within(palette).getByRole('button', { name: /#fedcba/ })).toBeVisible()
    expect(within(palette).queryByRole('button', { name: /#abcdef/ })).not.toBeInTheDocument()
    const fillPalette = screen.getByRole('group', { name: '填充颜色自定义颜色' })
    expect(within(fillPalette).getAllByRole('button')).toHaveLength(8)
    expect(within(fillPalette).getByRole('button', { name: /#fedcba/ })).toBeVisible()
    expect(within(fillPalette).queryByRole('button', { name: /#111111/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '自定义线条颜色' })).not.toBeInTheDocument()
  })

  it.each(['{Enter}', ' '])(
    'applies and opens a saved color with normal %s activation',
    async (key) => {
      localStorage.setItem(CUSTOM_PALETTE_KEY, '["#abcdef"]')
      const user = userEvent.setup()
      render(<ColorEditor initialValue="#263238" />)
      screen.getByRole('button', { name: '线条颜色：自定义 #abcdef' }).focus()
      await user.keyboard(key)
      expect(screen.getByLabelText('已应用颜色')).toHaveTextContent('#abcdef')
      expect(screen.getByLabelText('线条颜色', { exact: true })).toHaveValue('#abcdef')
      expect(screen.getByLabelText('线条颜色', { exact: true })).toHaveFocus()
      expect(screen.getByRole('button', { name: '删除自定义线条颜色' })).toBeVisible()
    },
  )

  it('shares persisted deletion without changing the document color or re-saving it on unmount', async () => {
    localStorage.setItem(CUSTOM_PALETTE_KEY, '["#abcdef"]')
    const user = userEvent.setup()
    const { unmount } = render(
      <>
        <ColorEditor initialValue="#263238" />
        <ColorField label="填充" name="填充颜色" value="#abcdef" onChange={() => {}} />
      </>,
    )
    await user.click(screen.getByRole('button', { name: '线条颜色：自定义 #abcdef' }))
    // Delete after a pending native input sample: blur must not leave the entry behind.
    fireEvent.input(screen.getByLabelText('线条颜色', { exact: true }), {
      target: { value: '#123456' },
    })
    await user.click(screen.getByRole('button', { name: '删除自定义线条颜色' }))
    expect(screen.getByLabelText('已应用颜色')).toHaveTextContent('#123456')
    for (const name of ['线条颜色自定义颜色', '填充颜色自定义颜色']) {
      const palette = screen.getByRole('group', { name })
      expect(within(palette).getAllByRole('button')).toHaveLength(1)
      expect(
        within(palette).queryByRole('button', { name: /#abcdef|#123456/ }),
      ).not.toBeInTheDocument()
    }
    expect(screen.getByText('自定义 #abcdef')).toBeVisible()
    unmount()
    expect(JSON.parse(localStorage.getItem(CUSTOM_PALETTE_KEY)!)).toEqual([])
    render(<ColorEditor initialValue="#123456" />)
    expect(screen.getByLabelText('已应用颜色')).toHaveTextContent('#123456')
    expect(
      within(screen.getByRole('group', { name: '线条颜色自定义颜色' })).getAllByRole('button'),
    ).toHaveLength(1)
  })

  it('keeps repeated committed samples from one chooser in a single saved slot', async () => {
    const user = userEvent.setup()
    render(<ColorEditor initialValue="#263238" />)
    await user.click(screen.getByRole('button', { name: '自定义线条颜色' }))
    const picker = screen.getByLabelText('线条颜色', { exact: true })
    for (const value of [
      '#111111',
      '#222222',
      '#333333',
      '#444444',
      '#555555',
      '#666666',
      '#777777',
      '#888888',
      '#999999',
    ]) {
      fireEvent.change(picker, { target: { value } })
    }
    fireEvent.blur(picker)
    const palette = screen.getByRole('group', { name: '线条颜色自定义颜色' })
    expect(within(palette).getAllByRole('button')).toHaveLength(2)
    expect(within(palette).getByRole('button', { name: /#999999/ })).toBeVisible()
  })

  it('starts a new addition on picker reactivation and saves a pending final sample on unmount', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<ColorEditor initialValue="#263238" />)
    await user.click(screen.getByRole('button', { name: '自定义线条颜色' }))
    const picker = screen.getByLabelText('线条颜色', { exact: true })
    await user.click(picker)
    fireEvent.change(picker, { target: { value: '#abcdef' } })
    await user.click(picker)
    fireEvent.input(picker, { target: { value: '#123456' } })
    unmount()
    render(<ColorEditor initialValue="#263238" />)
    const palette = screen.getByRole('group', { name: '线条颜色自定义颜色' })
    expect(within(palette).getAllByRole('button')).toHaveLength(3)
    expect(within(palette).getByRole('button', { name: /#abcdef/ })).toBeVisible()
    expect(within(palette).getByRole('button', { name: /#123456/ })).toBeVisible()
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
