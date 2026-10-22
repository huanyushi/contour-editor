import { screen, within, waitFor } from '@testing-library/react'
import type userEvent from '@testing-library/user-event'
import { expect } from 'vitest'

type User = ReturnType<typeof userEvent.setup>
export async function openApplicationMenu(user: User) {
  const menu = screen.getByRole('button', { name: '应用设置' })
  if (menu.getAttribute('aria-expanded') !== 'true') await user.click(menu)
}
export async function loadTemplate(user: User, name: string) {
  const toggle = screen.getByRole('button', { name: '画布与模板' })
  if (toggle.getAttribute('aria-expanded') !== 'true') await user.click(toggle)
  await user.click(screen.getByRole('tab', { name: '示例模板' }))
  await user.click(screen.getByRole('button', { name: `预览${name}` }))
  await user.click(screen.getByRole('button', { name: '以此模板新建画布' }))
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '重命名项目' })).toHaveTextContent(name),
  )
}
export async function selectObject(user: User, name: string) {
  const toggle = screen.getByRole('button', { name: '对象列表' })
  if (toggle.getAttribute('aria-expanded') !== 'true') await user.click(toggle)
  await user.click(screen.getByRole('button', { name }))
}
export async function openSection(user: User, title: string) {
  const panel = screen.getByRole('complementary', { name: '对象属性' })
  const summary = within(panel).getByText(title, { exact: true })
  if (!(summary.parentElement as HTMLDetailsElement).open) await user.click(summary)
}
