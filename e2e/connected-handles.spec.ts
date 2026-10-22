import { expect, test, type Page } from '@playwright/test'
import {
  createConnectedFixture,
  createRectangleConnectedFixture,
} from '../src/test/connectedAvoidanceFixtures'
import { openAvoidanceProject } from './avoidance'
import { savedProject, screenPoint } from './selection'
import { loadTemplate, selectObject, showCanvas } from './navigation'

async function grip(page: Page, id: string) {
  return page.getByTestId(id).evaluate((node) => {
    const p = new DOMPoint(0, 0).matrixTransform((node as SVGGraphicsElement).getScreenCTM()!)
    return { x: p.x, y: p.y }
  })
}
async function drag(
  page: Page,
  id: string,
  delta: { re: number; im: number },
  scale = 80,
  cancel = false,
) {
  await showCanvas(page)
  const from = await grip(page, id)
  const origin = await screenPoint(page, 0, 0)
  const offset = await screenPoint(page, (delta.re * scale) / 40, (delta.im * scale) / 40)
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + offset.x - origin.x, from.y + offset.y - origin.y, { steps: 8 })
  if (cancel) await page.keyboard.press('Escape')
  await page.mouse.up()
}

test(
  'rectangle endpoint spacing and radius are independent without grid snapping, with undo and Escape',
  { tag: '@desktop-only' },
  async ({ page }) => {
    const state = createRectangleConnectedFixture()
    state.snap = true
    await page.goto('/')
    await openAvoidanceProject(page, state)
    const before = (await savedProject(page)).document
    await drag(page, 'avoidance-gap-parent', { re: 0.0875, im: 0 })
    const widened = (await savedProject(page)).document
    expect(widened.avoidances![0]).toMatchObject({
      radius: 0.4,
      gap: expect.closeTo(0.375, 6),
      anchor: { kind: 'segment', segmentId: 'edge-a', t: 0.5 },
    })
    expect(widened.vertices).toEqual(before.vertices)
    await page.getByRole('button', { name: '撤销', exact: true }).click()
    expect((await savedProject(page)).document).toEqual(before)
    await page.getByRole('button', { name: '重做', exact: true }).click()
    await drag(page, 'avoidance-gap-parent', { re: 0.05, im: 0 }, 80, true)
    expect((await savedProject(page)).document).toEqual(widened)
    const endpoint = await page.getByTestId('segment-avoid:parent:arc').evaluate((node) => {
      const p = (node as SVGPathElement).getPointAtLength(0)
      return { re: (p.x - 400) / 80, im: (300 - p.y) / 80 }
    })
    await drag(page, 'avoidance-radius-parent-entry', {
      re: endpoint.re / 4,
      im: (endpoint.im - 1) / 4,
    })
    const resized = (await savedProject(page)).document
    expect(resized.avoidances![0]).toMatchObject({
      radius: expect.closeTo(0.5, 5),
      gap: expect.closeTo(0.375, 6),
    })
    expect(resized.vertices).toEqual(before.vertices)
  },
)

test(
  'dragging a source port moves both contacts with fixed spacing even near a grid crossing',
  { tag: '@desktop-only' },
  async ({ page }) => {
    const state = createRectangleConnectedFixture()
    state.snap = true
    await page.goto('/')
    await openAvoidanceProject(page, state)
    const before = (await savedProject(page)).document
    const target = 0.7 - 0.1 * Math.sqrt(1.49)
    await drag(page, 'avoidance-port-parent-entry', { re: target + 0.1, im: 0 })
    const after = (await savedProject(page)).document
    expect(after.avoidances![0]).toMatchObject({
      radius: 0.4,
      gap: 0.2,
      anchor: { kind: 'segment', segmentId: 'edge-a', t: expect.closeTo(0.675, 6) },
    })
    expect(after.vertices).toEqual(before.vertices)
    await page.getByRole('button', { name: '撤销', exact: true }).click()
    expect((await savedProject(page)).document).toEqual(before)
  },
)

test(
  'tiny openings keep actual endpoints and nearest-point dragging without leaders or merged grips',
  { tag: '@desktop-only' },
  async ({ page }) => {
    await page.goto('/')
    await openAvoidanceProject(page, createRectangleConnectedFixture(0.02))
    const a = await grip(page, 'avoidance-radius-parent-entry'),
      b = await grip(page, 'avoidance-radius-parent-exit')
    const origin = await screenPoint(page, 0, 0),
      unit = await screenPoint(page, 1, 0)
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeCloseTo(0.04 * (unit.x - origin.x), 3)
    await expect(page.locator('[data-avoidance-endpoint-leader]')).toHaveCount(0)
    await expect(page.getByTestId('avoidance-port-parent-both')).toHaveCount(0)
    await expect(page.getByTestId('avoidance-gap-parent')).toBeVisible()
    await drag(page, 'avoidance-gap-parent', { re: 0.05, im: 0 })
    expect((await savedProject(page)).document.avoidances![0]).toMatchObject({
      radius: 0.4,
      gap: expect.closeTo(0.12, 6),
      anchor: { kind: 'segment', segmentId: 'edge-a', t: 0.5 },
    })
  },
)

test(
  'circle opening accepts 45, zero and negative angles across its seam without changing radius or spacing',
  { tag: '@desktop-only' },
  async ({ page }) => {
    const state = createConnectedFixture()
    state.viewport = { ...state.viewport, scaleX: 200, scaleY: 200 }
    await page.goto('/')
    await openAvoidanceProject(page, state)
    await page.getByTestId('avoidance-radius-parent-entry').focus()
    await page.keyboard.press('Enter')
    for (const [text, segmentId, t] of [
      ['45', 'upper', 0.25],
      ['0', 'upper', 0],
      ['-90', 'lower', 0.5],
    ] as const) {
      const field = page.getByLabel('开口朝向（度）', { exact: true })
      await field.fill(text)
      await field.press('Enter')
      const after = (await savedProject(page)).document
      const parent = after.avoidances![0]
      expect(parent).toMatchObject({ radius: 0.1, gap: 0.04, anchor: { segmentId } })
      if (parent.kind !== 'corridor') throw new Error('missing parent')
      if (t === 0) expect(parent.anchor).toMatchObject({ kind: 'vertex', vertexId: 'right' })
      else expect(parent.anchor).toMatchObject({ kind: 'segment', t: expect.closeTo(t, 7) })
      expect(after.vertices).toEqual(state.vertices)
    }
  },
)

test(
  'opening angle cannot hide an applied detour on the retained closing edge',
  { tag: '@desktop-only' },
  async ({ page }) => {
    const state = createRectangleConnectedFixture()
    state.closed = false
    await page.goto('/')
    await openAvoidanceProject(page, state)
    const before = (await savedProject(page)).document
    await page.getByTestId('avoidance-radius-parent-entry').focus()
    await page.keyboard.press('Enter')
    const field = page.getByLabel('开口朝向（度）', { exact: true })
    await field.fill('180')
    await field.press('Enter')
    await expect(page.getByRole('alert')).toBeVisible()
    await expect(field).toHaveValue('270')
    await expect(page.getByTestId('segment-avoid:parent:arc')).toBeVisible()
    expect((await savedProject(page)).document).toEqual(before)
    await field.fill('0')
    await field.press('Enter')
    const parent = (await savedProject(page)).document.avoidances![0]
    expect(parent).toMatchObject({ radius: 0.4, gap: 0.2, anchor: { segmentId: 'edge-b' } })
    await expect(page.getByTestId('segment-avoid:parent:arc')).toBeVisible()
  },
)

test('narrow view can drag a real source endpoint then return to editable parameters', async ({
  page,
}) => {
  test.skip(page.viewportSize()!.width > 700, 'Narrow layout only')
  const state = createRectangleConnectedFixture(0.02)
  state.viewport = { ...state.viewport, scaleX: 40, scaleY: 40 }
  await page.goto('/')
  await openAvoidanceProject(page, state)
  await drag(page, 'avoidance-gap-parent', { re: 0.1, im: 0 }, 40)
  await expect(page.getByLabel('绕行半径', { exact: true })).toBeVisible()
  await expect(page.getByLabel('属性面板内容', { exact: true })).toBeFocused()
  expect((await savedProject(page)).document.avoidances![0]).toMatchObject({
    gap: expect.closeTo(0.22, 6),
    anchor: { kind: 'segment', segmentId: 'edge-a', t: 0.5 },
  })
})

test(
  'a coincident source endpoint routes to the real rectangle vertex',
  { tag: '@desktop-only' },
  async ({ page }) => {
    const state = createRectangleConnectedFixture(0.4 / Math.sqrt(4.24))
    if (state.avoidances[0].kind !== 'corridor') throw new Error('fixture')
    state.avoidances[0].anchor = { kind: 'segment', segmentId: 'edge-a', t: 0.95 }
    await page.goto('/')
    await openAvoidanceProject(page, state)
    await showCanvas(page)
    const vertex = await screenPoint(page, 4, 0)
    const port = await grip(page, 'avoidance-port-parent-exit')
    expect(port.x).toBeCloseTo(vertex.x, 6)
    expect(port.y).toBeCloseTo(vertex.y, 6)
    await page.mouse.click(vertex.x, vertex.y)
    await expect(page.getByRole('heading', { name: '顶点属性', exact: true })).toBeVisible()
  },
)

test(
  'short banks route an overlapping source hit region to the nearer radius endpoint',
  { tag: '@desktop-only' },
  async ({ page }) => {
    const state = createRectangleConnectedFixture()
    state.avoidances[0].radius = 0.98
    await page.goto('/')
    await openAvoidanceProject(page, state)
    const point = await page.getByTestId('segment-avoid:parent:arc').evaluate((node) => {
      const p = (node as SVGPathElement).getPointAtLength(0)
      return { re: (p.x - 400) / 80, im: (300 - p.y) / 80 }
    })
    const factor = 0.9 / 0.98 - 1
    await drag(page, 'avoidance-radius-parent-entry', {
      re: point.re * factor,
      im: (point.im - 1) * factor,
    })
    expect((await savedProject(page)).document.avoidances![0]).toMatchObject({
      radius: expect.closeTo(0.9, 5),
      gap: 0.2,
    })
  },
)

test(
  'zoomed-out overlapping endpoints leave the branch center selectable',
  { tag: '@desktop-only' },
  async ({ page }) => {
    const state = createRectangleConnectedFixture()
    state.vertices = state.vertices.map((p) => ({ ...p, re: p.re * 10 }))
    state.viewport = { ...state.viewport, scaleX: 5, scaleY: 5 }
    await page.goto('/')
    await openAvoidanceProject(page, state)
    await showCanvas(page)
    const marker = await screenPoint(page, 0, 0.125)
    await page.mouse.click(marker.x, marker.y)
    await expect(page.getByRole('heading', { name: '标记点属性', exact: true })).toBeVisible()
  },
)

test(
  'rectangle template gives an isolated y-axis point a visible normal detour',
  { tag: '@desktop-only' },
  async ({ page }) => {
    await page.goto('/')
    await loadTemplate(page, '矩形围道')
    const viewport = (await savedProject(page)).document.view.viewport!
    const templatePoint = (re: number, im: number) =>
      screenPoint(
        page,
        ((re - viewport.centerRe) * viewport.scaleX) / 40,
        ((im - viewport.centerIm) * viewport.scaleY) / 40,
      )
    await page.getByRole('button', { name: '独立点工具', exact: true }).click()
    await showCanvas(page)
    const center = await templatePoint(0, 1.5)
    await page.mouse.click(center.x, center.y)
    await selectObject(page, '选择标记点 1')
    await page.getByLabel('数学类型', { exact: true }).selectOption('isolated')
    await page.getByRole('button', { name: '添加绕行', exact: true }).click()
    await showCanvas(page)
    const source = await templatePoint(-2, 0)
    await page.mouse.click(source.x, source.y)
    const radius = Number(await page.getByLabel('绕行半径', { exact: true }).inputValue())
    const gap = Number(await page.getByLabel('两岸间距', { exact: true }).inputValue())
    expect(radius).toBe(0.4)
    expect(radius * Math.min(viewport.scaleX, viewport.scaleY)).toBeGreaterThanOrEqual(12)
    expect(gap).toBeCloseTo(radius * 0.6, 9)
    await expect(page.getByLabel('开口朝向（度）', { exact: true })).toHaveValue('270')
    await page.getByRole('button', { name: '应用绕行', exact: true }).click()
    const parent = (await savedProject(page)).document.avoidances![0]
    expect(parent).toMatchObject({
      kind: 'corridor',
      radius: expect.closeTo(radius, 9),
      gap: expect.closeTo(gap, 9),
      anchor: { kind: 'segment', segmentId: 'edge-a', t: expect.closeTo(0.5, 6) },
    })
    await showCanvas(page)
    await page.screenshot({ path: '/tmp/opencode/unified-rectangle.png' })
  },
)
