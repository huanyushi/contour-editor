import { expect, test } from '@playwright/test'
import {
  createConnectedFixture,
  createRectangleConnectedFixture,
} from '../src/test/connectedAvoidanceFixtures'
import { openAvoidanceProject, startAvoidance } from './avoidance'
import { showCanvas } from './navigation'
import { savedProject, screenPoint } from './selection'

for (const shape of ['rectangle', 'circle'] as const) {
  test(
    `${shape} preview follows the pole normally before apply, including a boundary roundtrip`,
    { tag: '@desktop-only' },
    async ({ page }) => {
      const state =
        shape === 'rectangle' ? createRectangleConnectedFixture() : createConnectedFixture()
      state.avoidances = []
      state.viewport = { ...state.viewport, scaleX: 80, scaleY: 80 }
      state.snap = false
      await page.goto('/')
      await openAvoidanceProject(page, state)
      await startAvoidance(page)
      await showCanvas(page)
      const target = await screenPoint(
        page,
        shape === 'rectangle' ? -2 : 1.4,
        shape === 'rectangle' ? 0 : 1.4,
      )
      await page.mouse.click(target.x, target.y)
      const arc = page.locator('[data-preview-part$=":arc"]')
      await expect(arc).toHaveCount(1)
      const id = (await arc.getAttribute('data-preview-part'))!
      const move = async (re: number, im: number) => {
        await showCanvas(page)
        const from = await page.getByTestId('marker-center').boundingBox()
        if (!from) throw new Error('Missing singularity')
        const to = await screenPoint(page, re * 2, im * 2)
        await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
        await page.mouse.down()
        await page.mouse.move(to.x, to.y, { steps: 10 })
        await page.mouse.up()
      }
      const point = shape === 'rectangle' ? { re: 0.7, im: 1 } : { re: 0.3, im: 0.4 }
      await move(point.re, point.im)
      const entry = page.locator('[data-preview-part$=":entry"]')
      const direction = await entry.evaluate((node) => {
        const p = node.getAttribute('d')!.split(/\s+/)
        const re = Number(p[1]) - Number(p[4]),
          im = Number(p[5]) - Number(p[2])
        const length = Math.hypot(re, im)
        return { re: re / length, im: im / length }
      })
      expect(direction.re).toBeCloseTo(shape === 'rectangle' ? 0 : 0.6, 7)
      expect(direction.im).toBeCloseTo(shape === 'rectangle' ? -1 : 0.8, 7)
      await move(shape === 'rectangle' ? 0.7 : 1, 0)
      await expect(arc).toHaveCount(1)
      await expect(entry).toHaveCount(0)
      await move(point.re, point.im)
      await expect(entry).toHaveCount(1)
      const before = await savedProject(page)
      expect(before.document.avoidances).toBeUndefined()
      expect(before.document.markers[0]).toMatchObject({
        re: expect.closeTo(point.re, 7),
        im: expect.closeTo(point.im, 7),
      })
      const preview = await arc.getAttribute('d')
      await page.getByRole('button', { name: '应用绕行', exact: true }).click()
      await expect(page.getByTestId(`segment-${id}`)).toHaveAttribute('d', preview!)
      expect((await savedProject(page)).document.avoidances).toHaveLength(1)
    },
  )
}
