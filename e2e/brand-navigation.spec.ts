import { expect, test } from '@playwright/test'

test('logo and title are separate page-refresh links', async ({ page }, info) => {
  const widths = info.project.name === 'desktop' ? [1280, 800] : [390]
  for (const width of widths) {
    await page.setViewportSize({ width, height: 720 })
    await page.goto('/contour-editor/')
    const logo = page.locator('a.brand-icon')
    const title = page.locator('.brand h1 a')
    await expect(logo).toHaveCount(1)
    await expect(title).toHaveCount(1)
    await expect(logo).toHaveAttribute('href', '/contour-editor/')
    await expect(title).toHaveAttribute('href', '/contour-editor/')
    for (const link of [logo, title]) {
      await expect(link).not.toHaveAttribute('data-tooltip')
      await expect(link).not.toHaveAttribute('title')
    }
    if (width > 700) {
      const before = await title.evaluate((node) => getComputedStyle(node).color)
      await title.hover()
      await expect(title).not.toHaveCSS('color', before)
      await expect(title).toHaveCSS('text-decoration-line', 'none')
    }
    for (const link of width > 700 ? [logo, title] : [logo]) {
      await expect(page.getByLabel('画布保存状态', { exact: true })).toContainText('已保存')
      await page.evaluate(() => {
        document.documentElement.dataset.refreshProbe = 'before'
      })
      await Promise.all([page.waitForEvent('domcontentloaded'), link.click()])
      expect(
        await page.evaluate(() => document.documentElement.dataset.refreshProbe),
      ).toBeUndefined()
      await expect(page.getByTestId('contour-canvas')).toBeVisible()
    }
  }
})
