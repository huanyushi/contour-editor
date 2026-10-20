import { expect, test, type Page } from '@playwright/test'
import {
  loadArcFixture,
  openView,
  openSection,
  selectObject,
  showCanvas,
  showInspector,
} from './navigation'

async function dragTo(page: Page, testId: string, re: number, im: number, steps = 12) {
  await showCanvas(page)
  const handle = page.getByTestId(testId)
  await handle.scrollIntoViewIfNeeded()
  const bounds = await handle.boundingBox()
  if (!bounds) throw new Error('Handle not visible')
  const target = await page.getByTestId('contour-canvas').evaluate(
    (node, point) => {
      const svg = node as SVGSVGElement
      const p = svg.createSVGPoint()
      p.x = 400 + point.re * 40
      p.y = 300 - point.im * 40
      const screen = p.matrixTransform(svg.getScreenCTM()!)
      return { x: screen.x, y: screen.y }
    },
    { re, im },
  )
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
  await page.mouse.down()
  await page.mouse.move(target.x, target.y, { steps })
  await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled()
  await page.mouse.up()
}

test('compact panels fit desktop height and remain reachable in a short viewport', async ({
  page,
}, info) => {
  await page.goto('/')
  await showInspector(page)
  const tools = page.getByRole('complementary', { name: '绘图工具' })
  const content = page.getByLabel('属性面板内容')
  if (info.project.name === 'desktop') {
    expect(await tools.evaluate((node) => node.scrollHeight <= node.clientHeight + 1)).toBe(true)
    expect(await content.evaluate((node) => node.scrollHeight <= node.clientHeight + 1)).toBe(true)
  }
  await page.screenshot({ path: info.outputPath('compact-sidebar.png'), fullPage: true })
  await selectObject(page, '选择顶点 z1')
  await expect(page.getByLabel('属性面板内容')).toBeFocused()
  await openSection(page, '标签')
  await expect(page.getByLabel('实部 Re', { exact: true })).toBeHidden()
  if (info.project.name === 'desktop') await page.setViewportSize({ width: 1280, height: 480 })
  await page.getByLabel('LaTeX 标签').fill('a+b')
  await page.getByRole('button', { name: '应用标签', exact: true }).scrollIntoViewIfNeeded()
  await expect(page.getByRole('button', { name: '应用标签', exact: true })).toBeInViewport()
  await page.getByRole('button', { name: '应用标签', exact: true }).click()
  await expect(page.getByTestId('label-a')).toHaveAttribute('aria-label', 'a+b')
  await openView(page)
  await page.getByRole('button', { name: '在原点追加顶点', exact: true }).scrollIntoViewIfNeeded()
  await expect(page.getByRole('button', { name: '在原点追加顶点', exact: true })).toBeInViewport()
  await page.getByRole('button', { name: '在原点追加顶点', exact: true }).click()
  await expect(page.getByLabel('实部 Re', { exact: true })).toHaveValue('0')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
})

test(
  'a complete drag is one undo step and text editing keeps native undo',
  { tag: '@desktop-only' },
  async ({ page }) => {
    await page.goto('/')
    const path = page.getByTestId('contour-path')
    const original = await path.getAttribute('d')
    await dragTo(page, 'vertex-a', -1, 1)
    const moved = await path.getAttribute('d')
    expect(moved).not.toBe(original)
    await page.getByRole('button', { name: '撤销', exact: true }).click()
    await expect(path).toHaveAttribute('d', original!)
    await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled()
    await page.keyboard.press('Control+Shift+z')
    await expect(path).toHaveAttribute('d', moved!)
    await page.getByLabel('实部 Re', { exact: true }).fill('5')
    await page.getByLabel('实部 Re', { exact: true }).press('Control+z')
    await expect(path).toHaveAttribute('d', moved!)
    await page.getByRole('button', { name: '撤销', exact: true }).click()
    await expect(path).toHaveAttribute('d', original!)
    await page.keyboard.press('Control+y')
    await expect(path).toHaveAttribute('d', moved!)
  },
)

test(
  'arc drag undo preserves fill and rejected collinear edits preserve redo',
  { tag: '@desktop-only' },
  async ({ page }) => {
    await page.goto('/')
    const path = page.getByTestId('contour-path')
    const rectangle = await path.getAttribute('d')
    await loadArcFixture(page)
    const semicircle = await path.getAttribute('d')
    await dragTo(page, 'through-edge-b', 0, 3)
    const grown = await path.getAttribute('d')
    await page.getByRole('button', { name: '撤销', exact: true }).click()
    await expect(path).toHaveAttribute('d', semicircle!)
    expect(
      await path.evaluate((node) => (node as SVGPathElement).isPointInFill(new DOMPoint(400, 260))),
    ).toBe(true)
    await dragTo(page, 'through-edge-b', 0, 0, 1)
    await expect(page.getByRole('alert')).toContainText('共线')
    await expect(page.getByRole('button', { name: '重做', exact: true })).toBeEnabled()
    await page.getByRole('button', { name: '重做', exact: true }).click()
    await expect(path).toHaveAttribute('d', grown!)
    await expect(page.getByRole('alert')).toHaveCount(0)
    await page.getByRole('button', { name: '撤销', exact: true }).click()
    await page.getByRole('button', { name: '撤销', exact: true }).click()
    await expect(path).toHaveAttribute('d', rectangle!)
  },
)

test('slider pointer movement and a held arrow key each form one style edit', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '围道属性', exact: true }).click()
  const path = page.getByTestId('contour-path')
  const original = await path.getAttribute('fill-opacity')
  const slider = page.getByRole('slider', { name: '填充不透明度', exact: true })
  await slider.scrollIntoViewIfNeeded()
  const box = await slider.boundingBox()
  if (!box) throw new Error('Slider not visible')
  await page.mouse.move(
    box.x + 8 + (box.width - 16) * Number(await slider.inputValue()),
    box.y + box.height / 2,
  )
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height / 2, { steps: 12 })
  await page.mouse.up()
  const changed = await path.getAttribute('fill-opacity')
  expect(changed).not.toBe(original)
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await expect(path).toHaveAttribute('fill-opacity', original!)
  await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled()
  await slider.focus()
  await page.keyboard.down('ArrowRight')
  await page.keyboard.down('ArrowRight')
  await page.keyboard.down('ArrowRight')
  await page.keyboard.up('ArrowRight')
  await expect(path).not.toHaveAttribute('fill-opacity', original!)
  await page.keyboard.press('Control+z')
  await expect(path).toHaveAttribute('fill-opacity', original!)
  await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled()
})

test(
  'canvas and slider gestures cannot terminate each other when keyboard and pointer overlap',
  { tag: '@desktop-only' },
  async ({ page }) => {
    await page.goto('/')
    const path = page.getByTestId('contour-path')
    const original = await path.getAttribute('d')
    await openSection(page, '外观')
    const radius = page.getByRole('slider', { name: '点半径', exact: true })
    await radius.focus()
    const vertex = page.getByTestId('vertex-a')
    await vertex.scrollIntoViewIfNeeded()
    const vertexBox = await vertex.boundingBox()
    const canvas = await page.getByTestId('contour-canvas').boundingBox()
    if (!vertexBox || !canvas) throw new Error('Canvas not visible')
    const x = vertexBox.x + vertexBox.width / 2
    const y = vertexBox.y + vertexBox.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x + 40, y, { steps: 5 })
    await page.keyboard.press('ArrowRight')
    await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled()
    await page.mouse.up()
    await page.getByRole('button', { name: '撤销', exact: true }).click()
    await expect(path).toHaveAttribute('d', original!)
    await expect(radius).toHaveValue('4')
    await radius.scrollIntoViewIfNeeded()
    await radius.focus()
    await page.keyboard.down('ArrowRight')
    await expect(radius).toHaveValue('5')
    const box = await radius.boundingBox()
    if (!box) throw new Error('Slider not visible')
    await page.mouse.move(box.x + box.width * 0.8, box.y + box.height / 2)
    await page.mouse.down()
    await page.keyboard.up('ArrowRight')
    await page.mouse.move(box.x + box.width * 0.9, box.y + box.height / 2, { steps: 5 })
    await page.mouse.up()
    await expect(radius).toHaveValue('5')
    await page.getByRole('button', { name: '撤销', exact: true }).click()
    await expect(radius).toHaveValue('4')
    await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled()
  },
)
