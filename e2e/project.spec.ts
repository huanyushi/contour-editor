import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import type { ProjectFile } from '../src/features/project/project'
import { openMore, openSection, selectObject } from './navigation'

const draftKey = 'complex-contour-editor:draft:v1'

async function download(page: Page, button: string) {
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: button, exact: true }).click()
  const file = await pending
  const path = await file.path()
  if (!path) throw new Error('Download did not complete')
  return { bytes: await readFile(path), name: file.suggestedFilename() }
}

async function imagePixels(page: Page, bytes: Buffer, mime: string) {
  return page.evaluate(
    async ({ base64, mime }) => {
      const image = new Image()
      image.src = `data:${mime};base64,${base64}`
      await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = image.naturalWidth
      canvas.height = image.naturalHeight
      const context = canvas.getContext('2d')!
      context.drawImage(image, 0, 0)
      const scale = image.naturalWidth / 800
      const pixel = (x: number, y: number) => [
        ...context.getImageData(Math.round(x * scale), Math.round(y * scale), 1, 1).data,
      ]
      const formula = context.getImageData(390 * scale, 130 * scale, 100 * scale, 70 * scale).data
      let ink = 0
      for (let i = 0; i < formula.length; i += 4)
        if (formula[i] < 100 && formula[i + 1] < 100 && formula[i + 2] < 100 && formula[i + 3] > 0)
          ink++
      return {
        width: image.naturalWidth,
        height: image.naturalHeight,
        corner: pixel(5, 5),
        inside: pixel(380, 260),
        outside: pixel(380, 340),
        ink,
      }
    },
    { base64: bytes.toString('base64'), mime },
  )
}

test(
  'downloads an editable project, reloads geometry and labels, and rejects an invalid file atomically',
  { tag: '@desktop-only' },
  async ({ page }) => {
    await page.goto('/')
    await openMore(page)
    await page.getByRole('button', { name: '半圆示例' }).click()
    await selectObject(page, '选择顶点 z1')
    await openSection(page, '标签')
    await page.getByLabel('LaTeX 标签').fill('-R')
    await page.getByRole('button', { name: '应用标签' }).click()
    await page.getByRole('button', { name: '围道属性' }).click()
    await page.getByLabel('填充形式').selectOption('hatch')
    const original = await page.getByTestId('contour-path').getAttribute('d')
    const saved = await download(page, '保存项目')
    expect(saved.name).toBe('contour-project.json')
    const json = JSON.parse(saved.bytes.toString()) as ProjectFile
    expect(json.version).toBe(1)
    expect(json.document.segments[1].kind).toBe('arc')
    expect(json.document.vertices[0].label?.tex).toBe('-R')
    expect(json.document.appearance.fill.mode).toBe('hatch')
    await openMore(page)
    await page.getByRole('button', { name: '重置示例' }).click()
    const reset = await page.getByTestId('contour-path').getAttribute('d')
    await page
      .getByLabel('打开项目文件')
      .setInputFiles({ name: 'restored.json', mimeType: 'application/json', buffer: saved.bytes })
    await expect(page.getByText(/已打开 restored.json/)).toBeVisible()
    await expect(page.getByTestId('contour-path')).toHaveAttribute('d', original!)
    await expect(page.getByTestId('label-a')).toHaveAttribute('aria-label', '-R')
    await expect(page.getByTestId('contour-path')).toHaveAttribute('fill', 'url(#contour-hatch)')
    await page.getByRole('button', { name: '撤销', exact: true }).click()
    await expect(page.getByTestId('contour-path')).toHaveAttribute('d', reset!)
    await page.getByRole('button', { name: '重做', exact: true }).click()
    await expect(page.getByTestId('contour-path')).toHaveAttribute('d', original!)
    await page.getByLabel('打开项目文件').setInputFiles({
      name: 'bad.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ ...json, version: 99 })),
    })
    await expect(page.getByRole('alert')).toContainText('版本')
    await expect(page.getByTestId('contour-path')).toHaveAttribute('d', original!)
  },
)

test(
  'recovers local drafts after reload and generates new IDs without colliding with restored objects',
  { tag: '@desktop-only' },
  async ({ page }) => {
    await page.goto('/')
    await openMore(page)
    await page.getByRole('button', { name: '独立点工具' }).click()
    await page.getByRole('button', { name: '在原点添加独立点' }).click()
    await expect(page.getByLabel('本地草稿状态')).toContainText('已保存')
    const firstId = await page.locator('[data-testid^="marker-"]').getAttribute('data-testid')
    await page.reload()
    await expect(page.getByLabel('本地草稿状态')).toContainText('已恢复')
    await expect(page.locator('[data-testid^="marker-"]')).toHaveCount(1)
    await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled()
    await openMore(page)
    await page.getByRole('button', { name: '独立点工具' }).click()
    await page.getByRole('button', { name: '在原点添加独立点' }).click()
    await expect(page.locator('[data-testid^="marker-"]')).toHaveCount(2)
    const ids = await page
      .locator('[data-testid^="marker-"]')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-testid')))
    expect(new Set(ids).size).toBe(2)
    expect(ids).toContain(firstId)
    await page.getByRole('button', { name: '应用设置', exact: true }).click()
    await page.getByRole('button', { name: '清除本地草稿' }).click()
    await expect(page.getByLabel('本地草稿状态')).toContainText('已清除')
    await page.reload()
    await expect(page.locator('[data-testid^="marker-"]')).toHaveCount(0)
    await expect(page.getByTestId('contour-path')).not.toHaveAttribute('d', / A /)
  },
)

test(
  'keeps a damaged local draft intact until explicitly cleared',
  { tag: '@desktop-only' },
  async ({ page }) => {
    await page.addInitScript((key) => localStorage.setItem(key, '{broken'), draftKey)
    await page.goto('/')
    await expect(page.getByRole('alert')).toContainText('本地草稿无法恢复')
    await page.getByRole('button', { name: '保存项目' }).focus()
    const saved = await download(page, '保存项目')
    expect((JSON.parse(saved.bytes.toString()) as ProjectFile).document.vertices).toHaveLength(4)
    expect(await page.evaluate((key) => localStorage.getItem(key), draftKey)).toBe('{broken')
    await page
      .getByLabel('打开项目文件')
      .setInputFiles({ name: 'fallback.json', mimeType: 'application/json', buffer: saved.bytes })
    await expect(page.getByLabel('本地草稿状态')).toContainText('已保存')
    await expect(page.getByRole('alert')).toHaveCount(0)
    await page.getByRole('button', { name: '应用设置', exact: true }).click()
    await page.getByRole('button', { name: '清除本地草稿' }).click()
    expect(await page.evaluate((key) => localStorage.getItem(key), draftKey)).toBeNull()
    await expect(page.getByRole('alert')).toHaveCount(0)
  },
)

test('downloads standalone SVG and PNG with correct math, fill, dimensions and background', async ({
  page,
}, info) => {
  await page.goto('/')
  await openMore(page)
  await page.getByRole('button', { name: '半圆示例' }).click()
  await page.getByRole('button', { name: '公式工具' }).click()
  await openMore(page)
  await page.getByRole('button', { name: '在原点添加公式' }).click()
  await page.getByLabel('LaTeX 公式').fill('\\frac{1}{z}')
  await page.getByRole('button', { name: '应用公式' }).click()
  await openSection(page, '位置')
  await page.getByLabel('虚部 Im', { exact: true }).fill('4')
  await page.getByRole('button', { name: '应用坐标' }).click()
  const before = await page.getByTestId('contour-path').getAttribute('d')
  const selected = await page.getByRole('heading', { name: '公式属性' }).textContent()
  await page.locator('summary[aria-label="导出图像"]').click()
  await page.getByRole('checkbox', { name: '导出坐标轴' }).uncheck()
  const svg = await download(page, '导出 SVG')
  expect(svg.name).toBe('contour.svg')
  const svgText = svg.bytes.toString()
  expect(svgText).not.toContain('data-export-omit')
  expect(svgText).not.toContain('data-testid')
  expect(svgText).not.toContain('q_{2}')
  const parsed = await page.evaluate((text) => {
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml')
    return {
      errors: doc.querySelectorAll('parsererror').length,
      math: [...doc.querySelectorAll('[aria-label]')].some(
        (node) => node.getAttribute('aria-label') === '\\frac{1}{z}' && node.querySelector('path'),
      ),
      circles: doc.querySelectorAll('circle').length,
    }
  }, svgText)
  expect(parsed).toEqual({ errors: 0, math: true, circles: 0 })
  const svgImage = await imagePixels(page, svg.bytes, 'image/svg+xml')
  expect(svgImage.width).toBe(800)
  expect(svgImage.corner).toEqual([255, 255, 255, 255])
  expect(svgImage.inside[0]).toBeLessThan(250)
  expect(svgImage.outside).toEqual([255, 255, 255, 255])
  // Any dark ink in this otherwise empty region proves the formula survived
  // standalone rendering; an exact count is sensitive to glyph antialiasing.
  expect(svgImage.ink).toBeGreaterThan(0)
  const png = await download(page, '导出 PNG')
  const pngImage = await imagePixels(page, png.bytes, 'image/png')
  expect([pngImage.width, pngImage.height]).toEqual([1600, 1200])
  expect(pngImage.corner).toEqual([255, 255, 255, 255])
  expect(pngImage.ink).toBeGreaterThan(0)
  await page.getByLabel('导出背景').selectOption('transparent')
  await page.getByLabel('PNG 分辨率').selectOption('3')
  const transparent = await download(page, '导出 PNG')
  const alphaImage = await imagePixels(page, transparent.bytes, 'image/png')
  expect([alphaImage.width, alphaImage.height]).toEqual([2400, 1800])
  expect(alphaImage.corner[3]).toBe(0)
  expect(alphaImage.inside[3]).toBeGreaterThan(0)
  expect(alphaImage.outside[3]).toBe(0)
  await page.getByRole('checkbox', { name: '导出围道端点标记' }).check()
  const endpoints = await download(page, '导出 SVG')
  expect(
    await page.evaluate(
      (text) =>
        new DOMParser().parseFromString(text, 'image/svg+xml').querySelectorAll('circle').length,
      endpoints.bytes.toString(),
    ),
  ).toBe(2)
  await expect(page.getByTestId('contour-path')).toHaveAttribute('d', before!)
  await expect(page.getByRole('heading', { name: '公式属性' })).toHaveText(selected!)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
  await page.screenshot({ path: info.outputPath('project-export.png'), fullPage: true })
})
