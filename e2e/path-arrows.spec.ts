import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { loadArcFixture, openSection, showCanvas } from './navigation'
import { savedProject, screenPoint } from './selection'
import { serializeProject } from '../src/features/project/format'
import { createArcFixture } from '../src/test/fixtures'

async function tip(page: Page, id: string) {
  return page.getByTestId(`arrow-${id}`).evaluate((node) => {
    const path = node as SVGPathElement
    const p = path.getPointAtLength(path.getTotalLength())
    const screen = new DOMPoint(p.x, p.y).matrixTransform(path.getScreenCTM()!)
    return { x: screen.x, y: screen.y, svgX: p.x, svgY: p.y }
  })
}

async function shaftGrip(page: Page, id: string) {
  return page.getByTestId(`arrow-${id}`).evaluate((node) => {
    const path = node as SVGPathElement
    const p = path.getPointAtLength(1)
    const screen = new DOMPoint(p.x, p.y).matrixTransform(path.getScreenCTM()!)
    return { x: screen.x, y: screen.y }
  })
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 5 })
  await page.mouse.up()
}

test('drags each arrow only within its own segment and supports undo and Escape', async ({
  page,
}) => {
  await page.goto('/')
  await loadArcFixture(page)
  await showCanvas(page)
  const original = await page.getByTestId('contour-path').getAttribute('d')
  const from = await tip(page, 'edge-a')
  // Grab 5px behind the tip: its displacement should remain unchanged.
  await drag(page, { x: from.x - 5, y: from.y }, { x: from.x + 35, y: from.y })
  expect((await savedProject(page)).document.segments[0].arrowPosition).toBeCloseTo(0.75, 2)
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  expect((await savedProject(page)).document.segments[0].arrowPosition).toBeUndefined()
  await showCanvas(page)
  const arcFrom = await shaftGrip(page, 'edge-b')
  const arcTo = await screenPoint(page, Math.SQRT2, Math.SQRT2)
  const arcTip = await tip(page, 'edge-b')
  await drag(page, arcFrom, {
    x: arcTo.x + arcFrom.x - arcTip.x,
    y: arcTo.y + arcFrom.y - arcTip.y,
  })
  const moved = await savedProject(page)
  expect(moved.document.segments[1].arrowPosition).toBeCloseTo(0.25, 2)
  await expect(page.getByTestId('contour-path')).toHaveAttribute('d', original!)
  await showCanvas(page)
  const current = await tip(page, 'edge-b')
  await page.mouse.move(current.x, current.y)
  await page.mouse.down()
  const outside = await screenPoint(page, -3, -1)
  await page.mouse.move(outside.x, outside.y, { steps: 4 })
  await page.keyboard.press('Escape')
  await page.mouse.up()
  expect((await savedProject(page)).document.segments).toEqual(moved.document.segments)
  await showCanvas(page)
  const line = await tip(page, 'edge-a')
  await drag(page, line, await screenPoint(page, 4, 1))
  const limited = await savedProject(page)
  expect(limited.document.segments[0].arrowPosition).toBe(1)
  expect(limited.document.segments[1]).toEqual(moved.document.segments[1])
  // The endpoint arrow must remain grabbable, not hidden behind the endpoint hit circle.
  await showCanvas(page)
  const endGrip = await shaftGrip(page, 'edge-a'),
    endTip = await tip(page, 'edge-a')
  const middle = await screenPoint(page, 0, 0)
  await drag(page, endGrip, {
    x: middle.x + endGrip.x - endTip.x,
    y: middle.y + endGrip.y - endTip.y,
  })
  expect((await savedProject(page)).document.segments[0].arrowPosition).toBeCloseTo(0.5, 2)
})

test(
  'keeps curved arrows on the projected ellipse at different zooms and roundtrips appearance',
  { tag: '@desktop-only' },
  async ({ page }) => {
    const state = createArcFixture()
    state.segments[1].arrowPosition = 0.25
    state.appearance.stroke.arrowShape = 'open'
    state.appearance.stroke.arrowSize = 20
    state.viewport = { ...state.viewport, scaleX: 80, scaleY: 20, locked: false }
    await page.goto('/')
    await page
      .getByLabel('打开项目文件')
      .setInputFiles({
        name: 'ellipse.json',
        mimeType: 'application/json',
        buffer: Buffer.from(serializeProject(state)),
      })
    await expect(page.getByText('已打开 ellipse.json', { exact: true })).toBeVisible()
    await showCanvas(page)
    for (const zoom of [false, true]) {
      if (zoom) {
        const p = await screenPoint(page, 0, 0)
        await page.mouse.move(p.x, p.y)
        await page.mouse.wheel(0, -150)
      }
      await expect(page.getByTestId('arrow-edge-b')).toHaveAttribute('d', / A /)
      const geometry = await page.getByTestId('arrow-edge-b').evaluate((node) => {
        const path = node as SVGPathElement
        const main = document.querySelector('[data-testid="segment-edge-b"]') as SVGPathElement
        const values = main.getAttribute('d')!.split(/\s+/)
        const rx = Number(values[4]),
          ry = Number(values[5])
        const cx = (Number(values[1]) + Number(values[9])) / 2,
          cy = Number(values[2])
        return [0, 0.5, 1].map((t) => {
          const p = path.getPointAtLength(t * path.getTotalLength())
          return ((p.x - cx) / rx) ** 2 + ((p.y - cy) / ry) ** 2
        })
      })
      for (const r of geometry) expect(r).toBeCloseTo(1, 4)
      await expect(page.locator('#direction-edge-b')).toHaveAttribute('markerHeight', '20')
    }
    const file = await savedProject(page)
    expect(file.version).toBe(7)
    expect(file.document.segments[1].arrowPosition).toBe(0.25)
    expect(file.document.appearance.stroke).toMatchObject({ arrowShape: 'open', arrowSize: 20 })
    await page
      .getByLabel('打开项目文件')
      .setInputFiles({
        name: 'restored.json',
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify(file)),
      })
    await expect(page.getByText('已打开 restored.json', { exact: true })).toBeVisible()
    expect((await savedProject(page)).document).toEqual(file.document)
  },
)

test(
  'preserves space-pan and Ctrl-selection, releasing locks before canvas switching',
  { tag: '@desktop-only' },
  async ({ page }) => {
    await page.goto('/')
    await loadArcFixture(page)
    await showCanvas(page)
    const before = await savedProject(page)
    const from = await tip(page, 'edge-a')
    await page.mouse.move(from.x, from.y)
    await page.getByTestId('contour-canvas').focus()
    await page.keyboard.down('Space')
    await drag(page, from, { x: from.x + 35, y: from.y + 10 })
    await page.keyboard.up('Space')
    expect((await savedProject(page)).document.segments).toEqual(before.document.segments)
    const position = await tip(page, 'edge-a')
    await page.keyboard.down('Control')
    await page.mouse.click(position.x, position.y)
    await page.keyboard.up('Control')
    await expect(page.getByText(/已选中 2 个对象/)).toBeVisible()
    expect((await savedProject(page)).document.segments).toEqual(before.document.segments)
    await drag(page, position, { x: position.x + 20, y: position.y })
    const moved = await savedProject(page)
    await page.getByRole('button', { name: '画布与模板', exact: true }).click()
    await page.getByRole('tab', { name: '我的画布' }).click()
    await page.getByRole('button', { name: '新建空白画布' }).click()
    await page.getByRole('button', { name: '切换到画布 arc-fixture', exact: true }).click()
    expect((await savedProject(page)).document.segments).toEqual(moved.document.segments)
  },
)

test(
  'exports sized curved arrows consistently to SVG and PNG',
  { tag: '@desktop-only' },
  async ({ page }) => {
    await page.goto('/')
    await loadArcFixture(page)
    await openSection(page, '外观')
    await page.getByLabel('方向箭头形状', { exact: true }).selectOption('open')
    await page.getByLabel('方向箭头大小', { exact: true }).fill('20')
    const before = (await savedProject(page)).document
    await page.locator('summary[aria-label="导出图像"]').click()
    async function download(name: string) {
      const pending = page.waitForEvent('download')
      await page.getByRole('button', { name, exact: true }).click()
      return readFile((await (await pending).path())!)
    }
    const svg = (await download('导出 SVG')).toString()
    expect(svg).toContain('markerHeight="20"')
    expect(svg).not.toContain('arrow-hit-')
    const size = await page.evaluate((text) => {
      const doc = new DOMParser().parseFromString(text, 'image/svg+xml')
      const root = doc.documentElement
      const path = doc.querySelector('path[marker-end="url(#direction-edge-b)"]')!
      return {
        width: Number(root.getAttribute('width')),
        height: Number(root.getAttribute('height')),
        curved: path.getAttribute('d')!.includes(' A '),
      }
    }, svg)
    expect(size.curved).toBe(true)
    await page.getByLabel('PNG 分辨率').selectOption('2')
    const png = await download('导出 PNG')
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([size.width * 2, size.height * 2])
    expect((await savedProject(page)).document).toEqual(before)
  },
)
