import { expect, test, type Locator, type Page } from '@playwright/test'
import { openSection, openView, selectObject, openTemplates } from './navigation'
import { loadBoxFixture, screenPoint, savedProject } from './selection'
import { createAvoidanceFixture } from '../src/test/avoidanceFixtures'
import { defaultLabel } from '../src/features/contour/appearance'
import { openAvoidanceProject } from './avoidance'
import {
  createConnectedFixture,
  createRectangleConnectedFixture,
} from '../src/test/connectedAvoidanceFixtures'
import { createInitialState } from '../src/features/contour/model'
import { createArcFixture } from '../src/test/fixtures'

test(
  'arrow drags preserve all template previews and global control paints',
  { tag: '@desktop-only' },
  async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/')
    await openAvoidanceProject(page, createArcFixture())
    await openTemplates(page)
    await expect(page.locator('.template-grid .scene-thumbnail')).toHaveCount(9)
    const from = await screenPoint(page, 0, 0)
    await stableDrag(page, from, { x: from.x + 35, y: from.y })
    expect((await savedProject(page)).document.segments[0].arrowPosition).toBeGreaterThan(0.5)
  },
)

test(
  'marquee selects a semantic vertex with hidden handles without changing template paints',
  { tag: '@desktop-only' },
  async ({ page }) => {
    const state = createInitialState()
    state.vertices = state.vertices.map((v) => ({
      ...v,
      re: v.re / 2,
      im: (v.im * 2) / 3,
      label: { ...defaultLabel(), visible: false },
    }))
    state.vertices[0].mathematicalKind = 'isolated'
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/')
    await openAvoidanceProject(page, state)
    await openView(page)
    await page.getByLabel('显示编辑手柄', { exact: true }).uncheck()
    await openTemplates(page)
    await expect(page.locator('.template-grid .scene-thumbnail')).toHaveCount(9)
    await page.getByRole('button', { name: '框选工具', exact: true }).click()
    await stableDrag(page, await screenPoint(page, -2.3, -0.3), await screenPoint(page, -1.7, 0.3))
    await expect(page.getByTestId('selection-toolbar')).toContainText('1 个对象')
    const before = await savedProject(page)
    const from = await screenPoint(page, -2, 0)
    await stableDrag(page, from, { x: from.x + 40, y: from.y - 40 })
    expect((await savedProject(page)).document.vertices[0]).toMatchObject({ re: -1, im: 1 })
    await page.getByRole('button', { name: '撤销', exact: true }).click()
    expect((await savedProject(page)).document).toEqual(before.document)
  },
)

test(
  'source positioning and independent spacing drags preserve template and global control paints',
  { tag: '@desktop-only' },
  async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/')
    await openAvoidanceProject(page, createRectangleConnectedFixture())
    await openTemplates(page)
    for (const [id, dx, dy] of [
      ['avoidance-port-parent-entry', 4, 0],
      ['avoidance-gap-parent', 4, 0],
    ] as const) {
      const from = await page.getByTestId(id).evaluate((node) => {
        const p = new DOMPoint(0, 0).matrixTransform((node as SVGGraphicsElement).getScreenCTM()!)
        return { x: p.x, y: p.y }
      })
      await stableDrag(page, from, { x: from.x + dx, y: from.y + dy })
    }
  },
)

test(
  'connected parent and child radius handles preserve all template paints',
  { tag: '@desktop-only' },
  async ({ page }) => {
    const state = createConnectedFixture({ clearanceRadius: 0.1 })
    state.viewport = { ...state.viewport, scaleX: 200, scaleY: 200 }
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/')
    await openAvoidanceProject(page, state)
    await openTemplates(page)
    await expect(page.locator('.template-grid .scene-thumbnail')).toHaveCount(9)
    for (const [handleId, centerX] of [
      ['avoidance-radius-parent-entry', 400],
      ['avoidance-radius-clearance-bank-exit-entry', 500],
    ] as const) {
      const handle = page.getByTestId(handleId)
      const point = await handle.evaluate((element) => {
        const m = (element as SVGGElement).transform.baseVal.getItem(0).matrix
        return { x: m.e, y: m.f }
      })
      const from = await screenPoint(page, (point.x - 400) / 40, (300 - point.y) / 40)
      const to = await screenPoint(
        page,
        (centerX + 1.4 * (point.x - centerX) - 400) / 40,
        (-1.4 * (point.y - 300)) / 40,
      )
      await stableDrag(page, from, to)
    }
  },
)

async function paint(page: Page) {
  return page
    .locator(
      '.template-card, .scene-thumbnail, .tool-palette button, .template-panel button, .rail-bottom button, .view-toolbar button, .global-actions button, .export-menu > summary, .export-options input, .export-options select',
    )
    .evaluateAll((nodes) =>
      nodes.map((node) => {
        const style = getComputedStyle(node)
        return {
          name: node.getAttribute('aria-label'),
          opacity: style.opacity,
          color: style.color,
          background: style.backgroundColor,
          border: style.borderColor,
          filter: style.filter,
          fill: style.fill,
          stroke: style.stroke,
          fillOpacity: style.fillOpacity,
          strokeOpacity: style.strokeOpacity,
        }
      }),
    )
}

async function stableDrag(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  await page.mouse.move(from.x, from.y)
  const before = await paint(page)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 6 })
  expect(await paint(page)).toEqual(before)
  await expect(page.getByRole('button', { name: '保存项目', exact: true })).toHaveAttribute(
    'aria-disabled',
    'true',
  )
  await page.mouse.up()
  expect(unrelated(await paint(page))).toEqual(unrelated(before))
}

// Real undo/redo availability may change after a committed edit, never mid-gesture.
function unrelated(values: Awaited<ReturnType<typeof paint>>) {
  return values.filter(({ name }) => name !== '撤销' && name !== '重做')
}

test(
  'bound pole, part label and actual-arc selection gestures preserve global paint and ALL nine complete template previews',
  { tag: '@desktop-only' },
  async ({ page }) => {
    const state = createAvoidanceFixture()
    state.markers[0].label.visible = false
    state.avoidances[0].partLabels = { arc: { ...defaultLabel('A'), dx: 50, dy: -60 } }
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/')
    await openAvoidanceProject(page, state)
    await openTemplates(page)
    await expect(page.locator('.template-card')).toHaveCount(9)
    await expect(page.locator('.template-grid .scene-thumbnail')).toHaveCount(9)
    for (const id of ['marker-pole', 'label-handle-avoid:avoid-1:arc']) {
      const box = (await page.getByTestId(id).boundingBox())!
      const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
      // This paint regression deliberately moves the pole off its source baseline.
      if (id === 'marker-pole') await page.keyboard.down('Alt')
      await stableDrag(page, from, { x: from.x + 40, y: from.y - 20 })
      if (id === 'marker-pole') await page.keyboard.up('Alt')
    }
    const moved = await savedProject(page)
    expect(moved.document.markers[0]).toMatchObject({ re: 1, im: 0.5 })
    expect(moved.document.avoidances![0].partLabels!.arc).toMatchObject({ dx: 90, dy: -80 })
    await page.getByRole('button', { name: '框选工具', exact: true }).click()
    // Include the complete arc (bottom y≈298.32), not the two tiny connectors
    // whose actual strokes extend to y=301; do not rely on old fixed arrow padding.
    const from = await screenPoint(page, 0, 0.025)
    const to = await screenPoint(page, 2, 3.5)
    await stableDrag(page, from, to)
    await expect(page.getByTestId('selection-toolbar')).toContainText('2 个对象')
    await expect(page.getByTestId('selection-rectangle')).toBeVisible()
    const drag = await screenPoint(page, 1.1, 0.7)
    await stableDrag(page, drag, { x: drag.x + 40, y: drag.y - 20 })
    const translated = await savedProject(page)
    expect(translated.document.markers[0].re).toBeCloseTo(2, 10)
    expect(translated.document.markers[0].im).toBeCloseTo(1, 10)
    for (const [index, re] of [-3, 5].entries()) {
      expect(translated.document.vertices[index].re).toBeCloseTo(re, 10)
      expect(translated.document.vertices[index].im).toBeCloseTo(0.5, 10)
    }
  },
)

async function dragSlider(page: Page, slider: Locator) {
  await slider.scrollIntoViewIfNeeded()
  const box = (await slider.boundingBox())!
  const value = Number(await slider.inputValue()),
    min = Number(await slider.getAttribute('min')),
    max = Number(await slider.getAttribute('max'))
  const x = box.x + 8 + ((box.width - 16) * (value - min)) / (max - min)
  await page.mouse.move(x, box.y + box.height / 2)
  const before = await paint(page)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.75, box.y + box.height / 2, { steps: 5 })
  expect(await paint(page)).toEqual(before)
  await page.mouse.up()
  expect(unrelated(await paint(page))).toEqual(unrelated(before))
}

test(
  'dragging points and labels leaves all nine template previews and other controls unchanged',
  { tag: '@desktop-only' },
  async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/')
    await loadBoxFixture(page)
    await openTemplates(page)
    await expect(page.locator('.template-card')).toHaveCount(9)
    for (const id of ['vertex-a', 'label-handle-a']) {
      const box = (await page.getByTestId(id).boundingBox())!
      const x = box.x + box.width / 2,
        y = box.y + box.height / 2
      await page.mouse.move(x, y)
      const before = await paint(page)
      await page.mouse.down()
      await page.mouse.move(x + 40, y + 20, { steps: 5 })
      expect(await paint(page)).toEqual(before)
      await page.mouse.up()
      expect(unrelated(await paint(page))).toEqual(unrelated(before))
    }
  },
)

test(
  'offset and axis sliders keep previews and unrelated controls visually stable',
  { tag: '@desktop-only' },
  async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/')
    await loadBoxFixture(page)
    await selectObject(page, '选择顶点 z1')
    await page.getByRole('button', { name: '收起对象列表', exact: true }).click()
    await openSection(page, '标签')
    await openTemplates(page)
    await expect(page.locator('.template-card')).toHaveCount(9)
    for (const name of ['标签水平偏移', '标签垂直偏移'])
      await dragSlider(page, page.getByRole('slider', { name, exact: true }))
    await openView(page)
    for (const name of ['坐标轴线宽', '坐标轴箭头大小'])
      await dragSlider(page, page.getByRole('slider', { name, exact: true }))
  },
)
