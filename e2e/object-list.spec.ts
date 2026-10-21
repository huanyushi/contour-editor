import { expect, test } from '@playwright/test'
import { loadArcFixture, showCanvas } from './navigation'

test('object icons align with labels and statuses without adding keyboard stops', async ({
  page,
}, testInfo) => {
  await page.goto('/')
  await loadArcFixture(page)
  await showCanvas(page)
  await page.getByRole('button', { name: '对象列表', exact: true }).click()
  const list = page.getByRole('region', { name: '对象列表', exact: true })
  const rows = [
    list.getByRole('button', { name: '整体围道 闭合', exact: true }),
    list.getByRole('button', { name: '选择路径段 1', exact: true }),
    list.getByRole('button', { name: '选择路径段 2', exact: true }),
  ]
  for (const row of rows) {
    await expect(row).toBeVisible()
    const layout = await row.evaluate((node) => {
      const name = node.querySelector('.object-row-name')!
      const icon = name.querySelector('svg')!
      const text = document.createRange()
      text.setStartAfter(icon)
      text.setEnd(name, name.childNodes.length)
      const i = icon.getBoundingClientRect()
      const n = name.getBoundingClientRect()
      const t = text.getBoundingClientRect()
      const s = node.lastElementChild!.getBoundingClientRect()
      return {
        width: i.width,
        height: i.height,
        centered: Math.abs(i.y + i.height / 2 - (n.y + n.height / 2)),
        labelGap: t.left - i.right,
        statusGap: s.left - n.right,
        stroke: getComputedStyle(icon).stroke,
        color: getComputedStyle(node).color,
        strokeWidth: getComputedStyle(icon).strokeWidth,
      }
    })
    expect(layout.width).toBe(20)
    expect(layout.height).toBe(20)
    expect(layout.centered).toBeLessThan(1)
    expect(layout.labelGap).toBeGreaterThanOrEqual(7)
    expect(layout.statusGap).toBeGreaterThanOrEqual(9)
    expect(layout.stroke).toBe(layout.color)
    expect(layout.strokeWidth).toBe('1.75px')
  }
  await rows[1].focus()
  await page.keyboard.press('Tab')
  await expect(rows[2]).toBeFocused()
  await page.keyboard.press('Enter')
  if (page.viewportSize()!.width <= 700) {
    // Selecting an object closes the narrow list to reveal its Inspector.
    await expect(list).toBeHidden()
    await expect(page.getByRole('heading', { name: '圆弧属性', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '对象列表', exact: true }).click()
  }
  await expect(rows[2]).toHaveClass(/selected/)
  await list.screenshot({ path: testInfo.outputPath('object-list.png') })
})
