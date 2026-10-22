import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import App from './App'
import { readCanvasWorkspace } from '../features/project/canvasStorage'

async function start() {
  const user = userEvent.setup()
  render(<App />)
  await screen.findByRole('button', { name: '画布与模板' })
  await user.click(screen.getByRole('button', { name: '画布与模板' }))
  return user
}

describe('canvas workspace UI', () => {
  it('keeps Escape closing view settings while a template is displayed', async () => {
    const user = await start()
    await user.click(screen.getByRole('button', { name: '视图设置' }))
    await user.click(screen.getByRole('tab', { name: '示例模板' }))
    await user.click(screen.getByRole('button', { name: '预览圆形围道' }))
    await user.click(screen.getByRole('button', { name: '收起画布与模板' }))
    screen.getByRole('button', { name: '关闭视图设置' }).focus()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('complementary', { name: '视图设置' })).not.toBeInTheDocument()
    expect(screen.getByTestId('contour-canvas')).toHaveFocus()
    expect(screen.getByTestId('contour-path').getAttribute('d')).toContain(' A ')
  })

  it('shows templates on the central canvas and restores the untouched original document and history', async () => {
    const user = await start()
    await user.click(screen.getByRole('button', { name: '反转方向' }))
    const path = screen.getByTestId('contour-path').getAttribute('d')
    await user.click(screen.getByRole('tab', { name: '示例模板' }))
    await user.click(screen.getByRole('button', { name: '预览钥匙孔围道' }))
    await user.click(screen.getByRole('button', { name: '预览圆形围道' }))
    expect(screen.getByTestId('contour-path')).not.toHaveAttribute('d', path)
    expect(screen.getByTestId('contour-path').getAttribute('d')).toContain(' A ')
    expect(screen.queryByText('点击仅预览，不会修改当前画布')).not.toBeInTheDocument()
    expect(screen.queryByRole('img', { name: '圆形围道大预览' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重命名项目' })).toHaveTextContent('Untitled')
    expect(screen.getByRole('button', { name: '撤销' })).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('button', { name: '保存项目' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    expect((await readCanvasWorkspace())?.workspace.canvases).toHaveLength(1)
    await user.click(screen.getByRole('tab', { name: '我的画布' }))
    expect(screen.getByTestId('contour-path')).toHaveAttribute('d', path)
    expect(screen.getByRole('button', { name: '撤销' })).toBeEnabled()
    await user.click(screen.getByRole('tab', { name: '示例模板' }))
    await user.click(screen.getByRole('button', { name: '以此模板新建画布' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '重命名项目' })).toHaveTextContent('圆形围道'),
    )
    expect(screen.getByRole('button', { name: '撤销' })).toBeDisabled()
    await user.click(screen.getByRole('tab', { name: '我的画布' }))
    await user.click(screen.getByRole('button', { name: '切换到画布 Untitled' }))
    await waitFor(() => expect(screen.getByTestId('contour-path')).toHaveAttribute('d', path))
    expect(screen.getByRole('button', { name: '撤销' })).toBeEnabled()
    expect((await readCanvasWorkspace())?.workspace.canvases).toHaveLength(2)
  })

  it('creates blank canvases, confirms deletion and resets the last canvas', async () => {
    const user = await start()
    await user.click(screen.getByRole('button', { name: '新建空白画布' }))
    await waitFor(() => expect(screen.queryByTestId('vertex-a')).not.toBeInTheDocument())
    expect(screen.getByTestId('contour-path')).toHaveAttribute('d', '')
    const cards = screen.getAllByRole('button', { name: '删除画布 Untitled' })
    await user.click(cards[1])
    const dialog = screen.getByRole('dialog', { name: '删除画布' })
    expect(within(dialog).getByRole('button', { name: '取消' })).toHaveFocus()
    await user.click(within(dialog).getByRole('button', { name: '取消' }))
    expect(screen.getAllByRole('button', { name: '删除画布 Untitled' })).toHaveLength(2)
    await user.click(screen.getAllByRole('button', { name: '删除画布 Untitled' })[1])
    await user.click(screen.getByRole('button', { name: '确认删除' }))
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: '删除画布 Untitled' })).toHaveLength(1),
    )
    await user.click(screen.getByRole('button', { name: '删除画布 Untitled' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('重置为空白画布')
    await user.click(screen.getByRole('button', { name: '确认删除' }))
    await waitFor(() => expect(screen.queryByTestId('vertex-a')).not.toBeInTheDocument())
  })
})
