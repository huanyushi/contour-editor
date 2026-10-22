import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { renderApp } from '../test/renderApp'
import { loadTemplate, selectObject } from '../test/navigation'

describe('contour editor', () => {
  it('preserves input focus when submitting coordinates with Enter', async () => {
    const user = userEvent.setup()
    await renderApp()
    const input = screen.getByLabelText('实部 Re')
    await user.clear(input)
    await user.type(input, '12{Enter}')
    expect(screen.getByLabelText('实部 Re')).toHaveFocus()
    expect(screen.getByLabelText('实部 Re')).toHaveValue('12')
  })
  it('allows keyboard users to append a vertex and edit it', async () => {
    const user = userEvent.setup()
    await renderApp()
    await user.click(screen.getByRole('button', { name: '视图设置' }))
    const add = screen.getByRole('button', { name: '在原点追加顶点' })
    add.focus()
    await user.keyboard('{Enter}')
    expect(screen.getByLabelText('实部 Re')).toHaveValue('0')
    expect(screen.getByLabelText('虚部 Im')).toHaveValue('0')
    await user.click(screen.getByRole('button', { name: '对象列表' }))
    expect(screen.getAllByRole('button', { name: /^选择顶点/ })).toHaveLength(5)
  })
  it('applies precise coordinates and preserves selection when reversing', async () => {
    const user = userEvent.setup()
    await renderApp()
    await user.clear(screen.getByLabelText('实部 Re'))
    await user.type(screen.getByLabelText('实部 Re'), '1.25')
    await user.clear(screen.getByLabelText('虚部 Im'))
    await user.type(screen.getByLabelText('虚部 Im'), '-2')
    await user.click(screen.getByRole('button', { name: '应用坐标' }))
    expect(screen.getByLabelText('实部 Re')).toHaveValue('1.25')
    expect(screen.getByLabelText('虚部 Im')).toHaveValue('-2')
    expect(screen.getByTestId('contour-path')).toHaveAttribute(
      'd',
      expect.stringContaining('450 380'),
    )
    await user.click(screen.getByRole('button', { name: '反转方向' }))
    expect(screen.getByLabelText('实部 Re')).toHaveValue('1.25')
  })
  it('rejects empty input without changing geometry', async () => {
    const user = userEvent.setup()
    await renderApp()
    const original = screen.getByTestId('contour-path').getAttribute('d')
    await user.clear(screen.getByLabelText('实部 Re'))
    await user.click(screen.getByRole('button', { name: '应用坐标' }))
    expect(screen.getByRole('alert')).toBeVisible()
    expect(screen.getByTestId('contour-path')).toHaveAttribute('d', original)
  })
  it('can erase all endpoints and replace the empty canvas with a fresh rectangle', async () => {
    const user = userEvent.setup()
    await renderApp()
    for (let i = 0; i < 4; i++) {
      await selectObject(user, '选择顶点 z1')
      await user.click(screen.getByRole('button', { name: '删除选中顶点' }))
    }
    expect(screen.queryAllByTestId(/^vertex-/)).toHaveLength(0)
    expect(screen.getByTestId('contour-path')).toHaveAttribute('d', '')
    await loadTemplate(user, '矩形围道')
    await user.click(screen.getByRole('button', { name: '围道属性' }))
    expect(screen.getByRole('checkbox', { name: '闭合围道' })).toBeChecked()
    expect(screen.getAllByTestId(/^vertex-/)).toHaveLength(4)
  })
})
