import { expect, test, type Locator, type Page } from '@playwright/test'
import { defaultLabel } from '../src/features/contour/appearance'
import { serializeProject } from '../src/features/project/format'
import { createArcFixture } from '../src/test/fixtures'
import { loadArcFixture, openSection, selectObject, showCanvas } from './navigation'

async function openLabel(page: Page) {
  await selectObject(page, '选择顶点 z1')
  await openSection(page, '标签')
}

async function hoverWheel(page: Page, slider: Locator, deltaY: number) {
  await slider.hover()
  await page.mouse.wheel(0, deltaY)
}

async function labelPosition(page: Page) {
  return page.getByTestId('label-a').evaluate((node) => {
    const matrix = (node as SVGGElement).getScreenCTM()!
    return { x: matrix.e, y: matrix.f }
  })
}

test('hover wheel moves labels by one screen pixel before and after mathematical zoom', async ({
  page,
}) => {
  await page.goto('/')
  await loadArcFixture(page)
  await openLabel(page)
  const dx = page.getByRole('slider', { name: '标签水平偏移', exact: true })
  const dy = page.getByRole('slider', { name: '标签垂直偏移', exact: true })
  const panel = page.getByLabel('属性面板内容', { exact: true })
  const path = page.getByTestId('contour-path')
  const canvas = page.getByTestId('contour-canvas')

  for (const slider of [dx, dy]) {
    await expect(slider).toHaveAttribute('min', '-100')
    await expect(slider).toHaveAttribute('max', '100')
    await expect(slider).toHaveAttribute('step', '1')
  }
  for (const zoomed of [false, true]) {
    if (zoomed) {
      await showCanvas(page)
      const beforeZoom = await path.getAttribute('d')
      await page.getByRole('button', { name: '放大视图', exact: true }).click()
      await expect(path).not.toHaveAttribute('d', beforeZoom!)
      await openSection(page, '标签')
    }
    for (const [slider, axis, deltaY] of [
      [dx, 'x', -120],
      [dy, 'y', 120],
    ] as const) {
      await slider.hover()
      const before = await labelPosition(page)
      const scrollTop = await panel.evaluate((node) => node.scrollTop)
      const geometry = await path.getAttribute('d')
      const viewBox = await canvas.getAttribute('viewBox')
      const value = Number(await slider.inputValue())
      await page.mouse.wheel(0, deltaY)
      await expect(slider).toHaveValue(String(value + (axis === 'x' ? 1 : -1)))
      const after = await labelPosition(page)
      expect(after.x - before.x).toBeCloseTo(axis === 'x' ? 1 : 0, 5)
      expect(after.y - before.y).toBeCloseTo(axis === 'y' ? -1 : 0, 5)
      expect(await panel.evaluate((node) => node.scrollTop)).toBe(scrollTop)
      await expect(path).toHaveAttribute('d', geometry!)
      await expect(canvas).toHaveAttribute('viewBox', viewBox!)
    }
  }
})

test('offset boundaries clamp, keyboard arrows work, and other sliders still scroll the panel', async ({
  page,
}) => {
  await page.setViewportSize({ width: page.viewportSize()!.width, height: 600 })
  await page.goto('/')
  await loadArcFixture(page)
  await openLabel(page)
  const dx = page.getByRole('slider', { name: '标签水平偏移', exact: true })
  const dy = page.getByRole('slider', { name: '标签垂直偏移', exact: true })
  const panel = page.getByLabel('属性面板内容', { exact: true })
  for (const [slider, value, deltaY] of [
    [dx, '100', -120],
    [dy, '-100', 120],
  ] as const) {
    await slider.fill(value)
    await slider.hover()
    const scrollTop = await panel.evaluate((node) => node.scrollTop)
    await page.mouse.wheel(0, deltaY)
    await expect(slider).toHaveValue(value)
    expect(await panel.evaluate((node) => node.scrollTop)).toBe(scrollTop)
  }
  await dx.press('ArrowLeft')
  await expect(dx).toHaveValue('99')
  await dy.press('ArrowUp')
  await expect(dy).toHaveValue('-99')

  const size = page.getByRole('slider', { name: '标签字号', exact: true })
  await size.hover()
  const scrollTop = await panel.evaluate((node) => node.scrollTop)
  const geometry = await page.getByTestId('contour-path').getAttribute('d')
  await page.mouse.wheel(0, 120)
  await expect.poll(() => panel.evaluate((node) => node.scrollTop)).toBeGreaterThan(scrollTop)
  await expect(size).toHaveValue('16')
  await expect(page.getByTestId('contour-path')).toHaveAttribute('d', geometry!)
})

test('opening old large offsets displays them honestly and allows returning to nominal bounds', async ({
  page,
}) => {
  await page.goto('/')
  const fixture = createArcFixture()
  fixture.vertices[0].label = { ...defaultLabel('z_1'), dx: 1500, dy: -2000 }
  await page.getByLabel('打开项目文件').setInputFiles({
    name: 'large-label-offsets.json',
    mimeType: 'application/json',
    buffer: Buffer.from(serializeProject(fixture)),
  })
  await expect(page.getByText('已打开 large-label-offsets.json', { exact: true })).toBeVisible()
  await openLabel(page)
  const dx = page.getByRole('slider', { name: '标签水平偏移', exact: true })
  const dy = page.getByRole('slider', { name: '标签垂直偏移', exact: true })
  await expect(dx).toHaveAttribute('min', '-100')
  await expect(dx).toHaveAttribute('max', '1500')
  await expect(dy).toHaveAttribute('min', '-2000')
  await expect(dy).toHaveAttribute('max', '100')
  await expect(dx).toHaveValue('1500')
  await expect(dy).toHaveValue('-2000')
  await expect(page.getByText('1500 px', { exact: true })).toBeVisible()
  await expect(page.getByText('-2000 px', { exact: true })).toBeVisible()
  await expect(page.getByTestId('label-a')).toHaveAttribute(
    'transform',
    'translate(1500 -2000) scale(1)',
  )
  await hoverWheel(page, dx, -120)
  await expect(dx).toHaveValue('1500')
  await hoverWheel(page, dy, 120)
  await expect(dy).toHaveValue('-2000')
  await expect(page.getByTestId('label-a')).toHaveAttribute(
    'transform',
    'translate(1500 -2000) scale(1)',
  )
  await hoverWheel(page, dx, 120)
  await expect(dx).toHaveValue('1499')
  await hoverWheel(page, dy, -120)
  await expect(dy).toHaveValue('-1999')
  await dx.fill('0')
  await dy.fill('0')
  for (const slider of [dx, dy]) {
    await expect(slider).toHaveAttribute('min', '-100')
    await expect(slider).toHaveAttribute('max', '100')
  }
})
