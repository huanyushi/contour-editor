import { expect, test } from '@playwright/test'
import { loadArcFixture, openSection, openView } from './navigation'

test('project header keeps a long editable name and all actions inside the viewport', async ({
  page,
}, info) => {
  await page.goto('/')
  const rename = page.getByRole('button', { name: '重命名项目', exact: true })
  const github = page.getByRole('link', { name: 'GitHub · 查看源代码', exact: true })
  const edit = page.getByRole('textbox', { name: '项目名称', exact: true })
  const widths = info.project.name === 'desktop' ? [1280, 1000, 800] : [390, 320]
  for (const width of widths) {
    await page.setViewportSize({ width, height: 700 })
    const brandBefore = (await page.locator('.brand-text').boundingBox())!
    const nameBefore = (await rename.boundingBox())!
    await rename.click()
    expect((await edit.boundingBox())!.height).toBe(nameBefore.height)
    expect((await page.locator('.brand-text').boundingBox())!.y).toBe(brandBefore.y)
    await edit.fill('很长的项目名称'.repeat(12))
    await expect(edit).toBeFocused()
    await edit.press('Enter')
    await expect(rename).toHaveAttribute('title', '很长的项目名称'.repeat(12))
    await expect(github).toBeVisible()
    expect((await page.locator('.site-header').boundingBox())!.height).toBe(56)
    for (const locator of [
      rename,
      github,
      page.getByRole('button', { name: '应用设置', exact: true }),
    ]) {
      const box = (await locator.boundingBox())!
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(width)
      expect(box.width).toBeGreaterThanOrEqual(24)
    }
    await rename.click()
    const box = (await edit.boundingBox())!
    expect(box.x + box.width).toBeLessThanOrEqual(width)
    await edit.press('Escape')
    expect((await page.locator('.brand-text').boundingBox())!.y).toBe(brandBefore.y)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
  }
  await page.screenshot({ path: info.outputPath('project-header.png') })
})

test(
  'inspector has only one divider above the closed contour controls',
  {
    tag: '@desktop-only',
  },
  async ({ page }) => {
    await page.goto('/')
    const dividers = () =>
      page.locator('.contour-actions').evaluate((actions) => {
        const section = actions.previousElementSibling!.lastElementChild!
        return [
          getComputedStyle(section).borderBottomWidth,
          getComputedStyle(actions).borderTopWidth,
        ].filter((width) => parseFloat(width) > 0).length
      })
    expect(await dividers()).toBe(1)
    await page.getByRole('button', { name: '围道属性', exact: true }).click()
    expect(await dividers()).toBe(1)
  },
)

test('bottom rail icons stay centered and aligned when tools collapse and expand', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: info.project.name === 'narrow' ? 320 : 1280, height: 420 })
  await page.goto('/')
  const bottom = page.locator('.tool-palette .rail-bottom')
  await expect(bottom.getByRole('button')).toHaveCount(3)
  const expectAlignment = async () => {
    const centers = await bottom.getByRole('button').evaluateAll((buttons) =>
      buttons.map((button) => {
        const bounds = button.getBoundingClientRect()
        const icon = button.querySelector('svg')!.getBoundingClientRect()
        return {
          button: bounds.left + bounds.width / 2,
          icon: icon.left + icon.width / 2,
          width: icon.width,
        }
      }),
    )
    for (const center of centers) {
      expect(center.width).toBe(20)
      expect(center.icon).toBeCloseTo(center.button, 1)
      expect(center.icon).toBeCloseTo(centers[0].icon, 1)
    }
  }
  await expectAlignment()
  await bottom.getByRole('button', { name: '收起绘图工具', exact: true }).click()
  await expectAlignment()
  await bottom.getByRole('button', { name: '展开绘图工具', exact: true }).click()
  await expectAlignment()
})

test('grouped tools scroll at low height while bottom actions stay reachable', async ({ page }) => {
  await page.setViewportSize({ width: page.viewportSize()!.width, height: 420 })
  await page.goto('/')
  const tools = page.getByRole('toolbar', { name: '绘图工具选择' })
  const buttons = tools.getByRole('button')
  await expect(buttons).toHaveCount(9)
  const gap = async (a: number, b: number) => {
    const first = (await buttons.nth(a).boundingBox())!
    const second = (await buttons.nth(b).boundingBox())!
    return second.y - first.y - first.height
  }
  expect(await gap(2, 3)).toBeGreaterThan(await gap(0, 1))
  expect(await gap(6, 7)).toBeGreaterThan(await gap(3, 4))
  await buttons.last().scrollIntoViewIfNeeded()
  await buttons.last().click()
  for (const name of ['画布与模板', '对象列表', '收起绘图工具']) {
    const button = page.getByRole('button', { name, exact: true })
    await expect(button).toBeInViewport()
  }
  await page.getByRole('button', { name: '收起绘图工具', exact: true }).click()
  await expect(tools).toBeHidden()
  await page.getByRole('button', { name: '展开绘图工具', exact: true }).click()
  await expect(tools).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(420)
})

test(
  'header actions and template thumbnails keep their appearance during a point gesture',
  {
    tag: '@desktop-only',
  },
  async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: '收起属性面板', exact: true }).click()
    await page.getByRole('button', { name: '画布与模板', exact: true }).click()
    await page.getByRole('tab', { name: '示例模板' }).click()
    const vertex = (await page.getByTestId('vertex-a').boundingBox())!
    await page.mouse.move(vertex.x + vertex.width / 2, vertex.y + vertex.height / 2)
    const appearance = () =>
      page.locator('.project-name button, .header-link, .scene-thumbnail').evaluateAll((nodes) =>
        nodes.map((node) => {
          const style = getComputedStyle(node)
          return [style.color, style.opacity, style.backgroundColor, style.fill, style.stroke]
        }),
      )
    const before = await appearance()
    await page.mouse.down()
    await expect(page.getByRole('button', { name: '重命名项目' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    expect(await appearance()).toEqual(before)
    await page.mouse.up()
    await expect(page.getByRole('button', { name: '重命名项目' })).not.toHaveAttribute(
      'aria-disabled',
      'true',
    )
    expect(await appearance()).toEqual(before)
  },
)

test('fills the viewport and resizing panels preserves center, geometry and CSS unit lengths', async ({
  page,
}, info) => {
  await page.goto('/')
  await loadArcFixture(page)
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
  // Import creates an independent canvas; resizing, panels and panning are not edits.
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
    await openView(page)
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
