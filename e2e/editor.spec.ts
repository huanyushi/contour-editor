import { expect, test } from '@playwright/test'
import { openMore, showCanvas, showInspector } from './navigation'

test('dragging uses the rendered SVG scale and updates mathematical coordinates', async ({
  page,
}, testInfo) => {
  await page.goto('/')
  const vertex = page.getByTestId('vertex-a')
  await vertex.scrollIntoViewIfNeeded()
  if (testInfo.project.name === 'narrow') {
    await page.evaluate(() => window.scrollTo(0, 120))
    expect(await page.evaluate(() => window.scrollY)).toBe(0)
  }
  const point = await vertex.boundingBox()
  const canvas = await page.getByTestId('contour-canvas').boundingBox()
  if (!point || !canvas) throw new Error('SVG is not visible')
  const original = await page.getByTestId('contour-path').getAttribute('d')
  const scale = 1
  await page.mouse.move(point.x + point.width / 2, point.y + point.height / 2)
  await page.mouse.down()
  await page.mouse.move(
    point.x + point.width / 2 + 40 * scale,
    point.y + point.height / 2 - 40 * scale,
    { steps: 8 },
  )
  await page.mouse.up()
  await expect(page.getByTestId('contour-path')).not.toHaveAttribute('d', original!)
  expect(Number(await page.getByLabel('实部 Re', { exact: true }).inputValue())).toBeCloseTo(-2, 1)
  expect(Number(await page.getByLabel('虚部 Im', { exact: true }).inputValue())).toBeCloseTo(-1, 1)
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('pointer capture continues outside the canvas and stops on release', async ({ page }) => {
  await page.goto('/')
  const vertex = page.getByTestId('vertex-a')
  await vertex.scrollIntoViewIfNeeded()
  const point = await vertex.boundingBox()
  const canvas = await page.getByTestId('contour-canvas').boundingBox()
  if (!point || !canvas) throw new Error('SVG is not visible')
  await page.mouse.move(point.x + point.width / 2, point.y + point.height / 2)
  await page.keyboard.down('Alt')
  await page.mouse.down()
  await page.mouse.move(canvas.x - 5, canvas.y + canvas.height / 2, { steps: 5 })
  await page.mouse.up()
  await page.keyboard.up('Alt')
  expect(Number(await page.getByLabel('实部 Re', { exact: true }).inputValue())).toBeLessThan(
    -canvas.width / 80,
  )
  const path = await page.getByTestId('contour-path').getAttribute('d')
  await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2)
  await expect(page.getByTestId('contour-path')).toHaveAttribute('d', path!)
})

test('touch cancellation finishes one undoable edit and permits a new drag', async ({
  page,
  context,
}) => {
  await page.goto('/')
  const original = await page.getByTestId('contour-path').getAttribute('d')
  const vertex = page.getByTestId('vertex-a')
  await vertex.scrollIntoViewIfNeeded()
  const point = await vertex.boundingBox()
  if (!point) throw new Error('Vertex is not visible')
  const session = await context.newCDPSession(page)
  const x = point.x + point.width / 2
  const y = point.y + point.height / 2
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: x + 15, y }],
  })
  await session.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] })
  const cancelled = await page.getByTestId('contour-path').getAttribute('d')
  expect(cancelled).not.toBe(original)
  await page.mouse.move(x + 30, y + 30)
  await expect(page.getByTestId('contour-path')).toHaveAttribute('d', cancelled!)
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await expect(page.getByTestId('contour-path')).toHaveAttribute('d', original!)
  await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled()
  await showCanvas(page)
  await vertex.scrollIntoViewIfNeeded()
  const moved = await vertex.boundingBox()
  if (!moved) throw new Error('Moved vertex is not visible')
  const nextX = moved.x + moved.width / 2
  const nextY = moved.y + moved.height / 2
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: nextX, y: nextY }],
  })
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: nextX, y: nextY - 15 }],
  })
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await expect(page.getByTestId('contour-path')).not.toHaveAttribute('d', original!)
})

test('adds, precisely edits, opens, reverses and resets a contour', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '添加顶点', exact: true }).click()
  const canvas = page.getByTestId('contour-canvas')
  await canvas.scrollIntoViewIfNeeded()
  const bounds = await canvas.boundingBox()
  if (!bounds) throw new Error('SVG is not visible')
  await page.mouse.click(bounds.x + bounds.width * 0.7, bounds.y + bounds.height * 0.25)
  await page.getByRole('button', { name: '对象列表', exact: true }).click()
  await expect(page.getByRole('button', { name: /^选择顶点/ })).toHaveCount(5)
  await page.getByRole('button', { name: '选择顶点 z5', exact: true }).click()
  await page.getByLabel('实部 Re', { exact: true }).fill('2.5')
  await page.getByLabel('虚部 Im', { exact: true }).fill('3')
  await page.getByRole('button', { name: '应用坐标' }).click()
  await expect(page.getByTestId('contour-path')).toHaveAttribute('d', /500 180/)
  await page.getByRole('checkbox', { name: '闭合围道' }).uncheck()
  await expect(page.getByTestId('contour-path')).not.toHaveAttribute('d', /Z$/)
  await page.getByRole('button', { name: '反转方向' }).click()
  await expect(page.getByTestId('contour-path')).toHaveAttribute('d', /^M 500 180/)
  await page.getByRole('button', { name: '删除选中顶点' }).click()
  const objects = page.getByRole('button', { name: '对象列表', exact: true })
  if ((await objects.getAttribute('aria-expanded')) !== 'true') await objects.click()
  await expect(page.getByRole('button', { name: /^选择顶点/ })).toHaveCount(4)
  await openMore(page)
  await page.getByRole('button', { name: '重置示例' }).click()
  await showInspector(page)
  await expect(page.getByRole('checkbox', { name: '闭合围道' })).toBeChecked()
  await expect(page.getByRole('button', { name: '添加顶点', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  )
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
})
