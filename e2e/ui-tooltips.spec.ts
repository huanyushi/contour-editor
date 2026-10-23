import { expect, test } from '@playwright/test'

test('action hints use one delayed tooltip without native or pseudo-element duplicates', async ({
  page,
}) => {
  await page.goto('/')
  const tool = page.locator('.drawing-tools button').first()
  await expect(tool).toBeVisible()
  await expect(tool).not.toHaveAttribute('title')
  await tool.hover()
  await expect(page.getByRole('tooltip')).toHaveCount(0)
  const tooltip = page.getByRole('tooltip')
  await expect(tooltip).toBeVisible()
  await expect(tooltip).toHaveText((await tool.getAttribute('data-tooltip'))!)
  expect(await tool.evaluate((node) => getComputedStyle(node, '::after').content)).toMatch(
    /^(none|normal)$/,
  )
  const box = (await tooltip.boundingBox())!
  const trigger = (await tool.boundingBox())!
  expect(box.x).toBeGreaterThanOrEqual(trigger.x + trigger.width)
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width)
  await tool.click()
  await expect(tooltip).toHaveCount(0)
})

test('keyboard hints preserve descriptions and focus, dismiss on Escape, and clamp to viewport', async ({
  page,
}) => {
  await page.goto('/')
  const action = page.getByRole('link', { name: 'GitHub · 查看源代码', exact: true })
  await action.evaluate((node) => {
    node.setAttribute('aria-describedby', 'existing-description')
    const description = document.createElement('span')
    description.id = 'existing-description'
    description.textContent = 'Existing description'
    description.hidden = true
    document.body.append(description)
  })
  await page.keyboard.press('Tab')
  await action.focus()
  const tooltip = page.getByRole('tooltip')
  await expect(tooltip).toBeVisible({ timeout: 250 })
  const tooltipId = await tooltip.getAttribute('id')
  await expect(action).toHaveAttribute('aria-describedby', `existing-description ${tooltipId}`)
  await expect(action).toBeFocused()
  const box = (await tooltip.boundingBox())!
  expect(box.x).toBeGreaterThanOrEqual(8)
  expect(box.y).toBeGreaterThanOrEqual(8)
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width - 8)
  expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height - 8)
  expect(await tooltip.evaluate((node) => getComputedStyle(node).pointerEvents)).toBe('none')
  await page.keyboard.press('Escape')
  await expect(tooltip).toHaveCount(0)
  await expect(action).toBeFocused()
  await expect(action).toHaveAttribute('aria-describedby', 'existing-description')
  await action.blur()
  await action.focus()
  await expect(tooltip).toBeVisible()
  await page.mouse.click(1, 1)
  await expect(tooltip).toHaveCount(0)
})

test('leaving an action cancels its pending hover hint', async ({ page }) => {
  await page.goto('/')
  const tool = page.locator('.drawing-tools button').first()
  await tool.hover()
  await page.mouse.move(1, 1)
  await page.waitForTimeout(500)
  await expect(page.getByRole('tooltip')).toHaveCount(0)
})

test('delegation supports later controls and hides hints when their control disappears', async ({
  page,
}) => {
  await page.goto('/')
  await expect(page.locator('.drawing-tools button').first()).toBeVisible()
  await page.evaluate(() => {
    const details = document.createElement('details')
    details.style.cssText = 'position:fixed;right:0;bottom:0;z-index:9999'
    const summary = document.createElement('summary')
    summary.textContent = 'Tooltip fixture'
    summary.dataset.tooltip = '动态操作提示'
    details.append(summary)
    document.body.append(details)
  })
  const control = page.getByText('Tooltip fixture', { exact: true })
  await page.keyboard.press('Tab')
  await control.focus()
  const tooltip = page.getByRole('tooltip')
  await expect(tooltip).toHaveText('动态操作提示')
  const box = (await tooltip.boundingBox())!
  const trigger = (await control.boundingBox())!
  expect(box.y + box.height).toBeLessThan(trigger.y)
  await control.evaluate((node) => node.remove())
  await expect(tooltip).toHaveCount(0)
})
