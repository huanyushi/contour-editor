import { expect, test } from '@playwright/test'
import { showCanvas } from './navigation'
import { clickPoint, loadBoxFixture, savedProject, screenPoint, selectBottomRow } from './selection'

test('a boxed selection translates together, can be undone once, and Escape rolls back its drag', async ({
  page,
}) => {
  await page.goto('/')
  await loadBoxFixture(page)
  await selectBottomRow(page)
  await showCanvas(page)
  const before = await savedProject(page)
  const start = await screenPoint(page, 0, 0)
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(start.x + 40, start.y - 40, { steps: 5 })
  await page.mouse.up()
  const moved = await savedProject(page)
  expect(moved.document.vertices.slice(0, 2).map(({ re, im }) => ({ re, im }))).toEqual([
    { re: -1, im: 1 },
    { re: 3, im: 1 },
  ])
  expect(moved.document.vertices.slice(2)).toEqual(before.document.vertices.slice(2))
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  expect((await savedProject(page)).document.vertices).toEqual(before.document.vertices)
  await showCanvas(page)
  const next = await screenPoint(page, 0, 0)
  await page.mouse.move(next.x, next.y)
  await page.mouse.down()
  await page.mouse.move(next.x + 40, next.y + 40, { steps: 4 })
  await page.keyboard.press('Escape')
  await page.mouse.up()
  expect((await savedProject(page)).document.vertices).toEqual(before.document.vertices)
  await expect(page.getByRole('button', { name: '重做', exact: true })).toBeEnabled()
})

test('tool and sidebar switches clear the box, while Ctrl selection only highlights objects', async ({
  page,
}) => {
  await page.goto('/')
  await loadBoxFixture(page)
  await selectBottomRow(page)
  await clickPoint(page, -2, 0, 'Control')
  await expect(page.getByTestId('selection-rectangle')).toHaveCount(0)
  await expect(page.locator('.vertex circle[r="11"]')).toHaveCount(1)
  await selectBottomRow(page)
  await page.getByRole('button', { name: '平移工具', exact: true }).click()
  await expect(page.getByTestId('selection-rectangle')).toHaveCount(0)
  await expect(page.getByTestId('selection-toolbar')).toHaveCount(0)
  await page.getByRole('button', { name: '选择工具', exact: true }).click()
  await clickPoint(page, -2, 0)
  await clickPoint(page, 2, 0, 'Control')
  await expect(page.getByRole('heading', { name: '多选属性', exact: true })).toBeVisible()
  await expect(page.locator('.vertex circle[r="11"]')).toHaveCount(2)
  await expect(page.getByTestId('selection-rectangle')).toHaveCount(0)
  await expect(page.getByTestId('selection-toolbar')).toHaveCount(0)
  await selectBottomRow(page)
  await page.getByRole('button', { name: '画布与模板', exact: true }).click()
  await expect(page.getByTestId('selection-rectangle')).toHaveCount(0)
})

test('pan and box drags keep unrelated buttons visually unchanged while locked', async ({
  page,
}) => {
  await page.goto('/')
  await loadBoxFixture(page)
  const selectors = [
    '[aria-label="画布与模板"]',
    '.view-toolbar [aria-label="视图设置"]',
    '[aria-label="应用设置"]',
    '[aria-label="保存项目"]',
    '[aria-label="撤销"]',
    '[aria-label="重做"]',
  ]
  const styles = () =>
    page.evaluate(
      (selectors) =>
        selectors.map((selector) => {
          const style = getComputedStyle(document.querySelector(selector)!)
          return {
            opacity: style.opacity,
            color: style.color,
            background: style.backgroundColor,
            border: style.borderColor,
          }
        }),
      selectors,
    )
  await showCanvas(page)
  const start = await screenPoint(page, 0, -3)
  await page.mouse.move(start.x, start.y)
  const before = await styles()
  for (const name of ['平移工具', '框选工具']) {
    await page.getByRole('button', { name, exact: true }).click()
    await page.mouse.move(start.x, start.y)
    expect(await styles()).toEqual(before)
    await page.mouse.down()
    await page.mouse.move(start.x + 24, start.y + 16, { steps: 4 })
    expect(await styles()).toEqual(before)
    await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled()
    await page.mouse.up()
  }
})

test('Delete and Backspace do not outline the entire canvas', async ({ page }) => {
  await page.goto('/')
  await loadBoxFixture(page)
  const canvas = page.getByTestId('contour-canvas')
  for (const key of ['Delete', 'Backspace']) {
    await clickPoint(page, -2, 0)
    await expect(canvas).toHaveCSS('outline-style', 'none')
    await page.keyboard.press(key)
    await expect(canvas).toBeFocused()
    await expect(canvas).toHaveCSS('outline-style', 'none')
    await page.getByRole('button', { name: '撤销', exact: true }).click()
  }
})
