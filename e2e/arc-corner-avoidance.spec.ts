import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { createInitialState } from '../src/features/contour/model'
import { openAvoidanceProject } from './avoidance'
import { selectObject, showCanvas } from './navigation'
import { clickPoint, savedProject, screenPoint } from './selection'
import { createAvoidanceFixture } from '../src/test/avoidanceFixtures'

function rectangle() {
  const state = createInitialState()
  state.vertices = [
    { id: 'a', re: 0, im: 2 },
    { id: 'b', re: 0, im: 0 },
    { id: 'c', re: 3, im: 0 },
    { id: 'd', re: 3, im: 2 },
  ]
  return state
}

async function radius(page: Page, value: string) {
  await page.getByLabel('绕行半径', { exact: true }).fill(value)
  await page.getByLabel('绕行半径', { exact: true }).press('Enter')
}

async function command(page: Page, id: string) {
  return (await page.getByTestId(`segment-${id}`).getAttribute('d'))!.split(/\s+/)
}

async function download(page: Page, name: string) {
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name, exact: true }).click()
  const path = await (await pending).path()
  if (!path) throw new Error('Image download failed')
  return readFile(path)
}

// Read the actual SVG endpoint command. Expectations below are analytic literals,
// independent of the application's constructor, resolver and circle fitting.
function endpoints(parts: string[]) {
  expect([parts[0], parts[3]]).toEqual(['M', 'A'])
  return [
    [Number(parts[1]), Number(parts[2])],
    [Number(parts[9]), Number(parts[10])],
  ].map(([x, y]) => ({ re: (x - 400) / 40, im: (300 - y) / 40 }))
}

for (const mode of ['arc', 'corner'] as const) {
  test(
    `either ${mode} radius handle moves both endpoints atomically and supports undo and Escape`,
    { tag: '@desktop-only' },
    async ({ page }) => {
      const state = createAvoidanceFixture()
      if (mode === 'arc') {
        state.vertices = [
          { id: 'a', re: -3, im: 0 },
          { id: 'b', re: 3, im: 0 },
        ]
        state.segments = [
          { id: 'edge-a', kind: 'arc', startId: 'a', endId: 'b', through: { re: 0, im: 3 } },
        ]
        state.closed = false
        state.markers[0].im = 3
        state.markers[0].label.visible = false
      } else {
        state.vertices[1].mathematicalKind = 'pole'
        state.avoidances[0] = { ...state.avoidances[0], markerId: 'b', exitSegmentId: 'edge-b' }
        state.markers = []
      }
      const center = mode === 'arc' ? { re: 0, im: 3 } : { re: 4, im: 0 }
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.goto('/')
      await openAvoidanceProject(page, state)
      const original = (await savedProject(page)).document
      // Include every template thumbnail in the before/during/after paint oracle.
      await page.getByRole('button', { name: '画布与模板', exact: true }).click()
      await page.getByRole('tab', { name: '示例模板' }).click()
      const paint = () =>
        page
          .locator(
            '.scene-thumbnail, .tool-palette button, .global-actions button:not([aria-label="撤销"]):not([aria-label="重做"])',
          )
          .evaluateAll((nodes) =>
            nodes.map((node) => {
              const s = getComputedStyle(node)
              return [s.color, s.opacity, s.backgroundColor, s.fill, s.stroke, s.filter]
            }),
          )
      for (const end of ['entry', 'exit']) {
        const points = endpoints(await command(page, 'avoid:avoid-1:arc'))
        const p = points[end === 'entry' ? 0 : 1]
        const target = {
          re: center.re + 1.5 * (p.re - center.re),
          im: center.im + 1.5 * (p.im - center.im),
        }
        const from = await screenPoint(page, p.re, p.im)
        const to = await screenPoint(page, target.re, target.im)
        await page.mouse.move(from.x, from.y)
        const beforePaint = await paint()
        await page.mouse.down()
        await page.mouse.move(to.x, to.y, { steps: 6 })
        expect(await paint()).toEqual(beforePaint)
        for (const endpoint of endpoints(await command(page, 'avoid:avoid-1:arc'))) {
          expect(Math.hypot(endpoint.re - center.re, endpoint.im - center.im)).toBeCloseTo(0.75, 5)
          if (mode === 'arc') expect(Math.hypot(endpoint.re, endpoint.im)).toBeCloseTo(3, 9)
          else expect(Math.min(Math.abs(endpoint.re - 4), Math.abs(endpoint.im))).toBeCloseTo(0, 9)
        }
        await page.mouse.up()
        expect(await paint()).toEqual(beforePaint)
        expect((await savedProject(page)).document.avoidances![0].radius).toBeCloseTo(0.75, 5)
        await page.getByRole('button', { name: '撤销', exact: true }).click()
        expect((await savedProject(page)).document).toEqual(original)
        await showCanvas(page)
        await page.mouse.move(from.x, from.y)
        await page.mouse.down()
        await page.mouse.move(to.x, to.y, { steps: 6 })
        await page.keyboard.press('Escape')
        await page.mouse.up()
        expect((await savedProject(page)).document).toEqual(original)
        await showCanvas(page)
      }
    },
  )
}

test('narrow open-endpoint error opens and focuses Inspector; retry exposes canvas and Escape cancels without history', async ({
  page,
}) => {
  test.skip(page.viewportSize()!.width > 700, 'Narrow Inspector overlay regression')
  await page.goto('/')
  const state = rectangle()
  state.closed = false
  state.vertices[0].mathematicalKind = 'pole'
  await openAvoidanceProject(page, state)
  await expect(page.getByLabel('画布保存状态')).toContainText('已保存')
  await page.reload() // Restore the fixture as initial state, without the undoable file-open step.
  await showCanvas(page)
  const before = await savedProject(page)
  await selectObject(page, '选择顶点 z1')
  await page.getByRole('button', { name: '添加绕行', exact: true }).click()
  const panel = page.locator('#properties-panel')
  const canvas = page.getByTestId('contour-canvas')
  await expect(panel).toBeHidden()
  await clickPoint(page, 0, 1)
  await expect(panel).toBeVisible()
  await expect(page.getByRole('alert')).toContainText('可见进入路径')
  await expect(page.getByLabel('属性面板内容', { exact: true })).toBeFocused()
  await page.getByRole('button', { name: '重新选择目标', exact: true }).click()
  await expect(panel).toBeHidden()
  await expect(canvas).toBeFocused()
  // A second actual canvas click verifies that retry retained the picking draft.
  await clickPoint(page, 0, 1)
  await expect(page.getByRole('alert')).toBeVisible()
  await page.getByRole('button', { name: '重新选择目标', exact: true }).click()
  await expect(canvas).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(panel.getByRole('button', { name: '取消选择目标', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: '重做', exact: true })).toBeDisabled()
  expect((await savedProject(page)).document).toEqual(before.document)
})

test(
  'source arc uses two real circle intersections and retains both source arcs',
  { tag: '@desktop-only' },
  async ({ page }) => {
    await page.goto('/')
    const state = rectangle()
    state.closed = false
    state.vertices = [
      { id: 'a', re: -3, im: 0 },
      { id: 'b', re: 3, im: 0 },
    ]
    state.segments = [
      { id: 'upper', kind: 'arc', startId: 'a', endId: 'b', through: { re: 0, im: 3 } },
    ]
    await openAvoidanceProject(page, state)
    await page.getByRole('button', { name: '独立点工具', exact: true }).click()
    await clickPoint(page, 0, 3)
    await selectObject(page, '选择标记点 1')
    await page.getByLabel('数学类型', { exact: true }).selectOption('isolated')
    await page.getByRole('button', { name: '添加绕行', exact: true }).click()
    await clickPoint(page, -Math.sqrt(4.5), Math.sqrt(4.5))
    await radius(page, '0.5')
    await expect(page.getByTestId('avoidance-preview')).toBeVisible()
    const previewFill = await page.getByTestId('contour-path').getAttribute('d')
    const previewArc = await page.locator('[data-preview-part$=":arc"]').getAttribute('d')
    await expect(page.getByTestId('segment-upper')).toHaveCount(0)
    await page.getByRole('button', { name: '应用绕行', exact: true }).click()
    const file = await savedProject(page)
    const binding = file.document.avoidances![0]
    const actual = await command(page, `avoid:${binding.id}:arc`)
    expect(await page.getByTestId('contour-path').getAttribute('d')).toBe(previewFill)
    expect(actual.join(' ')).toBe(previewArc)
    for (const p of endpoints(actual)) {
      expect(Math.hypot(p.re, p.im)).toBeCloseTo(3, 9)
      expect(Math.hypot(p.re, p.im - 3)).toBeCloseTo(0.5, 9)
      expect(p.im).toBeCloseTo(71 / 24, 9)
    }
    const retained = page.locator('[data-testid^="segment-gap:upper:"]')
    await expect(retained).toHaveCount(2)
    for (const p of await retained.all()) {
      const parts = (await p.getAttribute('d'))!.split(/\s+/)
      expect(parts[3]).toBe('A')
      expect(Number(parts[4])).toBeCloseTo(120, 9)
    }
    await expect(page.locator('[data-testid^="through-avoid:"]')).toHaveCount(0)
    expect(file.document.vertices).toHaveLength(2)
    expect(file.document.segments).toHaveLength(1)
  },
)

test(
  'existing rectangle vertex defaults to a short quarter arc; edits undo, reverse and reopen preserve the binding',
  { tag: '@desktop-only' },
  async ({ page }) => {
    await page.goto('/')
    await openAvoidanceProject(page, rectangle())
    await page.getByRole('button', { name: '独立点工具', exact: true }).click()
    await clickPoint(page, 0, 0)
    await selectObject(page, '选择顶点 z2')
    await page.getByLabel('数学类型', { exact: true }).selectOption('isolated')
    await page.getByRole('button', { name: '添加绕行', exact: true }).click()
    await clickPoint(page, 1, 0) // Picking the outgoing edge must still normalize to incoming.
    await radius(page, '0.5')
    const previewFill = await page.getByTestId('contour-path').getAttribute('d')
    expect(previewFill).toContain('A 20 20')
    await expect(page.getByTestId('segment-edge-a')).toHaveCount(0)
    await page.getByRole('button', { name: '应用绕行', exact: true }).click()
    expect(await page.getByTestId('contour-path').getAttribute('d')).toBe(previewFill)
    const short = await savedProject(page)
    const binding = short.document.avoidances![0]
    expect(short.document.markers).toHaveLength(0)
    expect(short.document.vertices).toHaveLength(4)
    expect(binding).toMatchObject({
      markerId: 'b',
      targetSegmentId: 'edge-a',
      exitSegmentId: 'edge-b',
      side: 'left',
    })
    const initial = await command(page, `avoid:${binding.id}:arc`)
    const points = endpoints(initial)
    expect(points[0].re).toBeCloseTo(0, 10)
    expect(points[0].im).toBeCloseTo(0.5, 10)
    expect(points[1].re).toBeCloseTo(0.5, 10)
    expect(points[1].im).toBeCloseTo(0, 10)
    expect(initial.slice(7, 9)).toEqual(['0', '1'])
    const fill = await page.getByTestId('contour-path').getAttribute('d')
    expect(fill).toContain('A 20 20 0 0 1 420 300')
    expect(fill).not.toContain('L 400 300') // Fill follows the cut corner, not the old vertex.
    expect(fill!.trim()).toMatch(/Z$/)

    // Populate future history as well as past, then exercise real image downloads.
    await radius(page, '0.625')
    const redoDocument = (await savedProject(page)).document
    await page.getByRole('button', { name: '撤销', exact: true }).click()
    const before = await savedProject(page)
    const scene = await page.getByTestId('contour-canvas').innerHTML()
    const history = async () =>
      Promise.all(
        ['撤销', '重做'].map((name) => page.getByRole('button', { name, exact: true }).isEnabled()),
      )
    const historyBefore = await history()
    expect(historyBefore).toEqual([true, true])
    await page.locator('summary[aria-label="导出图像"]').click()
    await page.getByRole('checkbox', { name: '包含坐标轴', exact: true }).uncheck()
    await page.getByRole('checkbox', { name: '包含网格', exact: true }).uncheck()
    await page.getByRole('checkbox', { name: '包含围道端点标记', exact: true }).uncheck()
    const svg = (await download(page, '导出 SVG')).toString()
    expect(svg).not.toMatch(
      /data-|segment-hit|selection-rectangle|avoidance-preview|through-|<foreignObject/,
    )
    const exported = await page.evaluate((text) => {
      const doc = new DOMParser().parseFromString(text, 'image/svg+xml')
      const root = doc.documentElement
      return {
        width: Number(root.getAttribute('width')),
        height: Number(root.getAttribute('height')),
        circles: [...root.querySelectorAll('circle')].map((circle) => {
          const translate = /^translate\((\S+) (\S+)\)$/.exec(
            circle.parentElement!.getAttribute('transform')!,
          )!
          return {
            cx: Number(circle.getAttribute('cx')) + Number(translate[1]),
            cy: Number(circle.getAttribute('cy')) + Number(translate[2]),
          }
        }),
        arcs: [...root.querySelectorAll('path[fill="none"]')]
          .map((path) => path.getAttribute('d')!)
          .filter((d) => /^M \S+ \S+ A /.test(d)),
        fill: root.querySelector('path[fill-rule="nonzero"]')!.getAttribute('d')!,
      }
    }, svg)
    expect(exported.circles).toHaveLength(1) // One semantic vertex, no marker copy/joints.
    expect(exported.arcs).toHaveLength(1)
    const center = exported.circles[0]
    const exportedArc = exported.arcs[0].split(/\s+/)
    // Complete export recenters its own viewport. Check geometry relative to the
    // real semantic point instead of assuming the editor's screen origin survives.
    expect(Number(exportedArc[1])).toBeCloseTo(center.cx, 9)
    expect(Number(exportedArc[2])).toBeCloseTo(center.cy - 20, 9)
    expect(Number(exportedArc[9])).toBeCloseTo(center.cx + 20, 9)
    expect(Number(exportedArc[10])).toBeCloseTo(center.cy, 9)
    expect(exportedArc.slice(3, 9)).toEqual(['A', '20', '20', '0', '0', '1'])
    expect(exported.fill).toContain(exportedArc.slice(3).join(' '))
    expect(exported.fill).not.toContain(`L ${center.cx} ${center.cy}`)
    expect(exported.fill.trim()).toMatch(/Z$/)
    await page.getByLabel('PNG 分辨率').selectOption('2')
    const png = await download(page, '导出 PNG')
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
    const dimensions = await page.evaluate(async (base64) => {
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
      const image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
      const result = [image.width, image.height]
      image.close()
      return result
    }, png.toString('base64'))
    expect(dimensions).toEqual([Math.ceil(exported.width * 2), Math.ceil(exported.height * 2)])
    await page.locator('summary[aria-label="导出图像"]').click()
    expect(await page.getByTestId('contour-canvas').innerHTML()).toBe(scene)
    expect(await savedProject(page)).toEqual(before)
    expect(await history()).toEqual(historyBefore)
    await page.getByRole('button', { name: '重做', exact: true }).click()
    expect((await savedProject(page)).document).toEqual(redoDocument)
    await page.getByRole('button', { name: '撤销', exact: true }).click()
    expect((await savedProject(page)).document).toEqual(before.document)

    await page.getByLabel('绕行侧', { exact: true }).selectOption('right')
    expect((await command(page, `avoid:${binding.id}:arc`)).slice(7, 9)).toEqual(['1', '0'])
    await radius(page, '0.75')
    await page.getByRole('button', { name: '撤销', exact: true }).click()
    await expect(page.getByLabel('绕行半径', { exact: true })).toHaveValue('0.5')
    await expect(page.getByLabel('绕行侧', { exact: true })).toHaveValue('right')
    await page.getByRole('button', { name: '定位奇点', exact: true }).click()
    await page.getByRole('button', { name: '反转方向', exact: true }).click()
    const reversed = await savedProject(page)
    expect(reversed.document.avoidances![0]).toMatchObject({
      targetSegmentId: 'edge-b',
      exitSegmentId: 'edge-a',
      side: 'left',
      radius: 0.5,
    })
    await openAvoidanceProject(page, reversed)
    expect((await savedProject(page)).document).toEqual(reversed.document)
    await showCanvas(page)
    await expect(page.getByTestId('vertex-b')).toBeVisible()
    await expect(page.locator('[data-testid^="marker-"]')).toHaveCount(0)
  },
)

test(
  'a fitted corner keeps its short branch through invalid radius repair unless explicitly overridden',
  { tag: '@desktop-only' },
  async ({ page }) => {
    await page.goto('/')
    for (const explicit of [false, true]) {
      const state = rectangle()
      // Zoom does not change defaults; the short edge requires a smaller initial radius.
      state.viewport = { ...state.viewport, scaleX: 4.8, scaleY: 4.8 }
      state.vertices = [
        { id: 'a', re: 0, im: 100 },
        { id: 'b', re: 0, im: 0, mathematicalKind: 'pole' },
        { id: 'c', re: -1, im: 0 },
        { id: 'd', re: -1, im: 100 },
      ]
      await openAvoidanceProject(page, state)
      await expect(page.getByLabel('画布保存状态')).toContainText('已保存')
      await page.reload() // Match a fresh document's empty history, rather than undoable import.
      await showCanvas(page)
      const before = (await savedProject(page)).document
      await selectObject(page, '选择顶点 z2')
      await page.getByRole('button', { name: '添加绕行', exact: true }).click()
      // The two vertical source hit regions overlap at overview scale; use the
      // right edge of the incoming path's hit stroke, clear of the opposite edge.
      await clickPoint(page, 0.125, 1)
      await expect(page.getByLabel('绕行半径', { exact: true })).toHaveValue('0.625')
      await expect(page.getByLabel('绕行侧', { exact: true })).toHaveValue('right')
      await radius(page, '5')
      await expect(page.getByRole('alert')).toBeVisible()
      await expect(page.getByRole('button', { name: '应用绕行', exact: true })).toBeDisabled()
      if (explicit) {
        await page.getByLabel('绕行侧', { exact: true }).selectOption('right')
        await page.getByLabel('绕行侧', { exact: true }).selectOption('left')
      }
      await radius(page, '0.5')
      await expect(page.getByLabel('绕行侧', { exact: true })).toHaveValue(
        explicit ? 'left' : 'right',
      )
      const preview = page.locator(
        '[data-testid="avoidance-preview"] path[data-preview-part$=":arc"]',
      )
      const d = (await preview.getAttribute('d'))!
      const parts = d.split(/\s+/)
      expect(parts.slice(7, 9)).toEqual(explicit ? ['1', '1'] : ['0', '0'])
      const [entry, exit] = endpoints(parts)
      expect(entry.re).toBeCloseTo(0, 10)
      expect((entry.im * 40) / 4.8).toBeCloseTo(0.5, 10)
      expect((exit.re * 40) / 4.8).toBeCloseTo(-0.5, 10)
      expect(exit.im).toBeCloseTo(0, 10)
      const actual = await preview.evaluate((node) => {
        const path = node as SVGPathElement
        const length = path.getTotalLength()
        const p = path.getPointAtLength(length / 2)
        return { re: (p.x - 400) / 4.8, im: (300 - p.y) / 4.8, length: length / 4.8 }
      })
      // Analytic +π/2 versus -3π/2 traversal around C=(0,0); no app geometry oracle.
      const sign = explicit ? 1 : -1
      expect(Math.abs(actual.re - (sign * Math.SQRT1_2) / 2)).toBeLessThan(0.05 / 4.8)
      expect(Math.abs(actual.im + (sign * Math.SQRT1_2) / 2)).toBeLessThan(0.05 / 4.8)
      expect(Math.abs(actual.length - ((explicit ? 3 : 1) * Math.PI) / 4)).toBeLessThan(0.05 / 4.8)
      await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled()
      await page.getByRole('button', { name: '应用绕行', exact: true }).click()
      const binding = (await savedProject(page)).document.avoidances![0]
      expect(binding.side).toBe(explicit ? 'left' : 'right')
      await expect(page.getByTestId(`segment-avoid:${binding.id}:arc`)).toHaveAttribute('d', d)
      await page.getByRole('button', { name: '撤销', exact: true }).click()
      expect((await savedProject(page)).document).toEqual(before)
      await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled()
    }
  },
)

test(
  'mixed line/arc corner clips the outgoing circle rather than its chord',
  { tag: '@desktop-only' },
  async ({ page }) => {
    await page.goto('/')
    const state = rectangle()
    state.vertices[2].re = 2
    state.segments[1] = { ...state.segments[1], kind: 'arc', through: { re: 1, im: -1 } }
    await openAvoidanceProject(page, state)
    await selectObject(page, '选择顶点 z2')
    await page.getByLabel('数学类型', { exact: true }).selectOption('isolated')
    await page.getByRole('button', { name: '添加绕行', exact: true }).click()
    await clickPoint(page, 1 + Math.SQRT1_2, -Math.SQRT1_2)
    await radius(page, '0.5')
    await page.getByRole('button', { name: '应用绕行', exact: true }).click()
    const file = await savedProject(page)
    const id = file.document.avoidances![0].id
    const [entry, exit] = endpoints(await command(page, `avoid:${id}:arc`))
    expect(entry.re).toBeCloseTo(0, 9)
    expect(entry.im).toBeCloseTo(0.5, 9)
    expect(exit.re).toBeCloseTo(1 / 8, 9)
    expect(exit.im).toBeCloseTo(-Math.sqrt(15) / 8, 9)
    expect(Math.hypot(exit.re - 1, exit.im)).toBeCloseTo(1, 9)
    const retained = page.locator('[data-testid^="segment-gap:edge-b:"]')
    await expect(retained).toHaveCount(1)
    const parts = (await retained.getAttribute('d'))!.split(/\s+/)
    expect(parts[3]).toBe('A')
    expect(Number(parts[4])).toBeCloseTo(40, 9)
    expect(file.document.markers).toHaveLength(0)
  },
)
