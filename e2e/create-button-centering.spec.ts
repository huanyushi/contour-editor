import { expect, test } from '@playwright/test'

test('template creation centers its label with an auxiliary plus to the left', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '画布与模板', exact: true }).click()
  await page.getByRole('tab', { name: '示例模板' }).click()
  await page.getByRole('button', { name: '预览圆形围道', exact: true }).click()
  const button = page.getByRole('button', { name: '以此模板新建画布' })
  const offset = await button.evaluate((node) => {
    const box = node.getBoundingClientRect()
    const icon = node.querySelector('svg')!
    const iconBox = icon.getBoundingClientRect()
    const text = document.createTreeWalker(node, NodeFilter.SHOW_TEXT)
    let label: Node | null = null
    while (text.nextNode()) {
      if (text.currentNode.textContent?.trim() === '新建画布') label = text.currentNode
    }
    const range = document.createRange()
    range.selectNodeContents(label!)
    const labelBox = range.getBoundingClientRect()
    return {
      labelCenter: (labelBox.left + labelBox.right) / 2 - (box.left + box.width / 2),
      iconGap: labelBox.left - iconBox.right,
      iconCenterY: (iconBox.top + iconBox.bottom) / 2 - (box.top + box.height / 2),
    }
  })
  expect(Math.abs(offset.labelCenter)).toBeLessThanOrEqual(0.5)
  expect(offset.iconGap).toBeCloseTo(6, 0)
  expect(Math.abs(offset.iconCenterY)).toBeLessThanOrEqual(1)
})
