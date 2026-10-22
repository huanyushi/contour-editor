import { expect, test, type Locator, type Page } from '@playwright/test'
import {
  loadArcFixture,
  openSection,
  selectObject,
  setCustomColor,
  showInspector,
} from './navigation'

async function openContourColors(page: Page) {
  await showInspector(page)
  await page.getByRole('button', { name: '围道属性', exact: true }).click()
  await openSection(page, '线条')
  return page.getByRole('group', { name: '线条颜色预设颜色', exact: true }).locator('..')
}

async function expectTwoSwatchRows(field: Locator, savedCount: number) {
  const rows = await field.evaluate((node) =>
    [...node.querySelectorAll(':scope > .color-field-presets')].map((row) =>
      [...row.querySelectorAll('button')].map((button) => {
        const { x, y, width, height } = button.getBoundingClientRect()
        return { x, y, width, height }
      }),
    ),
  )
  expect(rows).toHaveLength(2)
  const [presets, saved] = rows
  expect(presets).toHaveLength(8)
  expect(saved).toHaveLength(savedCount < 8 ? savedCount + 1 : 8)
  const first = presets[0]
  expect(first.width).toBeGreaterThan(0)
  expect(saved[0].y).toBeGreaterThanOrEqual(first.y + first.height + 5)
  for (const [rowIndex, row] of rows.entries()) {
    for (const [column, swatch] of row.entries()) {
      expect(Math.abs(swatch.width - swatch.height)).toBeLessThan(1)
      expect(Math.abs(swatch.width - first.width)).toBeLessThan(1)
      expect(Math.abs(swatch.height - first.height)).toBeLessThan(1)
      expect(Math.abs(swatch.x - presets[column].x)).toBeLessThan(1)
      expect(Math.abs(swatch.y - rows[rowIndex][0].y)).toBeLessThan(1)
    }
  }
}

test('custom swatches stay in two square rows; one click edits and deletion survives reload without recoloring', async ({
  page,
}) => {
  await page.goto('/')
  await loadArcFixture(page)
  const field = await openContourColors(page)
  for (const color of ['#abcdef', '#123456']) {
    await setCustomColor(page, '线条颜色', color)
    await field.getByRole('button', { name: '线条颜色：深色', exact: true }).click()
  }
  await expectTwoSwatchRows(field, 2)
  await field.getByRole('button', { name: '线条颜色：自定义 #abcdef', exact: true }).click()
  await expect(field.getByLabel('线条颜色', { exact: true })).toHaveValue('#abcdef')
  await expect(field.getByLabel('线条颜色', { exact: true })).toBeFocused()
  const segment = page.getByTestId('segment-edge-a')
  await expect(segment).toHaveAttribute('stroke', '#abcdef')
  await field.getByRole('button', { name: '删除自定义线条颜色', exact: true }).click()
  await expect(field.getByRole('button', { name: /自定义 #abcdef/ })).toHaveCount(0)
  await expect(segment).toHaveAttribute('stroke', '#abcdef')
  await expectTwoSwatchRows(field, 1)

  await selectObject(page, '选择顶点 z1')
  await openSection(page, '外观')
  const pointColors = page.getByRole('group', { name: '点颜色自定义颜色', exact: true })
  await expect(pointColors.getByRole('button', { name: /#abcdef/ })).toHaveCount(0)
  await expect(pointColors.getByRole('button', { name: /#123456/ })).toBeVisible()
  await expect(page.getByLabel('画布保存状态')).toContainText('已保存')
  await page.reload()
  const restored = await openContourColors(page)
  await expect(restored.getByRole('button', { name: /自定义 #abcdef/ })).toHaveCount(0)
  await expect(restored.getByRole('button', { name: /自定义 #123456/ })).toBeVisible()
  await expect(segment).toHaveAttribute('stroke', '#abcdef')
  await expectTwoSwatchRows(restored, 1)
})

test('eight custom colors hide the add cell; deletion frees it and re-addition stays at eight after reload', async ({
  page,
}) => {
  await page.goto('/')
  await loadArcFixture(page)
  const field = await openContourColors(page)
  for (const color of [
    '#111111',
    '#222222',
    '#333333',
    '#444444',
    '#555555',
    '#666666',
    '#777777',
    '#888888',
  ]) {
    await setCustomColor(page, '线条颜色', color)
    await field.getByRole('button', { name: '线条颜色：深色', exact: true }).click()
  }
  const add = field.getByRole('button', { name: '自定义线条颜色', exact: true })
  await expect(add).toHaveCount(0)
  await expectTwoSwatchRows(field, 8)
  await field.getByRole('button', { name: '线条颜色：自定义 #111111', exact: true }).click()
  await expect(field.getByLabel('线条颜色', { exact: true })).toHaveValue('#111111')
  await field.getByRole('button', { name: '删除自定义线条颜色', exact: true }).click()
  await expect(page.getByTestId('segment-edge-a')).toHaveAttribute('stroke', '#111111')
  await expect(add).toBeVisible()
  await expect(add).toBeFocused()
  await expectTwoSwatchRows(field, 7)
  await setCustomColor(page, '线条颜色', '#999999')
  await expect(add).toHaveCount(0)
  await expect(field.getByRole('button', { name: /自定义 #999999/ })).toBeVisible()
  await expect(field.getByRole('button', { name: /自定义 #111111/ })).toHaveCount(0)
  await expectTwoSwatchRows(field, 8)
  await expect(page.getByLabel('画布保存状态')).toContainText('已保存')
  await page.reload()
  const restored = await openContourColors(page)
  await expect(restored.getByRole('button', { name: '自定义线条颜色', exact: true })).toHaveCount(0)
  await expect(restored.getByRole('button', { name: /自定义 #999999/ })).toBeVisible()
  await expect(restored.getByRole('button', { name: /自定义 #111111/ })).toHaveCount(0)
  await expectTwoSwatchRows(restored, 8)
})
