import { expect, test, type Locator } from '@playwright/test'
import { openApplicationMenu, openSection, openTemplates, openView } from './navigation'
import { configureAvoidance, openAvoidanceProject } from './avoidance'
import { createAvoidanceFixture } from '../src/test/avoidanceFixtures'

async function paint(button: Locator) {
  return button.evaluate((node) => {
    const style = getComputedStyle(node)
    const luminance = (color: string) => {
      const rgb = color
        .match(/[\d.]+/g)!
        .slice(0, 3)
        .map(Number)
        .map((value) => {
          const channel = value / 255
          return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
        })
      return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]
    }
    const text = luminance(style.color)
    const background = luminance(style.backgroundColor)
    return {
      color: style.color,
      background: style.backgroundColor,
      luminance: background,
      contrast: (Math.max(text, background) + 0.05) / (Math.min(text, background) + 0.05),
    }
  })
}

async function readableHover(button: Locator) {
  await expect(button).toBeEnabled()
  const before = await paint(button)
  expect(before.contrast).toBeGreaterThanOrEqual(4.5)
  await button.hover()
  // Wait for the actual CSS transition, rather than sampling the old background.
  await button.evaluate(async (node) => {
    void getComputedStyle(node).backgroundColor
    await Promise.all(node.getAnimations().map((animation) => animation.finished))
  })
  const hovered = await paint(button)
  expect(hovered.color).not.toBe(before.color)
  expect(hovered.contrast).toBeGreaterThanOrEqual(4.5)
  expect(hovered.luminance).toBeGreaterThan(before.luminance)
  for (const icon of await button.locator('.ui-icon').all())
    await expect(icon).toHaveCSS('stroke', hovered.color)
}

test(
  'coordinate, label, formula and view primary buttons use readable dark text on light hover',
  { tag: '@desktop-only' },
  async ({ page }) => {
    await page.goto('/')
    await readableHover(page.getByRole('button', { name: '应用坐标', exact: true }))
    await openSection(page, '标签')
    await readableHover(page.getByRole('button', { name: '应用标签', exact: true }))
    await page.getByRole('button', { name: '公式工具', exact: true }).click()
    await openApplicationMenu(page)
    await page.getByRole('button', { name: '在原点添加公式', exact: true }).click()
    await readableHover(page.getByRole('button', { name: '应用公式', exact: true }))
    await openView(page)
    for (const name of ['应用视图中心', '应用视图比例', '应用轴标签'])
      await readableHover(page.getByRole('button', { name, exact: true }))
  },
)

test(
  'template creation and PNG export use the same readable primary hover',
  { tag: '@desktop-only' },
  async ({ page }) => {
    await page.goto('/')
    await openTemplates(page)
    const create = page.getByRole('button', { name: '以此模板新建画布' })
    await expect(create).toBeDisabled()
    const disabled = await paint(create)
    await create.hover({ force: true })
    expect(await paint(create)).toEqual(disabled)
    await page.getByRole('button', { name: '预览圆形围道', exact: true }).click()
    await readableHover(create)
    await page.getByRole('tab', { name: '我的画布' }).click()
    await page.locator('summary[aria-label="导出图像"]').click()
    await readableHover(page.getByRole('button', { name: '导出 PNG', exact: true }))
  },
)

for (const im of [0, -2]) {
  test(
    `avoidance apply retains readable primary hover for ${im === 0 ? 'direct' : 'connected'} geometry`,
    { tag: '@desktop-only' },
    async ({ page }) => {
      await page.goto('/')
      const state = createAvoidanceFixture()
      state.avoidances = []
      state.markers[0].im = im
      await openAvoidanceProject(page, state)
      await configureAvoidance(page)
      await readableHover(page.getByRole('button', { name: '应用绕行', exact: true }))
    },
  )
}
