import { expect, test, type Page } from '@playwright/test'
import { defaultLabel, defaultPointStyle } from '../src/features/contour/appearance'
import { createInitialState, type ContourState } from '../src/features/contour/model'
import { createAvoidanceFixture } from '../src/test/avoidanceFixtures'
import { openAvoidanceProject } from './avoidance'
import { selectObject, showCanvas } from './navigation'
import { savedProject } from './selection'

function fixture(arc = false): ContourState {
  const state = createInitialState()
  state.vertices = arc
    ? [
        { id: 'a', re: 2, im: 0 },
        { id: 'b', re: -2, im: 0 },
      ]
    : [
        { id: 'a', re: -3, im: -1.5 },
        { id: 'b', re: 3, im: 1.5 },
      ]
  state.segments = [
    {
      id: 'edge-a',
      startId: 'a',
      endId: 'b',
      ...(arc
        ? ({ kind: 'arc', through: { re: 0, im: 2 } } as const)
        : ({ kind: 'line' } as const)),
    },
  ]
  state.closed = false
  state.markers = []
  state.avoidances = []
  return state
}

function addMarker(state: ContourState, re = 0, im = 0) {
  state.markers = [
    {
      id: 'marker',
      re,
      im,
      label: { ...defaultLabel(), visible: false },
      pointStyle: defaultPointStyle(),
    },
  ]
}

async function at(page: Page, state: ContourState, re: number, im: number) {
  return page.getByTestId('contour-canvas').evaluate(
    (node, { view, re, im }) => {
      const p = new DOMPoint(
        400 + (re - view.centerRe) * view.scaleX,
        300 - (im - view.centerIm) * view.scaleY,
      ).matrixTransform((node as SVGSVGElement).getScreenCTM()!)
      return { x: p.x, y: p.y }
    },
    { view: state.viewport, re, im },
  )
}

async function drag(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  cancel = false,
) {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 8 })
  if (cancel) await page.keyboard.press('Escape')
  await page.mouse.up()
}

test(
  'marker creation combines source projection with on-path integer snapping',
  { tag: '@desktop-only' },
  async ({ page }) => {
    const state = fixture()
    await page.goto('/')
    await openAvoidanceProject(page, state)
    await page.getByRole('button', { name: '独立点工具', exact: true }).click()
    const p = await at(page, state, 1.98, 1.08)
    await page.mouse.click(p.x, p.y)
    const saved = await savedProject(page)
    expect(saved.document.markers).toHaveLength(1)
    // Allow pointer delivery's subpixel precision; the path equation itself is exact.
    expect(saved.document.markers[0].re).toBe(2)
    expect(saved.document.markers[0].im).toBe(1)
    expect(saved.document.markers[0].im).toBeCloseTo(saved.document.markers[0].re / 2, 12)
    expect(saved.document.segments).toEqual(state.segments)
    await page.getByRole('button', { name: '撤销', exact: true }).click()
    expect((await savedProject(page)).document.markers).toHaveLength(0)
    const free = await at(page, state, 0.08, 0.08)
    await page.keyboard.down('Alt')
    await page.mouse.click(free.x, free.y)
    await page.keyboard.up('Alt')
    const freeMarker = (await savedProject(page)).document.markers[0]
    expect(freeMarker.re).toBeCloseTo(0.08, 5)
    expect(freeMarker.im).toBeCloseTo(0.08, 5)
  },
)

test(
  'marker creation and constrained drag stay on a true source arc, not its chord',
  { tag: '@desktop-only' },
  async ({ page }) => {
    const state = fixture(true)
    await page.goto('/')
    await openAvoidanceProject(page, state)
    await page.getByRole('button', { name: '独立点工具', exact: true }).click()
    const p = await at(page, state, 1.06, 1.74)
    await page.mouse.click(p.x, p.y)
    const initial = (await savedProject(page)).document.markers[0]
    const length = Math.hypot(1.06, 1.74)
    expect(initial.re).toBeCloseTo((2 * 1.06) / length, 5)
    expect(initial.im).toBeCloseTo((2 * 1.74) / length, 5)
    expect(Math.hypot(initial.re, initial.im)).toBeCloseTo(2, 12)
    await showCanvas(page)
    await drag(page, await at(page, state, initial.re, initial.im), await at(page, state, -1, 1))
    const moved = (await savedProject(page)).document.markers[0]
    expect(moved.re).toBeCloseTo(-Math.SQRT2, 5)
    expect(moved.im).toBeCloseTo(Math.SQRT2, 5)
    expect(Math.hypot(moved.re, moved.im)).toBeCloseTo(2, 12)
    await page.getByRole('button', { name: '撤销', exact: true }).click()
    expect((await savedProject(page)).document.markers[0]).toEqual(initial)
  },
)

test('marker path threshold remains 8 CSS pixels with unequal axes and CSS scaling', async ({
  page,
}) => {
  const state = fixture()
  state.vertices[0].im = state.vertices[1].im = 0
  state.viewport = { ...state.viewport, scaleX: 80, scaleY: 30, locked: false }
  await page.goto('/')
  for (const cssScale of [0.75, 1.2]) {
    await openAvoidanceProject(page, state)
    await page.getByTestId('contour-canvas').evaluate((node, scale) => {
      ;(node as SVGSVGElement).style.transform = `scale(${scale})`
    }, cssScale)
    await page.getByRole('button', { name: '独立点工具', exact: true }).click()
    const inside = await at(page, state, -1, 0)
    await page.mouse.click(inside.x, inside.y - 7.9)
    await showCanvas(page)
    const outside = await at(page, state, 1.02, 0)
    await page.mouse.click(outside.x, outside.y - 8.1)
    const markers = (await savedProject(page)).document.markers
    expect(markers).toHaveLength(2)
    expect(markers[0].re).toBe(-1)
    expect(markers[0].im).toBe(0)
    expect(markers[1].im).toBeGreaterThan(0.2)
  }
})

test(
  'marker constraints preserve handle offsets, Alt is temporarily free, Esc cancels and one undo restores the gesture',
  { tag: '@desktop-only' },
  async ({ page }) => {
    const state = fixture()
    addMarker(state)
    await page.goto('/')
    await openAvoidanceProject(page, state)
    const before = (await savedProject(page)).document
    const start = await at(page, state, 0, 0)
    const target = await at(page, state, 1.98, 1.08)
    // Click away from the handle center; preserve the effective raw pointer target.
    await drag(page, { x: start.x + 2, y: start.y - 1 }, { x: target.x + 2, y: target.y - 1 })
    const moved = (await savedProject(page)).document
    expect(moved.markers[0].re).toBe(2)
    expect(moved.markers[0].im).toBe(1)
    expect(moved.markers[0].im).toBeCloseTo(moved.markers[0].re / 2, 12)
    await page.getByRole('button', { name: '撤销', exact: true }).click()
    expect((await savedProject(page)).document).toEqual(before)
    await page.getByRole('button', { name: '重做', exact: true }).click()
    expect((await savedProject(page)).document).toEqual(moved)
    await page.getByRole('button', { name: '撤销', exact: true }).click()

    await page.keyboard.down('Alt')
    await drag(page, start, await at(page, state, 1.13, 1.07))
    await page.keyboard.up('Alt')
    const free = (await savedProject(page)).document.markers[0]
    expect(free.re).toBeCloseTo(1.13, 5)
    expect(free.im).toBeCloseTo(1.07, 5)
    await page.getByRole('button', { name: '撤销', exact: true }).click()

    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.keyboard.down('Alt')
    await page.mouse.move(target.x, target.y)
    await page.keyboard.up('Alt')
    const resumed = await at(page, state, 2, 0)
    await page.mouse.move(resumed.x, resumed.y)
    await page.mouse.up()
    const constrained = (await savedProject(page)).document.markers[0]
    expect(constrained.re).toBeCloseTo(1.6, 5)
    expect(constrained.im).toBeCloseTo(0.8, 5)
    await drag(page, await at(page, state, 1.6, 0.8), start, true)
    expect((await savedProject(page)).document.markers[0]).toEqual(constrained)
    await page.getByRole('button', { name: '撤销', exact: true }).click()
    expect((await savedProject(page)).document).toEqual(before)
  },
)

test(
  'markers follow a connected contour around corners but distant or incident-connection markers remain free',
  { tag: '@desktop-only' },
  async ({ page }) => {
    const state = fixture()
    state.vertices = [
      { id: 'a', re: -3, im: 0 },
      { id: 'b', re: 2, im: 0 },
      { id: 'c', re: 2, im: 3 },
    ]
    state.segments = [
      { id: 'edge-a', kind: 'line', startId: 'a', endId: 'b' },
      { id: 'edge-b', kind: 'line', startId: 'b', endId: 'c' },
    ]
    addMarker(state)
    await page.goto('/')
    await openAvoidanceProject(page, state)
    await drag(page, await at(page, state, 0, 0), await at(page, state, 2.6, 1.4))
    let marker = (await savedProject(page)).document.markers[0]
    expect(marker.re).toBeCloseTo(2, 10)
    expect(marker.im).toBeCloseTo(1.4, 5)

    state.markers[0].im = -1
    state.connections = [{ id: 'incident', kind: 'line', startId: 'marker', endId: 'a' }]
    await openAvoidanceProject(page, state)
    await drag(page, await at(page, state, 0, -1), await at(page, state, 1.13, 0.67))
    marker = (await savedProject(page)).document.markers[0]
    expect(marker.re).toBeCloseTo(1.13, 5)
    expect(marker.im).toBeCloseTo(0.67, 5)
  },
)

test(
  'independent source arcs support creation and drag without capturing other branches',
  { tag: '@desktop-only' },
  async ({ page }) => {
    const state = fixture(true)
    state.vertices.push({ id: 'c', re: -2, im: -2 })
    state.connections = [
      ...state.segments,
      { id: 'branch', kind: 'line', startId: 'b', endId: 'c' },
    ]
    state.segments = []
    await page.goto('/')
    await openAvoidanceProject(page, state)
    await page.getByRole('button', { name: '独立点工具', exact: true }).click()
    const p = await at(page, state, 1.06, 1.74)
    await page.mouse.click(p.x, p.y)
    const marker = (await savedProject(page)).document.markers[0]
    await drag(page, await at(page, state, marker.re, marker.im), await at(page, state, -1, 1))
    const moved = (await savedProject(page)).document.markers[0]
    expect(moved.re).toBeCloseTo(-Math.SQRT2, 5)
    expect(moved.im).toBeCloseTo(Math.SQRT2, 5)
    expect(Math.hypot(moved.re, moved.im)).toBeCloseTo(2, 12)
    await drag(page, await at(page, state, moved.re, moved.im), await at(page, state, -2, -1))
    const clamped = (await savedProject(page)).document.markers[0]
    expect(clamped.re).toBeCloseTo(-2, 10)
    expect(clamped.im).toBe(0)
  },
)

test(
  'bound poles slide on their source baseline rather than their own generated avoidance arc',
  { tag: '@desktop-only' },
  async ({ page }) => {
    const state = createAvoidanceFixture()
    state.markers[0].label.visible = false
    await page.goto('/')
    await openAvoidanceProject(page, state)
    await drag(page, await at(page, state, 0, 0), await at(page, state, 1, 0.5))
    const file = await savedProject(page)
    expect(file.document.markers[0].re).toBeCloseTo(1, 10)
    expect(file.document.markers[0].im).toBe(0)
    expect(file.document.avoidances).toEqual(state.avoidances)
    await selectObject(page, '选择标记点 1')
    // Precise numeric editing remains an explicit way to leave the path.
    const im = page.getByLabel('虚部 Im', { exact: true })
    await im.fill('0.123')
    await im.press('Enter')
    expect((await savedProject(page)).document.markers[0].im).toBe(0.123)
  },
)
