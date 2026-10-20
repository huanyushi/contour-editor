import type { Page } from '@playwright/test'

export async function openMore(page: Page) {
  const menu = page.getByRole('button', { name: '应用设置', exact: true })
  if ((await menu.getAttribute('aria-expanded')) !== 'true') await menu.click()
  const summary = page.getByText('更多操作', { exact: true })
  if (!(await summary.evaluate((node) => (node.parentElement as HTMLDetailsElement).open)))
    await summary.click()
}
export async function selectObject(page: Page, name: string) {
  const toggle = page.getByRole('button', { name: '对象列表', exact: true })
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click()
  await page.getByRole('button', { name, exact: true }).click()
}
export async function openSection(page: Page, title: string) {
  await showInspector(page)
  const summary = page
    .getByRole('complementary', { name: '对象属性' })
    .getByText(title, { exact: true })
  if (!(await summary.evaluate((node) => (node.parentElement as HTMLDetailsElement).open)))
    await summary.click()
}

export async function showInspector(page: Page) {
  const restore = page.getByRole('button', { name: '展开属性面板', exact: true })
  if (await restore.isVisible()) await restore.click()
}

export async function showCanvas(page: Page) {
  const closeView = page.getByRole('button', { name: '关闭视图设置' })
  if (await closeView.isVisible()) await closeView.click()
  if (page.viewportSize()!.width <= 700) {
    const close = page.getByRole('button', { name: '收起属性面板' })
    if (await close.isVisible()) await close.click()
  }
  const list = page.getByRole('button', { name: '收起对象列表' })
  if (await list.isVisible()) await list.click()
}

export async function openView(page: Page) {
  const button = page
    .locator('.view-toolbar')
    .getByRole('button', { name: '视图设置', exact: true })
  if ((await button.getAttribute('aria-expanded')) !== 'true') {
    await showCanvas(page)
    await button.click()
  }
}
