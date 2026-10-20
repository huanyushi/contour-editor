import { expect, test, type Page } from '@playwright/test'
import { loadArcFixture, selectObject, showCanvas, showInspector } from './navigation'

async function screenPoint(page: Page, re: number, im: number) {
  return page.getByTestId('contour-canvas').evaluate(
    (element, point) => {
      const svg = element as SVGSVGElement
      const p = svg.createSVGPoint()
      p.x = 400 + point.re * 40
      p.y = 300 - point.im * 40
      const screen = p.matrixTransform(svg.getScreenCTM()!)
      return { x: screen.x, y: screen.y }
    },
    { re, im },
  )
}

async function dragHandle(page: Page, testId: string, re: number, im: number) {
  await showCanvas(page)
  const handle = page.getByTestId(testId)
  await handle.scrollIntoViewIfNeeded()
  const bounds = await handle.boundingBox()
  if (!bounds) throw new Error('Handle not visible')
  const target = await screenPoint(page, re, im)
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
  await page.mouse.down()
  await page.mouse.move(target.x, target.y, { steps: 6 })
  await page.mouse.up()
}

test('constructs the acceptance contour through the arc tool from two shared endpoints', async ({
  page,
}) => {
  await page.goto('/')
  await showInspector(page)
  await page.getByRole('button', { name: '删除选中顶点' }).click()
  await selectObject(page, '选择顶点 z1')
  await page.getByRole('button', { name: '删除选中顶点' }).click()
  await selectObject(page, '选择顶点 z1')
  await page.getByLabel('实部 Re', { exact: true }).fill('-2')
  await page.getByLabel('虚部 Im', { exact: true }).fill('0')
  await page.getByRole('button', { name: '应用坐标' }).click()
  await selectObject(page, '选择顶点 z2')
  await page.getByLabel('实部 Re', { exact: true }).fill('2')
  await page.getByLabel('虚部 Im', { exact: true }).fill('0')
  await page.getByRole('button', { name: '应用坐标' }).click()
  await selectObject(page, '选择路径段 1')
  await page.getByRole('button', { name: '圆弧工具', exact: true }).click()
  await page.getByTestId('contour-canvas').scrollIntoViewIfNeeded()
  const point = await screenPoint(page, 0, 2)
  await page.mouse.click(point.x, point.y)
  await page.getByRole('checkbox', { name: '闭合围道' }).check()
  await page.getByRole('button', { name: '反转方向' }).click()
  const path = page.getByTestId('contour-path')
  await expect(path).toHaveAttribute('d', /^M 480 300 A 80 80 0 0 0 320 300 L 480 300 Z$/)
  // A real SVG fill hit test verifies that the arc bounds a filled upper half disk.
  expect(
    await path.evaluate((node) => (node as SVGPathElement).isPointInFill(new DOMPoint(400, 260))),
  ).toBe(true)
  expect(
    await path.evaluate((node) => (node as SVGPathElement).isPointInFill(new DOMPoint(400, 340))),
  ).toBe(false)
  const arcArrow = page.locator('[data-segment-kind="arc"][data-testid^="arrow-"]')
  expect(Number(await arcArrow.getAttribute('x2'))).toBeLessThan(
    Number(await arcArrow.getAttribute('x1')),
  )
})

test('drags arc through point and shared endpoint, updates fill, then reverses tangent arrows', async ({
  page,
}) => {
  await page.goto('/')
  await loadArcFixture(page)
  const path = page.getByTestId('contour-path')
  expect(
    await path.evaluate((node) => (node as SVGPathElement).isPointInFill(new DOMPoint(400, 200))),
  ).toBe(false)
  await dragHandle(page, 'through-edge-b', 0, 3)
  expect(Number(await page.getByLabel('经过点虚部 Im').inputValue())).toBeCloseTo(3, 1)
  expect(
    await path.evaluate((node) => (node as SVGPathElement).isPointInFill(new DOMPoint(400, 200))),
  ).toBe(true)
  await dragHandle(page, 'vertex-a', -3, -1)
  expect(Number(await page.getByLabel('实部 Re', { exact: true }).inputValue())).toBeCloseTo(-3, 1)
  const geometry = (await path.getAttribute('d'))!
  // The final arc endpoint and initial M share exactly the same coordinate pair.
  const start = geometry.match(/^M ([^ ]+) ([^ ]+)/)!
  expect(geometry.endsWith(`${start[1]} ${start[2]} Z`)).toBe(true)
  const arrow = page.getByTestId('arrow-edge-b')
  const before = {
    x: Number(await arrow.getAttribute('x2')) - Number(await arrow.getAttribute('x1')),
    y: Number(await arrow.getAttribute('y2')) - Number(await arrow.getAttribute('y1')),
  }
  await page.getByRole('button', { name: '反转方向' }).click()
  const after = {
    x: Number(await arrow.getAttribute('x2')) - Number(await arrow.getAttribute('x1')),
    y: Number(await arrow.getAttribute('y2')) - Number(await arrow.getAttribute('y1')),
  }
  expect(after.x).toBeCloseTo(-before.x)
  expect(after.y).toBeCloseTo(-before.y)
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('rejects a collinear through-point drag without breaking the filled path', async ({
  page,
}) => {
  await page.goto('/')
  await loadArcFixture(page)
  await showCanvas(page)
  const handle = page.getByTestId('through-edge-b')
  await handle.scrollIntoViewIfNeeded()
  const bounds = await handle.boundingBox()
  if (!bounds) throw new Error('Handle not visible')
  const target = await screenPoint(page, 0, 0)
  const original = await page.getByTestId('contour-path').getAttribute('d')
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
  await page.mouse.down()
  await page.mouse.move(target.x, target.y)
  await page.mouse.up()
  await expect(page.getByRole('alert')).toContainText(/共线/)
  await expect(page.getByTestId('contour-path')).toHaveAttribute('d', original!)
})
