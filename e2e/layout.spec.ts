import { expect, test } from '@playwright/test'
import { openMore, openSection, openView } from './navigation'

test('fills the viewport and resizing panels preserves center, geometry and CSS unit lengths', async ({
  page,
}, info) => {
  await page.goto('/')
  await openMore(page)
  await page.getByRole('button', { name: '半圆示例', exact: true }).click()
  await page.getByRole('button', { name: '平移工具', exact: true }).click()
  const canvas = page.getByTestId('contour-canvas')
  const path = page.getByTestId('contour-path')
  const box = (await canvas.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 24, box.y + box.height / 2 + 12, { steps: 4 })
  await page.mouse.up()
  const geometry = await path.getAttribute('d')
  const measure = () =>
    canvas.evaluate((node) => {
      const svg = node as SVGSVGElement
      const box = svg.viewBox.baseVal
      const matrix = svg.getScreenCTM()!
      return {
        width: svg.clientWidth,
        height: svg.clientHeight,
        viewWidth: box.width,
        viewHeight: box.height,
        centerX: box.x + box.width / 2,
        centerY: box.y + box.height / 2,
        scaleX: matrix.a,
        scaleY: matrix.d,
      }
    })
  await expect.poll(async () => (await measure()).scaleX).toBeCloseTo(1, 5)
  const before = await measure()
  expect(before.viewWidth).toBeCloseTo(before.width, 0)
  expect(before.viewHeight).toBeCloseTo(before.height, 0)
  expect(before.centerX).toBe(400)
  expect(before.centerY).toBe(300)
  expect(before.scaleY).toBeCloseTo(1, 5)
  expect(before.height).toBeGreaterThan(page.viewportSize()!.height - 100)
  const inspectorToggle = page.getByRole('button', { name: /^(收起|展开)属性面板$/ })
  await inspectorToggle.click()
  await expect(path).toHaveAttribute('d', geometry!)
  if (info.project.name === 'desktop') {
    await expect.poll(async () => (await measure()).width).toBeGreaterThan(before.width)
  }
  await page.getByRole('button', { name: '对象列表', exact: true }).click()
  await expect(page.getByRole('button', { name: '选择顶点 z1', exact: true })).toBeVisible()
  await expect(path).toHaveAttribute('d', geometry!)
  await page.getByRole('button', { name: '收起对象列表' }).click()
  await page.setViewportSize({ width: info.project.name === 'desktop' ? 1440 : 420, height: 700 })
  await expect.poll(async () => (await measure()).height).toBe(644)
  const after = await measure()
  expect(after.scaleX).toBeCloseTo(1, 5)
  expect(after.scaleY).toBeCloseTo(1, 5)
  expect(after.centerX).toBe(400)
  expect(after.centerY).toBe(300)
  await expect(path).toHaveAttribute('d', geometry!)
  // Only loading the example is undoable; resizing, opening panels and panning are not.
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled()
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(700)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    page.viewportSize()!.width,
  )
  await page.screenshot({ path: info.outputPath('fullscreen-workspace.png') })
})

test('scrolling settings and object properties leaves the page and drawing still', async ({
  page,
}) => {
  await page.setViewportSize({ width: page.viewportSize()!.width, height: 480 })
  await page.goto('/')
  const original = await page.getByTestId('contour-path').getAttribute('d')
  await openView(page)
  const settings = page.getByLabel('视图设置内容', { exact: true })
  const scrollPanel = async (panel: typeof settings) => {
    const box = (await panel.boundingBox())!
    await panel.hover({ position: { x: box.width - 12, y: box.height / 2 } })
    await page.mouse.wheel(0, 350)
    await expect.poll(() => panel.evaluate((node) => node.scrollTop)).toBeGreaterThan(0)
    expect(await page.evaluate(() => window.scrollY)).toBe(0)
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(480)
    await expect(page.getByTestId('contour-path')).toHaveAttribute('d', original!)
  }
  await scrollPanel(settings)
  await page.getByRole('button', { name: '关闭视图设置' }).click()
  await openSection(page, '标签')
  await scrollPanel(page.getByLabel('属性面板内容', { exact: true }))
})

test(
  'header menus hand off keyboard focus and Escape closes only the active menu',
  { tag: '@desktop-only' },
  async ({ page }) => {
    await page.goto('/')
    const menu = page.getByRole('button', { name: '应用设置', exact: true })
    await menu.click()
    await page.keyboard.press('Tab')
    await page.keyboard.press('Enter')
    await expect(page.getByLabel('视图设置内容', { exact: true })).toBeFocused()
    await menu.click()
    await page.keyboard.press('Escape')
    await expect(menu).toBeFocused()
    await expect(page.getByRole('complementary', { name: '视图设置', exact: true })).toBeVisible()
    await page.locator('summary[aria-label="导出图像"]').click()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('complementary', { name: '视图设置', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '关闭视图设置' }).click()
    await openMore(page)
    await page.getByRole('button', { name: '在原点追加顶点', exact: true }).focus()
    await page.keyboard.press('Enter')
    await expect(page.getByLabel('属性面板内容', { exact: true })).toBeFocused()
    await expect(page.getByLabel('实部 Re', { exact: true })).toHaveValue('0')
  },
)

test(
  'entering a narrow window prevents the two side overlays from covering each other',
  { tag: '@desktop-only' },
  async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: '对象列表', exact: true }).click()
    const original = await page.getByTestId('contour-path').getAttribute('d')
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(page.getByRole('complementary', { name: '对象列表', exact: true })).toBeHidden()
    await expect(page.getByRole('complementary', { name: '对象属性', exact: true })).toBeVisible()
    await expect(page.getByLabel('实部 Re', { exact: true })).toBeInViewport()
    await expect(page.getByTestId('contour-path')).toHaveAttribute('d', original!)
  },
)
