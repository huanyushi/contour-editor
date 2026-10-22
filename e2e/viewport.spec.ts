import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import {
  loadArcFixture,
  openSection,
  openView,
  selectObject,
  setCustomColor,
  showCanvas,
} from './navigation'

async function downloadText(page: Page, button: string) {
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: button, exact: true }).click()
  const file = await pending
  const path = await file.path()
  if (!path) throw new Error('Download missing')
  return readFile(path, 'utf8')
}

test(
  'returning an automatic label to its initial position preserves redo',
  { tag: '@desktop-only' },
  async ({ page }) => {
    await page.goto('/')
    await page.getByLabel('实部 Re', { exact: true }).fill('1')
    await page.getByRole('button', { name: '应用坐标' }).click()
    await page.getByRole('button', { name: '撤销', exact: true }).click()
    const handle = page.getByTestId('label-handle-a')
    await handle.scrollIntoViewIfNeeded()
    const box = await handle.boundingBox()
    const x = box!.x + box!.width / 2,
      y = box!.y + box!.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x + 35, y + 25, { steps: 5 })
    await page.mouse.move(x, y, { steps: 5 })
    await page.mouse.up()
    await expect(page.getByRole('button', { name: '重做', exact: true })).toBeEnabled()
    await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled()
    const size = page.getByRole('slider', { name: '标签字号', exact: true })
    await size.scrollIntoViewIfNeeded()
    const range = await size.boundingBox()
    const start = range!.x + 8 + (range!.width - 16) * 0.2
    await page.mouse.move(start, range!.y + range!.height / 2)
    await page.mouse.down()
    await page.mouse.move(range!.x + 8 + (range!.width - 16) / 3, range!.y + range!.height / 2, {
      steps: 5,
    })
    await page.mouse.move(start, range!.y + range!.height / 2, { steps: 5 })
    await page.mouse.up()
    await expect(size).toHaveValue('16')
    await expect(page.getByRole('button', { name: '重做', exact: true })).toBeEnabled()
    await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled()
  },
)

test(
  'large translated coordinates keep distinct readable tick labels and positions',
  { tag: '@desktop-only' },
  async ({ page }) => {
    await page.goto('/')
    await openView(page)
    await page.getByLabel('视图中心实部 Re').fill('1000000000000')
    await page.getByRole('button', { name: '应用视图中心' }).click()
    await page.getByLabel('横轴倍率').fill('100')
    await page.getByRole('button', { name: '应用视图比例' }).click()
    const labels = await page.getByTestId('axis-ticks').locator('text').allTextContents()
    expect(labels.length).toBeGreaterThanOrEqual(3)
    expect(new Set(labels).size).toBe(labels.length)
    const positions = await page
      .getByTestId('axis-ticks')
      .locator('text')
      .evaluateAll((nodes) => nodes.map((node) => Number(node.getAttribute('x'))))
    expect(new Set(positions).size).toBe(positions.length)
    await expect(page.getByRole('alert')).toHaveCount(0)
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
  },
)

test('plain and modified wheel zoom at the pointer and pan preserves document history', async ({
  page,
}) => {
  await page.setViewportSize({ width: page.viewportSize()!.width, height: 600 })
  await page.goto('/')
  const canvas = page.getByTestId('contour-canvas')
  const path = page.getByTestId('contour-path')
  await canvas.scrollIntoViewIfNeeded()
  let box = await canvas.boundingBox()
  if (!box) throw new Error('Canvas not visible')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  const scroll = await page.evaluate(() => window.scrollY)
  const original = await path.getAttribute('d')
  await page.mouse.wheel(0, 180)
  await expect(path).not.toHaveAttribute('d', original!)
  expect(await page.evaluate(() => window.scrollY)).toBe(scroll)
  await page.getByTestId('vertex-b').scrollIntoViewIfNeeded()
  const anchor = await page.getByTestId('vertex-b').boundingBox()
  if (!anchor) throw new Error('Anchor missing')
  await page.mouse.move(anchor.x + anchor.width / 2, anchor.y + anchor.height / 2)
  const beforeZoomScroll = await page.evaluate(() => window.scrollY)
  const beforeModifiedZoom = await path.getAttribute('d')
  await page.keyboard.down('Control')
  await page.mouse.wheel(0, -160)
  await page.keyboard.up('Control')
  await expect(path).not.toHaveAttribute('d', beforeModifiedZoom!)
  const afterAnchor = await page.getByTestId('vertex-b').boundingBox()
  expect(afterAnchor!.x + afterAnchor!.width / 2).toBeCloseTo(anchor.x + anchor.width / 2, 0)
  expect(afterAnchor!.y + afterAnchor!.height / 2).toBeCloseTo(anchor.y + anchor.height / 2, 0)
  expect(await page.evaluate(() => window.scrollY)).toBe(beforeZoomScroll)

  for (const mode of ['tool', 'middle', 'space'] as const) {
    await page
      .getByRole('button', { name: mode === 'tool' ? '平移工具' : '选择工具', exact: true })
      .click()
    await canvas.scrollIntoViewIfNeeded()
    box = await canvas.boundingBox()
    const before = await path.getAttribute('d')
    if (mode === 'space') {
      await canvas.focus()
      await page.keyboard.down('Space')
    }
    await page.mouse.move(box!.x + box!.width * 0.8, box!.y + box!.height * 0.75)
    await page.mouse.down({ button: mode === 'middle' ? 'middle' : 'left' })
    await page.mouse.move(box!.x + box!.width * 0.8 + 30, box!.y + box!.height * 0.75 + 15, {
      steps: 6,
    })
    await page.mouse.up({ button: mode === 'middle' ? 'middle' : 'left' })
    if (mode === 'space') await page.keyboard.up('Space')
    await expect(path).not.toHaveAttribute('d', before!)
  }
  await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: '重置视图', exact: true }).click()
  await expect(path).toHaveAttribute('d', original!)
  await page.getByRole('button', { name: '适应图形', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('label appearance updates immediately, clicks keep sidebar appearance and label dragging never moves geometry', async ({
  page,
}) => {
  await page.goto('/')
  await loadArcFixture(page)
  await selectObject(page, '选择顶点 z1')
  await openSection(page, '标签')
  const label = page.getByTestId('label-a')
  const preview = page.getByLabel('公式预览').locator('.math-text')
  const originalWidth = (await label.boundingBox())!.width
  await page.getByLabel('标签字号', { exact: true }).fill('24')
  await setCustomColor(page, '标签颜色', '#cc3344')
  await page.getByLabel('标签水平偏移', { exact: true }).fill('30')
  await page.getByLabel('标签垂直偏移', { exact: true }).fill('-30')
  await expect(label).toHaveAttribute('transform', 'translate(30 -30) scale(1.5)')
  expect((await label.boundingBox())!.width / originalWidth).toBeCloseTo(1.5, 1)
  expect(
    await label
      .locator('path')
      .first()
      .evaluate((node) => getComputedStyle(node).fill),
  ).toBe('rgb(204, 51, 68)')
  expect(await preview.evaluate((node) => getComputedStyle(node).color)).toBe('rgb(204, 51, 68)')
  const toolButton = page.locator('.tool-palette [aria-label="选择工具"]')
  const propertyButton = page.locator('.properties-panel button').filter({ hasText: /^应用标签$/ })
  const opacity = await toolButton.evaluate((node) => getComputedStyle(node).opacity)
  const rightOpacity = await propertyButton.evaluate((node) => getComputedStyle(node).opacity)
  await showCanvas(page)
  await page.getByTestId('vertex-a').scrollIntoViewIfNeeded()
  const point = await page.getByTestId('vertex-a').boundingBox()
  await page.mouse.move(point!.x + point!.width / 2, point!.y + point!.height / 2)
  await page.mouse.down()
  expect(await toolButton.evaluate((node) => getComputedStyle(node).opacity)).toBe(opacity)
  expect(await propertyButton.evaluate((node) => getComputedStyle(node).opacity)).toBe(rightOpacity)
  await page.mouse.up()
  await showCanvas(page)
  await page.getByRole('button', { name: '放大视图', exact: true }).click()
  const labelSize = (await label.boundingBox())!.width
  await page.getByRole('button', { name: '放大视图', exact: true }).click()
  expect((await label.boundingBox())!.width).toBeCloseTo(labelSize, 1)
  const before = await page.getByTestId('contour-path').getAttribute('d')
  const handle = page.getByTestId('label-handle-a')
  await showCanvas(page)
  await handle.scrollIntoViewIfNeeded()
  const bounds = await handle.boundingBox()
  await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2)
  await page.mouse.down()
  await page.mouse.move(bounds!.x + bounds!.width / 2 + 40, bounds!.y + bounds!.height / 2 + 30, {
    steps: 8,
  })
  await page.mouse.up()
  const offset = await label.evaluate((node) => {
    const matrix = (node as SVGGElement).transform.baseVal.consolidate()!.matrix
    return { x: matrix.e, y: matrix.f }
  })
  expect(offset.x).toBeCloseTo(70, 1)
  expect(offset.y).toBeCloseTo(0, 1)
  await expect(page.getByTestId('contour-path')).toHaveAttribute('d', before!)
  await expect(page.getByLabel('LaTeX 标签')).toBeVisible()
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await expect(label).toHaveAttribute('transform', 'translate(30 -30) scale(1.5)')
  await expect(page.getByTestId('contour-path')).toHaveAttribute('d', before!)
  await page.getByRole('button', { name: '重做', exact: true }).click()
  expect(
    await label.evaluate((node) => (node as SVGGElement).transform.baseVal.consolidate()!.matrix.e),
  ).toBeCloseTo(70, 1)
})

test('independent axes, arrow choices and unequal scales survive recovery and image export', async ({
  page,
}, info) => {
  await page.goto('/')
  await loadArcFixture(page)
  await openView(page)
  await page.getByRole('checkbox', { name: '显示网格', exact: true }).uncheck()
  await expect(page.getByTestId('coordinate-axes')).toHaveAttribute('visibility', 'visible')
  await expect(page.getByTestId('axis-ticks')).toHaveAttribute('visibility', 'visible')
  await page.getByRole('checkbox', { name: '显示坐标轴', exact: true }).uncheck()
  await page.getByRole('checkbox', { name: '显示网格', exact: true }).check()
  await expect(page.getByTestId('coordinate-axes')).toHaveAttribute('visibility', 'hidden')
  await openView(page)
  await page.getByRole('checkbox', { name: '锁定两轴 1:1' }).uncheck()
  await page.getByLabel('横轴倍率').fill('2')
  await page.getByLabel('纵轴倍率').fill('0.5')
  await page.getByRole('button', { name: '应用视图比例' }).click()
  const path = page.getByTestId('contour-path')
  await expect(path).toHaveAttribute('d', 'M 240 300 L 560 300 A 160 40 0 0 0 240 300 Z')
  await selectObject(page, '选择路径段 2')
  await openSection(page, '圆弧参数')
  await expect(page.getByLabel('圆弧半径')).toHaveText('2')
  await openView(page)
  await page.getByLabel('坐标轴箭头', { exact: true }).selectOption('triangle')
  await setCustomColor(page, '坐标轴颜色', '#335577')
  await page.getByLabel('实轴标签', { exact: true }).fill('\\operatorname{Re} z')
  await page.getByLabel('虚轴标签', { exact: true }).fill('\\operatorname{Im} z')
  await page.getByRole('button', { name: '应用轴标签', exact: true }).click()
  await page.getByLabel('坐标轴线宽', { exact: true }).fill('2')
  await page.getByLabel('坐标轴箭头大小', { exact: true }).fill('14')
  await page.getByRole('checkbox', { name: '显示坐标轴', exact: true }).check()
  await expect(page.getByTestId('real-axis')).toHaveAttribute('stroke', '#335577')
  await expect(page.locator('#axis-arrow')).toHaveAttribute('markerHeight', '14')
  await expect(page.getByLabel('画布保存状态')).toContainText('已保存')
  await page.reload()
  await expect(path).toHaveAttribute('d', 'M 240 300 L 560 300 A 160 40 0 0 0 240 300 Z')
  await expect(page.locator('#axis-arrow path')).toHaveAttribute('d', 'M 0 0 L -10 -4 L -10 4 Z')
  await expect(page.getByTestId('label-axis-re')).toHaveAttribute(
    'aria-label',
    '\\operatorname{Re} z',
  )
  await expect(page.getByTestId('label-axis-im')).toHaveAttribute(
    'aria-label',
    '\\operatorname{Im} z',
  )
  await page.locator('summary[aria-label="导出图像"]').click()
  const svg = await downloadText(page, '导出 SVG')
  expect(svg).toContain('A 160 40')
  expect(svg).toContain('stroke="#335577"')
  expect(svg).toContain('aria-label="\\operatorname{Re} z"')
  expect(svg).toContain('aria-label="\\operatorname{Im} z"')
  expect(svg).not.toContain('label-handle-')
  await page.locator('summary[aria-label="导出图像"]').click()
  await openView(page)
  await page.screenshot({ path: info.outputPath('viewport-axes.png'), fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
})
