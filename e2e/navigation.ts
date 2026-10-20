import { expect, type Page } from '@playwright/test'
import { createArcFixture } from '../src/test/fixtures'
import { serializeProject } from '../src/features/project/format'

export async function openApplicationMenu(page: Page) {
  const menu = page.getByRole('button', { name: '应用设置', exact: true })
  if ((await menu.getAttribute('aria-expanded')) !== 'true') await menu.click()
}
export async function loadArcFixture(page: Page) {
  await page.getByLabel('打开项目文件').setInputFiles({
    name: 'arc-fixture.json',
    mimeType: 'application/json',
    buffer: Buffer.from(serializeProject(createArcFixture())),
  })
  await expect(page.getByText('已打开 arc-fixture.json', { exact: true })).toBeVisible()
  await selectObject(page, '选择路径段 2')
  const close = page.getByRole('button', { name: '收起对象列表', exact: true })
  if (await close.isVisible()) await close.click()
}
export async function loadTemplate(page: Page, name: string) {
  const toggle = page.getByRole('button', { name: '示例模板', exact: true })
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click()
  await page.getByRole('button', { name: `载入${name}`, exact: true }).click()
  const close = page.getByRole('button', { name: '收起示例模板', exact: true })
  if (await close.isVisible()) await close.click()
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
