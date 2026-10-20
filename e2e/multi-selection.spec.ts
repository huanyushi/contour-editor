import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { openSection, selectObject, showCanvas } from './navigation'
import { clickPoint, loadBoxFixture, savedProject } from './selection'

test('single segment keyboard deletion preserves endpoints and undo restores the closed contour', async ({
  page,
}) => {
  await page.goto('/')
  await clickPoint(page, 4, 1.5)
  await expect(page.getByRole('heading', { name: '线段属性', exact: true })).toBeVisible()
  await page.keyboard.press('Delete')
  const project = await savedProject(page)
  expect(project.document.vertices).toHaveLength(4)
  expect(project.document.segments.map((s) => s.id)).toEqual(['edge-a', 'edge-c', 'edge-d'])
  expect(project.document.closed).toBe(false)
  await expect(page.getByTestId('contour-path')).toHaveAttribute('fill', 'none')
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await expect(page.getByTestId('segment-edge-b')).toHaveCount(1)
  await expect(page.getByTestId('contour-path')).not.toHaveAttribute('fill', 'none')
})

test('Ctrl and Command toggle multiple objects and Backspace deletes the set as one history step', async ({
  page,
}) => {
  await page.goto('/')
  await clickPoint(page, -4, 0)
  await clickPoint(page, 4, 0, 'Control')
  await expect(page.getByRole('heading', { name: '多选属性', exact: true })).toBeVisible()
  await clickPoint(page, 4, 0, 'Meta')
  await expect(page.getByRole('heading', { name: '顶点属性', exact: true })).toBeVisible()
  await clickPoint(page, 4, 0, 'Control')
  await page.keyboard.press('Backspace')
  const project = await savedProject(page)
  expect(project.document.vertices.map((v) => v.id)).toEqual(['c', 'd'])
  expect(project.document.segments.map((s) => s.id)).toEqual(['edge-c'])
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await expect(page.getByTestId('vertex-a')).toBeVisible()
  await expect(page.getByTestId('vertex-b')).toBeVisible()
  await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled()
  await clickPoint(page, -4, 0)
  const input = page.getByLabel('实部 Re', { exact: true })
  await input.fill('123')
  await input.press('Backspace')
  await expect(input).toHaveValue('12')
  await input.press('Home')
  await input.press('Delete')
  await expect(input).toHaveValue('2')
  expect((await savedProject(page)).document.vertices).toHaveLength(4)
  await expect(page.getByRole('button', { name: '重做', exact: true })).toBeEnabled()
})

test('box selection exposes a delete toolbar and batch appearance, supports undo, and stays out of exports', async ({
  page,
}, info) => {
  await page.goto('/')
  await loadBoxFixture(page)
  const tool = page.getByRole('button', { name: '框选工具', exact: true })
  await expect(tool).toBeVisible()
  await tool.click()
  await showCanvas(page)
  const points = await page.getByTestId('contour-canvas').evaluate((node) => {
    const svg = node as SVGSVGElement,
      matrix = svg.getScreenCTM()!
    return [
      new DOMPoint(300, 320).matrixTransform(matrix),
      new DOMPoint(500, 280).matrixTransform(matrix),
    ].map((p) => ({ x: p.x, y: p.y }))
  })
  await page.mouse.move(points[0].x, points[0].y)
  await page.mouse.down()
  await page.mouse.move(points[1].x, points[1].y, { steps: 6 })
  await expect(page.getByTestId('marquee-rectangle')).toBeVisible()
  await page.keyboard.press('Escape')
  await page.mouse.up()
  await expect(page.getByTestId('marquee-rectangle')).toHaveCount(0)
  await page.mouse.move(points[0].x, points[0].y)
  await page.mouse.down()
  await page.mouse.move(points[1].x, points[1].y, { steps: 6 })
  await page.mouse.up()
  await expect(page.getByRole('heading', { name: '多选属性', exact: true })).toBeVisible()
  await expect(page.getByTestId('selection-toolbar')).toContainText('3 个对象')
  await page.getByRole('button', { name: '所选对象颜色：蓝色', exact: true }).click()
  const colored = await savedProject(page)
  expect(colored.document.vertices.slice(0, 2).map((v) => v.pointStyle?.color)).toEqual([
    '#2563eb',
    '#2563eb',
  ])
  expect(colored.document.vertices[2].pointStyle).toBeUndefined()
  expect(colored.document.segments[0].style?.color).toBe('#2563eb')
  await page.screenshot({ path: info.outputPath('multi-selection.png') })
  await page.getByRole('slider', { name: '所选点半径', exact: true }).focus()
  await page.keyboard.press('Delete')
  expect((await savedProject(page)).document.vertices).toHaveLength(4)
  await showCanvas(page)
  await page.getByRole('button', { name: '删除选中对象', exact: true }).click()
  const deleted = await savedProject(page)
  expect(deleted.document.vertices.map((v) => v.id)).toEqual(['c', 'd'])
  expect(deleted.document.segments.map((s) => s.id)).toEqual(['edge-c'])
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await expect(page.getByTestId('selection-toolbar')).toBeVisible()
  await page.locator('summary[aria-label="导出图像"]').click()
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出 SVG', exact: true }).click()
  const file = await (await pending).path()
  if (!file) throw new Error('SVG download failed')
  const text = (await readFile(file)).toString()
  expect(text).not.toContain('selection-toolbar')
  expect(text).not.toContain('foreignObject')
  await page.locator('summary[aria-label="导出图像"]').click()
  await showCanvas(page)
  const top = await page.getByTestId('contour-canvas').evaluate((node) => {
    const matrix = (node as SVGSVGElement).getScreenCTM()!
    return [
      new DOMPoint(300, 240).matrixTransform(matrix),
      new DOMPoint(500, 200).matrixTransform(matrix),
    ].map((p) => ({ x: p.x, y: p.y }))
  })
  await page.keyboard.down('Control')
  await page.mouse.move(top[0].x, top[0].y)
  await page.mouse.down()
  await page.mouse.move(top[1].x, top[1].y, { steps: 5 })
  await page.mouse.up()
  await page.keyboard.up('Control')
  await expect(page.getByTestId('selection-toolbar')).toContainText('6 个对象')
  await page.keyboard.press('Delete')
  const empty = await savedProject(page)
  expect(empty.document.vertices).toHaveLength(0)
  expect(empty.document.segments).toHaveLength(0)
  await page.reload()
  await expect(page.getByTestId('contour-path')).toHaveAttribute('d', '')
})

test(
  'Escape rolls back active object and pan drags without recording history',
  { tag: '@desktop-only' },
  async ({ page }) => {
    await page.goto('/')
    const canvas = page.getByTestId('contour-canvas'),
      path = page.getByTestId('contour-path')
    const original = await path.getAttribute('d')
    const vertex = (await page.getByTestId('vertex-a').boundingBox())!
    const x = vertex.x + vertex.width / 2,
      y = vertex.y + vertex.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x + 40, y + 12, { steps: 4 })
    await expect(path).not.toHaveAttribute('d', original!)
    await page.keyboard.press('Escape')
    await page.mouse.move(x + 80, y + 24)
    await page.mouse.up()
    await expect(path).toHaveAttribute('d', original!)
    await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled()
    await page.getByRole('button', { name: '平移工具', exact: true }).click()
    const box = (await canvas.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2 + 20, { steps: 4 })
    await expect(path).not.toHaveAttribute('d', original!)
    await page.keyboard.press('Escape')
    await page.mouse.up()
    await expect(path).toHaveAttribute('d', original!)
  },
)

test(
  'the explicit delete-segment button deletes geometry even when its label is selected',
  { tag: '@desktop-only' },
  async ({ page }) => {
    await page.goto('/')
    await selectObject(page, '选择路径段 1')
    await openSection(page, '标签')
    await page.getByLabel('LaTeX 标签').fill('C')
    await page.getByRole('button', { name: '应用标签', exact: true }).click()
    await showCanvas(page)
    await page.getByTestId('label-handle-edge-a').click()
    await openSection(page, '几何')
    await page.getByRole('button', { name: '删除路径段', exact: true }).click()
    const project = await savedProject(page)
    expect(project.document.vertices).toHaveLength(4)
    expect(project.document.segments.map((s) => s.id)).toEqual(['edge-b', 'edge-c', 'edge-d'])
  },
)
