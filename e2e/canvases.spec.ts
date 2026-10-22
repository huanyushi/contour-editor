import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { createInitialState } from '../src/features/contour/model'
import { serializeProject } from '../src/features/project/project'
import { openTemplates, selectObject, openSection } from './navigation'

async function openCanvases(page: Page) {
  const trigger = page.getByRole('button', { name: '画布与模板', exact: true })
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click()
  await page.getByRole('tab', { name: '我的画布' }).click()
}
async function rename(page: Page, name: string) {
  await page.getByRole('button', { name: '重命名项目' }).click()
  await page.getByRole('textbox', { name: '项目名称', exact: true }).fill(name)
  await page.getByRole('textbox', { name: '项目名称', exact: true }).press('Enter')
}
async function download(page: Page, name = '保存项目') {
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name, exact: true }).click()
  const file = await pending
  return { name: file.suggestedFilename(), data: await readFile((await file.path())!) }
}

test(
  'canvases keep content, view, name and undo histories independent across switching and reload',
  { tag: '@desktop-only' },
  async ({ page }) => {
    await page.goto('/')
    await rename(page, 'A')
    await page.getByLabel('实部 Re', { exact: true }).fill('-3')
    await page.getByRole('button', { name: '应用坐标' }).click()
    await openCanvases(page)
    await page.getByRole('button', { name: '新建空白画布' }).click()
    await expect(page.getByTestId('contour-path')).toHaveAttribute('d', '')
    await rename(page, 'B')
    await page.getByRole('button', { name: '独立点工具' }).click()
    await page.getByRole('button', { name: '应用设置', exact: true }).click()
    await page.getByRole('button', { name: '在原点添加独立点' }).click()
    await page.getByRole('button', { name: '切换到画布 A' }).click()
    await expect(page.getByRole('button', { name: '重命名项目' })).toHaveText('A')
    await page.getByRole('button', { name: '撤销', exact: true }).click()
    let saved = JSON.parse((await download(page)).data.toString())
    expect(saved.document.vertices[0].re).toBe(-4)
    await page.getByRole('button', { name: '切换到画布 B' }).click()
    await expect(page.getByTestId('contour-path')).toHaveAttribute('d', '')
    await expect(page.locator('[data-testid^="marker-"]')).toHaveCount(1)
    await page.getByRole('button', { name: '撤销', exact: true }).click()
    await expect(page.locator('[data-testid^="marker-"]')).toHaveCount(0)
    await page.getByRole('button', { name: '切换到画布 A' }).click()
    await page.getByRole('button', { name: '重做', exact: true }).click()
    saved = JSON.parse((await download(page)).data.toString())
    expect(saved.document.vertices[0].re).toBe(-3)
    await page.getByRole('button', { name: '切换到画布 B' }).click()
    await page.reload()
    await expect(page.getByRole('button', { name: '重命名项目' })).toHaveText('B')
    await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled()
    await openCanvases(page)
    await expect(page.locator('.canvas-card')).toHaveCount(2)
    await page.getByRole('button', { name: '切换到画布 A' }).click()
    expect(JSON.parse((await download(page)).data.toString()).document.vertices[0].re).toBe(-3)
  },
)

test(
  'preview is read-only, JSON imports are new canvases, and duplicate/delete/limit are safe',
  { tag: '@desktop-only' },
  async ({ page }) => {
    await page.goto('/')
    await rename(page, '原稿')
    const before = (await download(page)).data
    await openTemplates(page)
    for (const name of ['钥匙孔围道', '圆形围道', '钥匙孔避让奇点'])
      await page.getByRole('button', { name: `预览${name}`, exact: true }).click()
    await expect(page.getByRole('button', { name: '保存项目', exact: true })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    await page.getByRole('tab', { name: '我的画布' }).click()
    expect((await download(page)).data).toEqual(before)
    await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled()
    await page.getByRole('tab', { name: '示例模板' }).click()
    await page.getByRole('button', { name: '以此模板新建画布' }).click()
    await expect(page.getByRole('button', { name: '重命名项目' })).toHaveText('钥匙孔避让奇点')
    const json = await download(page)
    expect(JSON.parse(json.data.toString()).document.avoidances).toHaveLength(2)
    await page.locator('summary[aria-label="导出图像"]').click()
    expect((await download(page, '导出 SVG')).name).toBe('钥匙孔避让奇点.svg')
    expect((await download(page, '导出 PNG')).data.subarray(0, 8).toString('hex')).toBe(
      '89504e470d0a1a0a',
    )
    await page.locator('summary[aria-label="导出图像"]').click()
    await page
      .getByLabel('打开项目文件')
      .setInputFiles({ name: '导入.json', mimeType: 'application/json', buffer: before })
    await expect(page.getByText('已打开 导入.json')).toBeVisible()
    await openCanvases(page)
    await expect(page.locator('.canvas-card')).toHaveCount(3)
    await page.getByRole('button', { name: '复制画布 原稿', exact: true }).click()
    await expect(page.getByRole('button', { name: '重命名项目' })).toHaveText('原稿 副本')
    await page.getByRole('button', { name: '删除画布 原稿 副本', exact: true }).click()
    await expect(page.getByRole('button', { name: '取消', exact: true })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(page.locator('.canvas-card')).toHaveCount(4)
    await page.getByRole('button', { name: '删除画布 原稿 副本', exact: true }).click()
    await page.getByRole('button', { name: '确认删除' }).click()
    await expect(page.locator('.canvas-card')).toHaveCount(3)
    for (let i = 3; i < 10; i++) {
      await page.getByRole('button', { name: '新建空白画布' }).click()
      await expect(page.locator('.canvas-card')).toHaveCount(i + 1)
    }
    await expect(page.getByRole('button', { name: '新建空白画布' })).toBeDisabled()
    await expect(page.getByRole('button', { name: '打开项目', exact: true })).toBeDisabled()
    await expect(page.getByRole('button', { name: '复制画布 原稿', exact: true })).toBeDisabled()
    await openTemplates(page)
    await page.getByRole('button', { name: '预览上半圆围道', exact: true }).click()
    await expect(page.getByRole('button', { name: '以此模板新建画布' })).toBeDisabled()
    await expect(page.getByText(/最多保存 10 张画布/)).toBeVisible()
  },
)

test(
  'migrates legacy projects and names once and keeps damaged originals recoverable',
  { tag: '@desktop-only' },
  async ({ page }) => {
    const legacy = serializeProject(createInitialState())
    await page.addInitScript((text) => {
      if (!sessionStorage.getItem('seeded')) {
        localStorage.setItem('complex-contour-editor:draft:v1', text)
        localStorage.setItem('complex-contour-editor:draft-name:v1', '迁移作品')
        sessionStorage.setItem('seeded', 'yes')
      }
    }, legacy)
    await page.goto('/')
    await expect(page.getByRole('button', { name: '重命名项目' })).toHaveText('迁移作品')
    expect(
      await page.evaluate(() => localStorage.getItem('complex-contour-editor:draft:v1')),
    ).toBeNull()
    await page.reload()
    await openCanvases(page)
    await expect(page.locator('.canvas-card')).toHaveCount(1)
  },
)

test(
  'storage denial keeps edits available for manual JSON download',
  { tag: '@desktop-only' },
  async ({ page }) => {
    await page.addInitScript(() =>
      Object.defineProperty(window, 'indexedDB', { configurable: true, value: undefined }),
    )
    await page.goto('/')
    await expect(page.getByRole('alert')).toContainText('保存项目')
    await rename(page, '未保存作品')
    await page.getByLabel('实部 Re', { exact: true }).fill('-2')
    await page.getByRole('button', { name: '应用坐标' }).click()
    const file = await download(page)
    expect(file.name).toBe('未保存作品.json')
    expect(JSON.parse(file.data.toString()).document.vertices[0].re).toBe(-2)
    await openCanvases(page)
    await page.getByRole('button', { name: '新建空白画布' }).click()
    await expect(page.locator('.canvas-card')).toHaveCount(1)
    await expect(page.getByRole('alert')).toContainText('保存失败')
  },
)

test('panel keeps its two-column layout, keyboard tabs and narrow focus behavior', async ({
  page,
}) => {
  await page.goto('/')
  await openCanvases(page)
  const panel = page.getByRole('complementary', { name: '画布与模板', exact: true })
  const first = await panel.locator('.canvas-card').boundingBox()
  const add = await page.getByRole('button', { name: '新建空白画布' }).boundingBox()
  expect(first!.y).toBe(add!.y)
  expect(add!.x).toBeGreaterThan(first!.x + first!.width)
  await page.getByRole('tab', { name: '我的画布' }).focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('tab', { name: '示例模板' })).toBeFocused()
  await page.getByRole('button', { name: '预览圆形围道', exact: true }).click()
  await expect(panel).toBeVisible()
  await page.getByRole('button', { name: '以此模板新建画布' }).click()
  if (page.viewportSize()!.width <= 700) {
    await expect(panel).toBeHidden()
    await expect(page.getByTestId('contour-canvas')).toBeFocused()
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    page.viewportSize()!.width,
  )
})

test(
  'switching cancels unapplied avoidance and same-ID form drafts',
  { tag: '@desktop-only' },
  async ({ page }) => {
    await page.goto('/')
    await rename(page, 'A')
    await openCanvases(page)
    await page.getByRole('button', { name: '复制画布 A' }).click()
    await selectObject(page, '选择顶点 z1')
    await openSection(page, '标签')
    await page.getByLabel('LaTeX 标签').fill('未提交文字')
    await openCanvases(page)
    await page.getByRole('button', { name: '切换到画布 A', exact: true }).click()
    await selectObject(page, '选择顶点 z1')
    await openSection(page, '标签')
    await expect(page.getByLabel('LaTeX 标签')).toHaveValue('-R')
    await page.getByLabel('数学类型', { exact: true }).selectOption('isolated')
    await page.getByRole('button', { name: '添加绕行' }).click()
    await openCanvases(page)
    await page.getByRole('button', { name: '切换到画布 A 副本', exact: true }).click()
    await expect(page.getByText('选择绕行目标 · 点击源路径（直线或圆弧），Esc 取消')).toHaveCount(0)
  },
)
