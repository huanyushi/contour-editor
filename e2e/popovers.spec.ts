import { expect, test } from '@playwright/test'

test('clicking outside header popovers dismisses them and inside actions stay usable', async ({
  page,
}) => {
  await page.goto('/')
  const canvas = page.getByTestId('contour-canvas')
  const exportTrigger = page.locator('summary[aria-label="导出图像"]')
  const settings = page.getByRole('button', { name: '应用设置', exact: true })
  const before = await page.getByTestId('contour-path').getAttribute('d')
  await exportTrigger.click()
  await page.getByLabel('导出范围').selectOption('view')
  await expect(exportTrigger).toHaveAttribute('aria-expanded', 'true')
  const box = (await canvas.boundingBox())!
  await canvas.click({ position: { x: 8, y: box.height - 40 } })
  await expect(exportTrigger).toHaveAttribute('aria-expanded', 'false')
  await settings.click()
  await expect(settings).toHaveAttribute('aria-expanded', 'true')
  await canvas.click({ position: { x: 8, y: box.height - 40 } })
  await expect(settings).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByTestId('contour-path')).toHaveAttribute('d', before!)
  await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled()
})

test('opening another menu or clicking a tool closes the previous popover without swallowing the action', async ({
  page,
}) => {
  await page.goto('/')
  const exportTrigger = page.locator('summary[aria-label="导出图像"]')
  const settings = page.getByRole('button', { name: '应用设置', exact: true })
  await exportTrigger.click()
  await settings.click()
  await expect(exportTrigger).toHaveAttribute('aria-expanded', 'false')
  await expect(settings).toHaveAttribute('aria-expanded', 'true')
  await page.getByRole('button', { name: '平移工具', exact: true }).click()
  await expect(settings).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByRole('button', { name: '平移工具', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await settings.click()
  await page
    .locator('.application-options')
    .getByRole('button', { name: '视图设置', exact: true })
    .click()
  await expect(page.getByRole('complementary', { name: '视图设置', exact: true })).toBeVisible()
})
