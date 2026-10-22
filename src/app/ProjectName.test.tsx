import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { renderApp } from '../test/renderApp'
import { loadTemplate } from '../test/navigation'
import { selectObject } from '../test/navigation'
import { createAvoidanceFixture } from '../test/avoidanceFixtures'
import { serializeProject } from '../features/project/project'
import { DRAFT_KEY } from '../features/project/legacyLocalDraft'

describe('project name metadata', () => {
  it('offers the source repository in a safe new tab', async () => {
    await renderApp()
    const link = screen.getByRole('link', { name: 'GitHub · 查看源代码' })
    expect(link).toHaveAttribute('href', 'https://github.com/huanyushi/contour-editor')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('renames without changing geometry or consuming the redo history', async () => {
    const user = userEvent.setup()
    await renderApp()
    await loadTemplate(user, '上半圆围道')
    await user.click(screen.getByRole('button', { name: '围道属性' }))
    await user.click(screen.getByRole('button', { name: '反转方向' }))
    await user.click(screen.getByRole('button', { name: '撤销' }))
    const before = screen.getByTestId('contour-path').getAttribute('d')
    await user.click(screen.getByRole('button', { name: '重命名项目' }))
    await user.clear(screen.getByRole('textbox', { name: '项目名称' }))
    await user.type(screen.getByRole('textbox', { name: '项目名称' }), '我的围道{Enter}')
    expect(screen.getByRole('button', { name: '撤销' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '重做' })).toBeEnabled()
    expect(screen.getByTestId('contour-path')).toHaveAttribute('d', before)
    await user.click(screen.getByRole('button', { name: '重做' }))
    expect(screen.getByRole('button', { name: '重命名项目' })).toHaveTextContent('我的围道')
  })

  it('keeps target picking active when Escape cancels only the project name edit', async () => {
    const user = userEvent.setup()
    const state = createAvoidanceFixture()
    state.avoidances = []
    localStorage.setItem(DRAFT_KEY, serializeProject(state))
    await renderApp()
    await selectObject(user, '选择标记点 1')
    await user.click(screen.getByRole('button', { name: '添加绕行' }))
    expect(
      screen.getByText('选择绕行目标 · 点击源路径（直线或圆弧），Esc 取消'),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '重命名项目' }))
    await user.type(screen.getByRole('textbox', { name: '项目名称' }), '取消的改名{Escape}')
    expect(screen.getByRole('button', { name: '重命名项目' })).toHaveTextContent('Untitled')
    expect(
      screen.getByText('选择绕行目标 · 点击源路径（直线或圆弧），Esc 取消'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '撤销' })).toBeDisabled()
  })
})
