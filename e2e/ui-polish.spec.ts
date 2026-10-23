import { expect, test } from '@playwright/test'
import { loadArcFixture, openSection } from './navigation'

test('expanded inspector forms do not repeat the enclosing section divider', async ({ page }) => {
  await page.goto('/')
  const section = page.locator('#properties-panel .property-section[open]')
  await expect(section).toHaveCSS('border-bottom-width', '1px')
  for (const group of await section.locator('.property-group').all()) {
    await expect(group).toHaveCSS('border-bottom-width', '0px')
  }
})

test(
  'supporting text remains readable and action hierarchy survives hover',
  {
    tag: '@desktop-only',
  },
  async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('button', { name: '应用坐标', exact: true })).toBeVisible()
    const expectReadable = async (selector: string) => {
      const appearance = await page
        .locator(selector)
        .first()
        .evaluate((node) => {
          const style = getComputedStyle(node)
          const rgb = (value: string) => value.match(/[\d.]+/g)!.map(Number)
          let parent: Element | null = node
          let background = [255, 255, 255]
          while (parent) {
            const color = rgb(getComputedStyle(parent).backgroundColor)
            if ((color[3] ?? 1) > 0) {
              background = color
                .slice(0, 3)
                .map((channel) => channel * (color[3] ?? 1) + 255 * (1 - (color[3] ?? 1)))
              break
            }
            parent = parent.parentElement
          }
          const luminance = (color: number[]) =>
            color
              .slice(0, 3)
              .map((channel) => {
                const s = channel / 255
                return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
              })
              .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0)
          const foreground = luminance(rgb(style.color))
          const behind = luminance(background)
          return {
            size: parseFloat(style.fontSize),
            contrast: (Math.max(foreground, behind) + 0.05) / (Math.min(foreground, behind) + 0.05),
          }
        })
      expect(appearance.size, selector).toBeGreaterThanOrEqual(11)
      expect(appearance.contrast, selector).toBeGreaterThanOrEqual(4.5)
    }
    for (const selector of [
      '.project-name button',
      '.draft-line',
      '.canvas-status',
      '.property-content .muted.small',
      '.eyebrow',
    ])
      await expectReadable(selector)
    const primary = page.getByRole('button', { name: '应用坐标', exact: true })
    await primary.hover()
    await expect(primary).toHaveCSS('color', 'rgb(255, 255, 255)')
    const danger = page.getByRole('button', { name: '删除选中顶点', exact: true })
    await danger.hover()
    await expect
      .poll(() =>
        danger.evaluate((node) => {
          const [r, g] = getComputedStyle(node)
            .backgroundColor.match(/[\d.]+/g)!
            .map(Number)
          return r > g
        }),
      )
      .toBe(true)
    await loadArcFixture(page)
    await openSection(page, '几何')
    await page.getByText('圆弧参数', { exact: true }).click()
    await expectReadable('.geometry-values dt')
    await page.getByRole('button', { name: '对象列表', exact: true }).click()
    await expectReadable('.object-row > span:last-child')
  },
)
