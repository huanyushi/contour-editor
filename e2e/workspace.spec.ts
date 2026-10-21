import { expect, test, type Page } from '@playwright/test'
import { openSection, openView, setCustomColor, showCanvas } from './navigation'

async function screenPoint(page: Page, re: number, im: number) {
  return page.getByTestId('contour-canvas').evaluate(
    (node, point) => {
      const svg = node as SVGSVGElement
      const p = svg.createSVGPoint()
      p.x = 400 + point.re * 40
      p.y = 300 - point.im * 40
      const target = p.matrixTransform(svg.getScreenCTM()!)
      return { x: target.x, y: target.y }
    },
    { re, im },
  )
}

async function dragVertex(page: Page, re: number, im: number, alt = false) {
  await showCanvas(page)
  const handle = page.getByTestId('vertex-a')
  await handle.scrollIntoViewIfNeeded()
  const bounds = await handle.boundingBox()
  if (!bounds) throw new Error('Vertex not visible')
  const target = await screenPoint(page, re, im)
  if (alt) await page.keyboard.down('Alt')
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
  await page.mouse.down()
  await page.mouse.move(target.x, target.y, { steps: 5 })
  await page.mouse.up()
  if (alt) await page.keyboard.up('Alt')
}

test('snaps grid intersections while Alt and the switch preserve fractional positions', async ({
  page,
}) => {
  await page.goto('/')
  await dragVertex(page, -1.9, 1.9)
  await expect(page.getByLabel('实部 Re', { exact: true })).toHaveValue('-2')
  await expect(page.getByLabel('虚部 Im', { exact: true })).toHaveValue('2')
  await dragVertex(page, -1.9, 1.9, true)
  expect(Number(await page.getByLabel('实部 Re', { exact: true }).inputValue())).toBeCloseTo(
    -1.9,
    2,
  )
  expect(Number(await page.getByLabel('虚部 Im', { exact: true }).inputValue())).toBeCloseTo(1.9, 2)
  await openView(page)
  await page.getByRole('checkbox', { name: '网格吸附' }).uncheck()
  await dragVertex(page, 0.1, -1.9)
  expect(Number(await page.getByLabel('实部 Re', { exact: true }).inputValue())).toBeCloseTo(0.1, 2)
})

test('places independent points and formulas and edits styles in the full-screen workspace', async ({
  page,
}, testInfo) => {
  const external: string[] = []
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('request', (request) => {
    if (!request.url().startsWith('http://127.0.0.1:4173')) external.push(request.url())
  })
  await page.goto('/')
  const original = await page.getByTestId('contour-path').getAttribute('d')
  await page.getByRole('button', { name: '独立点工具' }).click()
  await page.getByTestId('contour-canvas').scrollIntoViewIfNeeded()
  let position = await screenPoint(page, 1.1, 0.05)
  await page.mouse.click(position.x, position.y)
  await expect(page.getByRole('heading', { name: '标记点属性' })).toBeVisible()
  await expect(page.getByLabel('实部 Re', { exact: true })).toHaveValue('1')
  await expect(page.getByLabel('虚部 Im', { exact: true })).toHaveValue('0')
  await expect(page.getByTestId('contour-path')).toHaveAttribute('d', original!)
  await page.getByRole('button', { name: '选择工具', exact: true }).click()
  const marker = page.locator('[data-testid^="marker-"]')
  await marker.scrollIntoViewIfNeeded()
  const markerBox = await marker.boundingBox()
  if (!markerBox) throw new Error('Marker not visible')
  const markerTarget = await screenPoint(page, 2, 1)
  await page.keyboard.down('Alt') // This scenario intentionally leaves the captured source path.
  await page.mouse.move(markerBox.x + markerBox.width / 2, markerBox.y + markerBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(markerTarget.x, markerTarget.y, { steps: 5 })
  await page.mouse.up()
  await page.keyboard.up('Alt')
  expect(Number(await page.getByLabel('实部 Re', { exact: true }).inputValue())).toBeCloseTo(2, 9)
  expect(Number(await page.getByLabel('虚部 Im', { exact: true }).inputValue())).toBeCloseTo(1, 9)
  await page.getByRole('button', { name: '公式工具' }).click()
  await page.getByTestId('contour-canvas').scrollIntoViewIfNeeded()
  position = await screenPoint(page, -2, 4)
  await page.mouse.click(position.x, position.y)
  await page
    .getByLabel('LaTeX 公式')
    .fill('\\frac{\\mathrm{d}f}{\\mathrm{d}z}=\\langle\\psi\\mid\\phi\\rangle')
  await page.getByRole('button', { name: '应用公式' }).click()
  await expect(page.getByRole('alert')).toHaveCount(0)
  const formula = page.locator('[data-testid^="formula-"]')
  await page.getByRole('button', { name: '选择工具', exact: true }).click()
  await formula.scrollIntoViewIfNeeded()
  const bounds = await formula.boundingBox()
  const canvas = await page.getByTestId('contour-canvas').boundingBox()
  if (!bounds || !canvas) throw new Error('Formula not visible')
  const x = bounds.x + bounds.width / 2
  const y = bounds.y + bounds.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + 40, y, { steps: 5 })
  await page.mouse.up()
  await openSection(page, '位置')
  await expect(page.getByLabel('实部 Re', { exact: true })).toHaveValue('-1')
  await page.getByRole('button', { name: '围道属性' }).click()
  await page.getByLabel('填充形式').selectOption('hatch')
  await expect(page.getByTestId('contour-path')).toHaveAttribute('fill', 'url(#contour-hatch)')
  await page.getByLabel('斜线间距').fill('16')
  await page.getByLabel('填充不透明度').fill('0.5')
  await expect(page.locator('#contour-hatch')).toHaveAttribute('width', '16')
  await expect(page.getByTestId('contour-path')).toHaveAttribute('fill-opacity', '0.5')
  await openSection(page, '线条')
  await setCustomColor(page, '线条颜色', '#bf3322')
  await expect(page.getByTestId('segment-edge-a')).toHaveAttribute('stroke', '#bf3322')
  await page.getByLabel('线型', { exact: true }).selectOption('dashed')
  await expect(page.getByTestId('segment-edge-a')).toHaveAttribute('stroke-dasharray', '8 6')
  await page.getByLabel('线条粗细').fill('4')
  await expect(page.getByTestId('segment-edge-a')).toHaveAttribute('stroke-width', '4')
  if (testInfo.project.name === 'desktop') {
    const tools = await page.getByRole('complementary', { name: '绘图工具' }).boundingBox()
    const properties = await page.getByRole('complementary', { name: '对象属性' }).boundingBox()
    expect(tools!.x + tools!.width).toBe(canvas.x)
    expect(canvas.x + canvas.width).toBe(properties!.x)
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
  expect(external).toEqual([])
  expect(errors).toEqual([])
  await page.getByTestId('contour-canvas').scrollIntoViewIfNeeded()
  await page.screenshot({ path: testInfo.outputPath('workspace.png'), fullPage: true })
})
