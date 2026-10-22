import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import {
  createConnectedFixture,
  createRectangleConnectedFixture,
} from '../src/test/connectedAvoidanceFixtures'
import { openAvoidanceProject, startAvoidance } from './avoidance'
import { savedProject, screenPoint } from './selection'
import { selectObject, showCanvas } from './navigation'
import { parseProject } from '../src/features/project/project'
import { constructAvoidances } from '../src/features/contour/avoidanceConstructionTable'
import type { ContourState } from '../src/features/contour/model'
import { contourTemplates } from '../src/features/contour/templates'

function automatic(state: ContourState) {
  state.avoidances = state.avoidances.map((a) =>
    a.kind === 'corridor' ? { ...a, alignment: { kind: 'normal' as const } } : a,
  )
  state.avoidances[0].partStyles = {
    arc: { color: '#cc2233', width: 5 },
    entry: { color: '#2563eb' },
  }
  return state
}

for (const shape of ['rectangle', 'circle'] as const) {
  test(
    `${shape} follows a moved singularity to its boundary, reopens and returns with preserved settings`,
    { tag: '@desktop-only' },
    async ({ page }) => {
      const state = automatic(
        shape === 'rectangle' ? createRectangleConnectedFixture() : createConnectedFixture(),
      )
      state.viewport = { ...state.viewport, scaleX: 160, scaleY: 160 }
      if (shape === 'rectangle') state.viewport = { ...state.viewport, scaleX: 80, scaleY: 80 }
      const scale = state.viewport.scaleX / 40
      await page.goto('/')
      await openAvoidanceProject(page, state)
      const move = async (re: number, im: number) => {
        await showCanvas(page)
        const p = await page.getByTestId('marker-center').boundingBox()
        if (!p) throw new Error('Missing singularity')
        const to = await screenPoint(page, re * scale, im * scale)
        await page.mouse.move(p.x + p.width / 2, p.y + p.height / 2)
        await page.mouse.down()
        await page.mouse.move(to.x, to.y, { steps: 16 })
        await page.mouse.up()
      }
      const boundary = shape === 'rectangle' ? { re: 0.5, im: 0 } : { re: 1, im: 0 }
      await move(boundary.re, boundary.im)
      const atBoundary = await savedProject(page)
      expect(atBoundary.version).toBe(6)
      expect(atBoundary.document.markers[0]).toMatchObject(boundary)
      expect(atBoundary.document.avoidances![0]).toMatchObject({
        radius: state.avoidances[0].radius,
        partStyles: state.avoidances[0].partStyles,
        alignment: { kind: 'normal' },
      })
      const resolved = constructAvoidances(parseProject(JSON.stringify(atBoundary)))
      if (!resolved.ok) throw new Error(resolved.error)
      const g = resolved.value.parents.get('parent')!.geometry
      expect(g.entry).toEqual(g.entryBase)
      expect(g.exit).toEqual(g.exitBase)
      if (shape === 'rectangle') expect(Math.abs(g.arc.sweep)).toBeCloseTo(Math.PI, 8)
      await expect(page.getByTestId('segment-avoid:parent:arc')).toHaveAttribute(
        'stroke',
        '#cc2233',
      )
      await expect(page.getByTestId('segment-avoid:parent:entry')).toHaveCount(0)
      await page.locator('summary[aria-label="导出图像"]').click()
      const download = async (name: string) => {
        const pending = page.waitForEvent('download')
        await page.getByRole('button', { name, exact: true }).click()
        const path = await (await pending).path()
        if (!path) throw new Error('Missing image download')
        return readFile(path)
      }
      const svg = (await download('导出 SVG')).toString()
      expect(svg).not.toMatch(/data-|avoidance-port|avoidance-gap/)
      const dimensions = await page.evaluate((text) => {
        const document = new DOMParser().parseFromString(text, 'image/svg+xml')
        if (document.querySelector('parsererror')) throw new Error('Invalid SVG')
        if (document.querySelectorAll('path[stroke="#cc2233"][stroke-width="5"]').length !== 1)
          throw new Error('Missing independent detour appearance')
        return {
          width: Number(document.documentElement.getAttribute('width')),
          height: Number(document.documentElement.getAttribute('height')),
        }
      }, svg)
      await page.getByLabel('PNG 分辨率', { exact: true }).selectOption('1')
      const png = await download('导出 PNG')
      expect(png.readUInt32BE(16)).toBe(dimensions.width)
      expect(png.readUInt32BE(20)).toBe(dimensions.height)
      expect((await savedProject(page)).document).toEqual(atBoundary.document)
      await openAvoidanceProject(page, atBoundary)
      await move(shape === 'rectangle' ? 0.7 : 0.3, shape === 'rectangle' ? 1 : 0.4)
      const returned = await savedProject(page)
      expect(returned.document.markers[0]).toMatchObject({
        re: expect.closeTo(shape === 'rectangle' ? 0.7 : 0.3, 7),
        im: expect.closeTo(shape === 'rectangle' ? 1 : 0.4, 7),
      })
      await expect(page.getByTestId('segment-avoid:parent:entry')).toHaveAttribute(
        'stroke',
        '#2563eb',
      )
      const table = constructAvoidances(parseProject(JSON.stringify(returned)))
      if (!table.ok) throw new Error(table.error)
      const direction = table.value.parents.get('parent')!.bankPair!.direction
      expect(direction.re).toBeCloseTo(shape === 'rectangle' ? 0 : 0.6, 7)
      expect(direction.im).toBeCloseTo(shape === 'rectangle' ? -1 : 0.8, 7)
    },
  )
}

test(
  'opening drag snaps to horizontal, Alt bypasses, and the inspector restores normal following',
  { tag: '@desktop-only' },
  async ({ page }) => {
    const state = automatic(createConnectedFixture())
    state.viewport = { ...state.viewport, scaleX: 160, scaleY: 160 }
    state.snap = true
    await page.goto('/')
    await openAvoidanceProject(page, state)
    const drag = async (alt: boolean) => {
      const handle = page.getByTestId('avoidance-port-parent-exit')
      const from = await handle.evaluate((node) => {
        const p = new DOMPoint(0, 0).matrixTransform((node as SVGGraphicsElement).getScreenCTM()!)
        return { x: p.x, y: p.y }
      })
      if (alt) await page.keyboard.down('Alt')
      await page.mouse.move(from.x, from.y)
      await page.mouse.down()
      await page.mouse.move(from.x, from.y - 5, { steps: 4 })
      await page.mouse.up()
      if (alt) await page.keyboard.up('Alt')
    }
    await drag(false)
    expect((await savedProject(page)).document.avoidances![0]).toMatchObject({
      alignment: { kind: 'direction', angle: 0 },
    })
    await drag(true)
    const manual = (await savedProject(page)).document.avoidances![0]
    expect(
      manual.kind === 'corridor' &&
        manual.alignment?.kind === 'direction' &&
        manual.alignment.angle,
    ).not.toBe(0)
    await selectObject(page, '选择绕行 1 的绕行圆弧')
    await page.getByRole('button', { name: '恢复法向跟随', exact: true }).click()
    expect((await savedProject(page)).document.avoidances![0]).toMatchObject({
      alignment: { kind: 'normal' },
    })
  },
)

test(
  'a circle template recommends 0.4 both at its center and on its boundary',
  { tag: '@desktop-only' },
  async ({ page }) => {
    const state = contourTemplates.find((t) => t.id === 'circle')!.create()
    const marker = createConnectedFixture().markers[0]
    state.markers = [
      { ...marker, id: 'inside' },
      { ...marker, id: 'on', im: 3 },
    ]
    await page.goto('/')
    await openAvoidanceProject(page, state)
    for (const markerIndex of [1, 2]) {
      await startAvoidance(page, markerIndex)
      await showCanvas(page)
      const p = await screenPoint(page, markerIndex === 1 ? 2.12 : -2.12, 2.12)
      await page.mouse.click(p.x, p.y)
      await expect(page.getByLabel('绕行半径', { exact: true })).toHaveValue('0.4')
      await page.getByRole('button', { name: '应用绕行', exact: true }).click()
    }
    const file = await savedProject(page)
    expect(file.document.avoidances!.map((a) => a.radius)).toEqual([0.4, 0.4])
  },
)
