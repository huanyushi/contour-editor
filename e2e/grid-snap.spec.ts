import { expect, test, type Page } from '@playwright/test'
import { createInitialState } from '../src/features/contour/model'
import type { Viewport } from '../src/lib/viewport'
import { openAvoidanceProject } from './avoidance'
import { openView, showCanvas } from './navigation'
import { savedProject } from './selection'

async function at(page: Page, view: Viewport, re: number, im: number) {
  return page.getByTestId('contour-canvas').evaluate(
    (node, { view, re, im }) => {
      const p = new DOMPoint(
        400 + (re - view.centerRe) * view.scaleX,
        300 - (im - view.centerIm) * view.scaleY,
      ).matrixTransform((node as SVGSVGElement).getScreenCTM()!)
      return { x: p.x, y: p.y }
    },
    { view, re, im },
  )
}

test(
  'adaptive grid follows zoom and pan without resnapping saved points',
  { tag: '@desktop-only' },
  async ({ page }) => {
    const state = createInitialState()
    state.vertices = []
    state.segments = []
    state.closed = false
    state.viewport = { ...state.viewport, scaleX: 400, scaleY: 400 }
    await page.goto('/')
    await openAvoidanceProject(page, state)
    await page.getByRole('button', { name: '独立点工具', exact: true }).click()
    let p = await at(page, state.viewport, 0.31, 0.41)
    await page.mouse.click(p.x, p.y)
    let saved = (await savedProject(page)).document
    expect(saved.markers[0]).toMatchObject({ re: 0.3, im: 0.4 })

    await page.getByRole('button', { name: '选择工具', exact: true }).click()
    const start = await at(page, state.viewport, 0.3, 0.4)
    p = await at(page, state.viewport, -0.11, 0.11)
    await page.mouse.move(start.x + 2, start.y - 1)
    await page.mouse.down()
    await page.mouse.move(p.x + 2, p.y - 1, { steps: 5 })
    await page.mouse.up()
    saved = (await savedProject(page)).document
    expect(saved.markers[0]).toMatchObject({ re: -0.1, im: 0.1 })
    await page.getByRole('button', { name: '撤销', exact: true }).click()
    const before = (await savedProject(page)).document.markers
    expect(before[0]).toMatchObject({ re: 0.3, im: 0.4 })

    // Actual wheel zoom and hand-tool pan must only change the viewport.
    p = await at(page, state.viewport, 0, 0)
    await page.mouse.move(p.x, p.y)
    await page.mouse.wheel(0, 100)
    await expect
      .poll(async () => (await savedProject(page)).document.view.viewport?.scaleX)
      .toBeLessThan(400)
    await page.getByRole('button', { name: '平移工具', exact: true }).click()
    await page.mouse.move(p.x, p.y)
    await page.mouse.down()
    await page.mouse.move(p.x + 20, p.y - 12, { steps: 5 })
    await page.mouse.up()
    saved = (await savedProject(page)).document
    expect(saved.view.viewport!.centerRe).not.toBe(0)
    expect(saved.markers).toEqual(before)

    await openView(page)
    await page.getByLabel('横轴倍率', { exact: true }).fill('0.1')
    await page.getByRole('button', { name: '应用视图比例', exact: true }).click()
    await showCanvas(page)
    saved = (await savedProject(page)).document
    expect(saved.markers).toEqual(before)
    const view = saved.view.viewport!
    await page.getByRole('button', { name: '独立点工具', exact: true }).click()
    p = await at(page, view, 10.5, 20.5)
    await page.mouse.click(p.x, p.y)
    expect((await savedProject(page)).document.markers[1]).toMatchObject({ re: 10, im: 20 })

    await openView(page)
    await page.getByRole('checkbox', { name: '网格吸附', exact: true }).uncheck()
    await showCanvas(page)
    p = await at(page, view, -10.5, 20.5)
    await page.mouse.click(p.x, p.y)
    const free = (await savedProject(page)).document.markers[2]
    expect(free.re).toBeCloseTo(-10.5, 5)
    expect(free.im).toBeCloseTo(20.5, 5)
  },
)
