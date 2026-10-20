import { expect, test } from '@playwright/test'
import { openView, showCanvas } from './navigation'
import { savedProject } from './selection'

test('the bottom-right origin shortcut recenters without changing zoom, aspect ratio or history', async ({
  page,
}) => {
  await page.goto('/')
  await openView(page)
  await page.getByLabel('视图中心实部 Re', { exact: true }).fill('1.25')
  await page.getByLabel('视图中心虚部 Im', { exact: true }).fill('-0.75')
  await page.getByRole('button', { name: '应用视图中心', exact: true }).click()
  await page.getByRole('checkbox', { name: '锁定两轴 1:1', exact: true }).uncheck()
  await page.getByLabel('横轴倍率', { exact: true }).fill('2')
  await page.getByLabel('纵轴倍率', { exact: true }).fill('1')
  await page.getByRole('button', { name: '应用视图比例', exact: true }).click()
  const before = (await savedProject(page)).document.view.viewport!
  await showCanvas(page)
  const origin = page
    .locator('.view-toolbar')
    .getByRole('button', { name: '回到原点', exact: true })
  await origin.click()
  const after = (await savedProject(page)).document.view.viewport!
  expect(after).toEqual({ ...before, centerRe: 0, centerIm: 0 })
  await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled()
  const box = (await origin.boundingBox())!
  const canvas = (await page.getByTestId('contour-canvas').boundingBox())!
  expect(box.x).toBeGreaterThanOrEqual(canvas.x)
  expect(box.x + box.width).toBeLessThanOrEqual(canvas.x + canvas.width)
})
