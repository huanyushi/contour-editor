import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { ProjectName } from './ProjectName'

function Name({ busy = false }: { busy?: boolean }) {
  const [name, setName] = useState('原项目')
  return <ProjectName name={name} onChange={setName} busy={busy} />
}

describe('inline project name', () => {
  it('commits a trimmed name on Enter and restores button focus', async () => {
    const user = userEvent.setup()
    render(<Name />)
    await user.click(screen.getByRole('button', { name: '重命名项目' }))
    const input = screen.getByRole('textbox', { name: '项目名称' })
    expect(input).toHaveFocus()
    expect(input).toHaveAttribute('maxlength', '100')
    await user.clear(input)
    await user.type(input, '  Keyhole Contour  {Enter}')
    expect(screen.getByRole('button', { name: '重命名项目' })).toHaveTextContent('Keyhole Contour')
    expect(screen.getByRole('button', { name: '重命名项目' })).toHaveFocus()
  })

  it('cancels on Escape and resets blank names to Untitled on blur', async () => {
    const user = userEvent.setup()
    render(<Name />)
    const button = () => screen.getByRole('button', { name: '重命名项目' })
    await user.click(button())
    await user.type(screen.getByRole('textbox'), '变更{Escape}')
    expect(button()).toHaveTextContent('原项目')
    await user.click(button())
    await user.clear(screen.getByRole('textbox'))
    await user.type(screen.getByRole('textbox'), '   ')
    await user.tab()
    expect(button()).toHaveTextContent('Untitled')
    await user.click(button())
    await user.clear(screen.getByRole('textbox'))
    await user.type(screen.getByRole('textbox'), '失焦提交')
    await user.tab()
    expect(button()).toHaveTextContent('失焦提交')
  })

  it('resets a cleared name to Untitled on Enter', async () => {
    const user = userEvent.setup()
    render(<Name />)
    await user.click(screen.getByRole('button', { name: '重命名项目' }))
    await user.clear(screen.getByRole('textbox', { name: '项目名称' }))
    await user.keyboard('{Enter}')
    expect(screen.getByRole('button', { name: '重命名项目' })).toHaveTextContent('Untitled')
  })

  it('does not treat IME candidate confirmation as a submission', async () => {
    const user = userEvent.setup()
    render(<Name />)
    await user.click(screen.getByRole('button', { name: '重命名项目' }))
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: '中文名称' } })
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
    expect(input).toHaveFocus()
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 })
    expect(input).toBeInTheDocument()
    await user.keyboard('{Enter}')
    expect(screen.getByRole('button', { name: '重命名项目' })).toHaveTextContent('中文名称')
  })

  it('locks editing without native disabled during a gesture', async () => {
    const user = userEvent.setup()
    render(<Name busy />)
    const button = screen.getByRole('button', { name: '重命名项目' })
    expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(button).not.toBeDisabled()
    await user.click(button)
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })
})
