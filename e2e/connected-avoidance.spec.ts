import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { createConnectedFixture } from '../src/test/connectedAvoidanceFixtures'
import { defaultLabel } from '../src/features/contour/appearance'
import { openAvoidanceProject } from './avoidance'
import { selectObject, showCanvas } from './navigation'
import { savedProject, screenPoint } from './selection'

async function at(page: Page, re: number, im: number, scale = 200) {
  // The shared helper uses 40 px/unit; these fixtures intentionally enlarge small radii.
  return screenPoint(page, (re * scale) / 40, (im * scale) / 40)
}
async function click(page: Page, re: number, im: number, scale = 200) {
  await showCanvas(page)
  const p = await at(page, re, im, scale)
  await page.mouse.click(p.x, p.y)
}
async function number(page: Page, name: string, value: string) {
  await page.getByLabel(name, { exact: true }).fill(value)
  await page.getByLabel(name, { exact: true }).press('Enter')
}
async function beginConnected(page: Page) {
  await selectObject(page, '选择标记点 1')
  await expect(page.getByLabel('接入方式', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '添加绕行', exact: true }).click()
}
async function download(page: Page, name: string) {
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name, exact: true }).click()
  const path = await (await pending).path()
  if (!path) throw new Error('Download failed')
  return readFile(path)
}

test(
  'unit circle connects across its seam and clears both banks',
  { tag: '@desktop-only' },
  async ({ page }) => {
    const state = createConnectedFixture({ clearanceRadius: 0.1 })
    state.avoidances = []
    state.viewport = { ...state.viewport, scaleX: 200, scaleY: 200 }
    state.appearance.fill.mode = 'solid'
    await page.goto('/')
    await openAvoidanceProject(page, state)
    await beginConnected(page)
    await click(page, 1, 0)
    const radius = Number(await page.getByLabel('绕行半径', { exact: true }).inputValue())
    expect(radius * 200).toBeGreaterThanOrEqual(20)
    expect(Number(await page.getByLabel('两岸间距', { exact: true }).inputValue())).toBeCloseTo(
      radius * 0.6,
      9,
    )
    await number(page, '两岸间距', '0.04')
    await number(page, '绕行半径', '0.1')
    await expect(page.getByLabel('两岸间距', { exact: true })).toHaveValue('0.04')
    await expect(page.getByTestId('avoidance-preview')).toBeVisible()
    await page.getByRole('button', { name: '应用绕行', exact: true }).click()
    const parentFile = await savedProject(page)
    expect(parentFile.version).toBe(6)
    const parent = parentFile.document.avoidances!.find((a) => a.kind === 'corridor')!
    expect(parent).toMatchObject({
      anchor: { kind: 'vertex', vertexId: 'right' },
      gap: 0.04,
      radius: 0.1,
    })
    await selectObject(page, '选择标记点 2')
    await page.getByRole('button', { name: '添加绕行', exact: true }).click()
    await click(page, 0.75, -0.02)
    await number(page, '绕行半径', '0.1')
    await page.getByRole('button', { name: '应用绕行', exact: true }).click()
    const file = await savedProject(page)
    const child = file.document.avoidances!.find((a) => a.kind === 'bank-clearance')!
    expect(child).toMatchObject({ parentAvoidanceId: parent.id, radius: 0.1 })
    for (const bank of ['entry', 'exit']) {
      const path = page.getByTestId(`segment-avoid:${child.id}:bank-${bank}`)
      await expect(path).toBeVisible()
      const command = (await path.getAttribute('d'))!.split(/\s+/)
      expect(command[3]).toBe('A')
      expect(Number(command[4])).toBeCloseTo(20, 6)
      expect(command[7]).toBe('0') // exterior cap is less than a semicircle
      const xs = [Number(command[1]), Number(command[9])].map((x) => (x - 400) / 200).sort()
      expect(xs[0]).toBeCloseTo(0.5 - Math.sqrt(0.1 ** 2 - 0.02 ** 2), 9)
      expect(xs[1]).toBeCloseTo(0.5 + Math.sqrt(0.1 ** 2 - 0.02 ** 2), 9)
    }
    const fill = await page.getByTestId('contour-path').evaluate((node) =>
      [
        [0, 0],
        [0.5, 0.05],
        [-0.5, 0],
        [0.5, 0.3],
      ].map(([re, im]) =>
        (node as SVGPathElement).isPointInFill(new DOMPoint(400 + re * 200, 300 - im * 200)),
      ),
    )
    expect(fill).toEqual([false, false, true, true])
    // Bulk part edits and parent cancellation are each one real undoable operation.
    await click(page, -0.1, 0)
    const childPoint = await at(page, 0.5, -0.1)
    await page.keyboard.down('Control')
    await page.mouse.click(childPoint.x, childPoint.y)
    await page.keyboard.up('Control')
    await expect(page.getByRole('heading', { name: '多选属性', exact: true })).toBeVisible()
    await page.getByRole('slider', { name: '所选线宽', exact: true }).press('ArrowRight')
    const styled = await savedProject(page)
    expect(
      styled.document.avoidances!.find((a) => a.id === parent.id)?.partStyles?.arc?.width,
    ).toBe(2.5)
    expect(
      styled.document.avoidances!.find((a) => a.id === child.id)?.partStyles?.['bank-entry']?.width,
    ).toBe(2.5)
    await page.getByRole('button', { name: '撤销', exact: true }).click()
    expect((await savedProject(page)).document).toEqual(file.document)
    await click(page, -0.1, 0)
    await page.getByRole('button', { name: '取消绕行', exact: true }).click()
    const canceled = await savedProject(page)
    expect(canceled.document.avoidances).toBeUndefined()
    expect(canceled.document.markers).toEqual(file.document.markers)
    await page.getByRole('button', { name: '撤销', exact: true }).click()
    expect((await savedProject(page)).document).toEqual(file.document)
  },
)

test(
  'open mixed path accepts a connected detour across multiple source segments',
  { tag: '@desktop-only' },
  async ({ page }) => {
    const state = createConnectedFixture()
    state.avoidances = []
    state.vertices = [
      { id: 'a', re: -1, im: 0 },
      { id: 'b', re: -0.1, im: 0.1 },
      { id: 'c', re: 0.1, im: -0.1 },
      { id: 'd', re: 1, im: 0 },
    ]
    state.segments = state.vertices
      .slice(1)
      .map((p, i) => ({ id: `s${i}`, kind: 'line', startId: state.vertices[i].id, endId: p.id }))
    state.closed = false
    state.markers[0].im = 1
    state.viewport = { ...state.viewport, scaleX: 200, scaleY: 200 }
    await page.goto('/')
    await openAvoidanceProject(page, state)
    await beginConnected(page)
    await click(page, 0, 0)
    await number(page, '绕行半径', '0.3')
    await number(page, '两岸间距', '0.4')
    await number(page, '开口朝向（度）', '-90')
    await expect(page.getByRole('button', { name: '应用绕行', exact: true })).toBeEnabled()
    await page.getByRole('button', { name: '应用绕行', exact: true }).click()
    const file = await savedProject(page)
    expect(file.document.closed).toBe(false)
    expect(file.document.segments).toEqual(state.segments)
    await expect(page.getByTestId('segment-s1')).toHaveCount(0)
    const parent = file.document.avoidances![0]
    await expect(page.getByTestId(`segment-avoid:${parent.id}:arc`)).toBeVisible()
  },
)

test(
  'shared child radius drag is one undo step and Escape restores it',
  { tag: '@desktop-only' },
  async ({ page }) => {
    const state = createConnectedFixture({ clearanceRadius: 0.1 })
    state.viewport = { ...state.viewport, scaleX: 200, scaleY: 200 }
    await page.goto('/')
    await openAvoidanceProject(page, state)
    const original = (await savedProject(page)).document
    for (const part of ['bank-entry', 'bank-exit']) {
      const node = page.getByTestId(`avoidance-radius-clearance-${part}-entry`)
      const p = await node.evaluate((element) => {
        const m = (element as SVGGElement).transform.baseVal.getItem(0).matrix
        return { re: (m.e - 400) / 200, im: (300 - m.f) / 200 }
      })
      const from = await at(page, p.re, p.im),
        to = await at(page, 0.5 + 1.5 * (p.re - 0.5), 1.5 * p.im)
      await page.mouse.move(from.x, from.y)
      await page.mouse.down()
      await page.mouse.move(to.x, to.y, { steps: 6 })
      await page.mouse.up()
      expect((await savedProject(page)).document.avoidances![1].radius).toBeCloseTo(0.15, 6)
      await page.getByRole('button', { name: '撤销', exact: true }).click()
      expect((await savedProject(page)).document).toEqual(original)
      await page.mouse.move(from.x, from.y)
      await page.mouse.down()
      await page.mouse.move(to.x, to.y, { steps: 6 })
      await page.keyboard.press('Escape')
      await page.mouse.up()
      expect((await savedProject(page)).document).toEqual(original)
    }
  },
)

test(
  'parent gap preview never leaks into SVG and PNG downloads',
  { tag: '@desktop-only' },
  async ({ page }) => {
    const state = createConnectedFixture({ clearanceRadius: 0.1 })
    state.viewport = { ...state.viewport, scaleX: 200, scaleY: 200 }
    state.markers.push({ ...state.markers[1], id: 'other', re: 0.75 })
    state.avoidances[1].partLabels = {
      'bank-entry': { ...defaultLabel('C_1'), dx: 80 },
      'bank-exit': defaultLabel('C_2'),
    }
    await page.goto('/')
    await openAvoidanceProject(page, state)
    const original = (await savedProject(page)).document
    await page.locator('summary[aria-label="导出图像"]').click()
    await page.getByRole('checkbox', { name: '包含坐标轴', exact: true }).uncheck()
    const before = (await download(page, '导出 SVG')).toString()
    await page.locator('summary[aria-label="导出图像"]').click()
    await selectObject(page, '选择标记点 3')
    await page.getByRole('button', { name: '添加绕行', exact: true }).click()
    await click(page, 0.85, -0.02)
    await number(page, '两岸间距', '0.06')
    await expect(page.getByTestId('avoidance-preview')).toBeVisible()
    await page.locator('summary[aria-label="导出图像"]').click()
    const during = (await download(page, '导出 SVG')).toString()
    const geometry = (text: string) =>
      page.evaluate((value) => {
        const doc = new DOMParser().parseFromString(value, 'image/svg+xml')
        return {
          paths: [...doc.querySelectorAll('path[stroke]')].map((p) => p.getAttribute('d')),
          width: Number(doc.documentElement.getAttribute('width')),
          height: Number(doc.documentElement.getAttribute('height')),
          labels: [...doc.querySelectorAll('g[aria-label]')].map((p) =>
            p.getAttribute('aria-label'),
          ),
        }
      }, text)
    const appliedGeometry = await geometry(before)
    expect(await geometry(during)).toEqual(appliedGeometry)
    expect(during).not.toMatch(/data-|segment-hit|avoidance-preview|<foreignObject/)
    expect(appliedGeometry.labels.filter((s) => s === 'C_1')).toHaveLength(1)
    expect(appliedGeometry.labels.filter((s) => s === 'C_2')).toHaveLength(1)
    const png = await download(page, '导出 PNG')
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([
      Math.ceil(appliedGeometry.width * 2),
      Math.ceil(appliedGeometry.height * 2),
    ])
    expect((await savedProject(page)).document).toEqual(original)
  },
)

test(
  'bank fragment selection keeps its editor and input focus after child cuts disappear',
  { tag: '@desktop-only' },
  async ({ page }) => {
    const state = createConnectedFixture({ clearanceRadius: 0.05 })
    state.viewport = { ...state.viewport, scaleX: 200, scaleY: 200 }
    await page.goto('/')
    await openAvoidanceProject(page, state)
    await click(page, 0.75, -0.02)
    await expect(page.getByRole('heading', { name: '绕行属性', exact: true })).toBeVisible()
    const field = page.getByLabel('两岸间距', { exact: true })
    await field.fill('0.12')
    await field.press('Enter')
    await expect(field).toBeFocused()
    await expect(field).toHaveValue('0.12')
    await expect(page.getByLabel('绕行部件', { exact: true })).toHaveValue('entry')
    await expect(page.getByTestId('segment-avoid:clearance:bank-entry')).toHaveCount(0)
    await page.getByRole('slider', { name: '线条粗细', exact: true }).press('ArrowRight')
    expect((await savedProject(page)).document.avoidances![0].partStyles?.entry?.width).toBe(2.5)
  },
)

test('narrow connected picking and Escape restore focus without applying a document', async ({
  page,
}) => {
  test.skip(page.viewportSize()!.width > 700, 'Narrow overlay and focus only')
  const state = createConnectedFixture()
  state.avoidances = []
  state.viewport = { ...state.viewport, scaleX: 100, scaleY: 100 }
  await page.goto('/')
  await openAvoidanceProject(page, state)
  const original = (await savedProject(page)).document
  await beginConnected(page)
  await expect(page.getByTestId('contour-canvas')).toBeFocused()
  await click(page, 1, 0, 100)
  await expect(page.getByLabel('两岸间距', { exact: true })).toBeVisible()
  await expect(page.getByLabel('属性面板内容', { exact: true })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('avoidance-preview')).toHaveCount(0)
  expect((await savedProject(page)).document).toEqual(original)
})
