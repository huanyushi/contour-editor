import { expect, test, type Page } from '@playwright/test'
import { contourTemplates } from '../src/features/contour/templates'
import { serializeProject } from '../src/features/project/format'
import { openView } from './navigation'

async function clickPoint(page: Page, re: number, im: number) {
  const target = await page.getByTestId('contour-canvas').evaluate(
    (node, point) => {
      const svg = node as SVGSVGElement
      const p = new DOMPoint(400 + point.re * 40, 300 - point.im * 40)
      const screen = p.matrixTransform(svg.getScreenCTM()!)
      return { x: screen.x, y: screen.y }
    },
    { re, im },
  )
  await page.mouse.click(target.x, target.y)
}

async function closeInspector(page: Page) {
  await expect(page.getByTestId('contour-canvas')).toBeVisible()
  const close = page.getByRole('button', { name: '收起属性面板', exact: true })
  if (await close.isVisible()) await close.click()
}

test('only actual objects open the inspector; blank space, holes and unfilled interiors do not', async ({
  page,
}) => {
  await page.goto('/')
  const keyhole = contourTemplates.find((template) => template.id === 'keyhole')!.create()
  // Leave genuine empty space between the origin marker's 16px hit target
  // and the inner arc's hit stroke; neither is blank-space navigation.
  keyhole.avoidances[0].radius = 1
  await page.getByLabel('打开项目文件').setInputFiles({
    name: 'keyhole.json',
    mimeType: 'application/json',
    buffer: Buffer.from(serializeProject(keyhole)),
  })
  await expect(page.getByText('已打开 keyhole.json', { exact: true })).toBeVisible()
  await closeInspector(page)
  const inspector = page.getByRole('complementary', { name: '对象属性', exact: true })
  const path = page.getByTestId('contour-path')
  const original = await path.getAttribute('d')
  await clickPoint(page, 0, -4)
  await expect(inspector).toBeHidden()
  // The new template has a real branch-point marker at the origin; the
  // surrounding inner disk is still empty and must not open the Inspector.
  await clickPoint(page, -0.5, -0.3)
  await expect(inspector).toBeHidden()
  await expect(path).toHaveAttribute('d', original!)
  await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled()
  await clickPoint(page, 0, 0)
  await expect(page.getByRole('heading', { name: '标记点属性', exact: true })).toBeVisible()
  await closeInspector(page)
  await openView(page)
  await clickPoint(page, 0, -4)
  await expect(page.getByRole('complementary', { name: '视图设置', exact: true })).toBeVisible()
  await expect(inspector).toBeHidden()
  await page.getByRole('button', { name: '关闭视图设置', exact: true }).click()
  await clickPoint(page, 1, 1)
  await expect(page.getByRole('heading', { name: '围道与填充', exact: true })).toBeVisible()
  await page.getByLabel('填充形式').selectOption('none')
  await closeInspector(page)
  await clickPoint(page, 1, 1)
  await expect(inspector).toBeHidden()
  await clickPoint(page, -1.75, (3.5 * Math.sqrt(3)) / 2)
  await expect(page.getByRole('heading', { name: '圆弧属性', exact: true })).toBeVisible()
  await closeInspector(page)
  await page.getByTestId('vertex-v2').click()
  await expect(page.getByRole('heading', { name: '顶点属性', exact: true })).toBeVisible()
  await clickPoint(page, 0, -4)
  await expect(page.getByRole('heading', { name: '顶点属性', exact: true })).toBeVisible()
  await closeInspector(page)
  await page.getByTestId('label-handle-origin').click()
  await expect(page.getByRole('heading', { name: '标记点属性', exact: true })).toBeVisible()
})

test('pointer clicks do not draw a canvas frame and keyboard focus stays visible', async ({
  page,
}) => {
  await page.goto('/')
  await closeInspector(page)
  const canvas = page.getByTestId('contour-canvas')
  await canvas.click({ position: { x: 40, y: 40 } })
  await expect(canvas).toBeFocused()
  await expect(canvas).toHaveCSS('outline-style', 'none')
  // The restore button immediately precedes the SVG in keyboard order.
  await page.getByRole('button', { name: '展开属性面板', exact: true }).focus()
  await page.keyboard.press('Tab')
  await expect(canvas).toBeFocused()
  await expect(canvas).toHaveCSS('outline-color', 'rgb(143, 200, 189)')
  await expect(canvas).toHaveCSS('outline-style', 'solid')
  await canvas.click({ position: { x: 40, y: 40 } })
  await expect(canvas).toHaveCSS('outline-style', 'none')
})
