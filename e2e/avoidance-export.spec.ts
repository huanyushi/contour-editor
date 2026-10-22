import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { defaultLabel } from '../src/features/contour/appearance'
import { createAvoidanceFixture } from '../src/test/avoidanceFixtures'
import { dragPoint, openAvoidanceProject } from './avoidance'
import { savedProject } from './selection'

async function download(page: Page, name: string) {
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name, exact: true }).click()
  const path = await (await pending).path()
  if (!path) throw new Error('Download failed')
  return readFile(path)
}

test(
  'offline bound arc exports complete actual geometry and offset labels to real SVG/PNG without helpers or source/history changes',
  { tag: '@desktop-only' },
  async ({ page }) => {
    const state = createAvoidanceFixture()
    state.markers[0].im = -2
    state.markers[0].label = { ...defaultLabel('P'), dx: -100, dy: 80 }
    state.avoidances[0].radius = 0.8
    state.segments[0].label = { ...defaultLabel('S_{\\mathrm{source}}'), dx: -200, dy: -110 }
    state.avoidances[0].partLabels = {
      arc: { ...defaultLabel('A_{\\mathrm{arc}}'), dx: 120, dy: 150 },
      entry: { ...defaultLabel('E'), dx: -160, dy: 60 },
      exit: { ...defaultLabel('X'), dx: 160, dy: 60 },
    }
    await page.goto('/')
    await openAvoidanceProject(page, state)
    // Keep both past and future populated; exports must preserve the next undo AND redo.
    await dragPoint(page, [0, -2], [1, -2])
    const redoDocument = (await savedProject(page)).document
    await page.getByRole('button', { name: '撤销', exact: true }).click()
    const before = await savedProject(page)
    const scene = await page.getByTestId('contour-canvas').innerHTML()
    const history = async () =>
      Promise.all(
        ['撤销', '重做'].map((name) => page.getByRole('button', { name, exact: true }).isEnabled()),
      )
    const historyBefore = await history()
    await page.locator('summary[aria-label="导出图像"]').click()
    await page.getByRole('checkbox', { name: '包含坐标轴', exact: true }).uncheck()
    await page.getByRole('checkbox', { name: '包含围道端点标记', exact: true }).check()
    const svg = (await download(page, '导出 SVG')).toString()
    expect(svg).not.toMatch(
      /data-|segment-hit|selection-rectangle|avoidance-preview|data-preview-part|through-|<foreignObject|https?:\/\/(?!www\.w3\.org)/,
    )
    const layout = await page.evaluate((text) => {
      const doc = new DOMParser().parseFromString(text, 'image/svg+xml')
      const svg = document.importNode(doc.documentElement, true) as unknown as SVGSVGElement
      svg.style.position = 'fixed'
      svg.style.left = '-10000px'
      document.body.append(svg)
      const view = svg.viewBox.baseVal
      const box = svg.getBBox()
      const shapes = [
        ...svg.querySelectorAll<SVGGraphicsElement>('path, circle, line, [role="img"][aria-label]'),
      ].filter((node) => !node.closest('defs'))
      const outside = shapes
        .filter((node) => {
          const bounds = node.getBBox()
          const transform = svg.getScreenCTM()!.inverse().multiply(node.getScreenCTM()!)
          return [
            [bounds.x, bounds.y],
            [bounds.x + bounds.width, bounds.y + bounds.height],
          ].some(([x, y]) => {
            const p = new DOMPoint(x, y).matrixTransform(transform)
            return (
              p.x < view.x - 1 ||
              p.y < view.y - 1 ||
              p.x > view.x + view.width + 1 ||
              p.y > view.y + view.height + 1
            )
          })
        })
        .map((node) => node.outerHTML)
      const arcs = [...svg.querySelectorAll<SVGPathElement>('path[d*=" A "]')].filter(
        (node) => node.getAttribute('fill') === 'none',
      )
      const result = {
        width: Number(svg.getAttribute('width')),
        height: Number(svg.getAttribute('height')),
        outside,
        inside:
          box.x >= view.x - 1 &&
          box.y >= view.y - 1 &&
          box.x + box.width <= view.x + view.width + 1 &&
          box.y + box.height <= view.y + view.height + 1,
        arcs: arcs.length,
        arcHeight: arcs[0]?.getBBox().height,
        arcWidth: arcs[0]?.getBBox().width,
        labels: [...svg.querySelectorAll('[role="img"][aria-label]')]
          .filter((node) => node.querySelector('path'))
          .map((node) => node.getAttribute('aria-label')),
        circles: svg.querySelectorAll('circle').length,
        paths: [...svg.querySelectorAll('path[fill="none"]')]
          .filter((node) => !node.closest('defs'))
          .map((node) => node.getAttribute('d')),
      }
      svg.remove()
      return result
    }, svg)
    expect(layout.inside).toBe(true)
    expect(layout.outside).toEqual([])
    expect(layout.arcs).toBe(1)
    // Lower major arc, r=.8, half-opening=.4: width=2r, height=r+sqrt(r²-.4²).
    expect(layout.arcWidth).toBeCloseTo(64, 3)
    expect(layout.arcHeight).toBeCloseTo(59.7128129, 3)
    expect(layout.paths).toHaveLength(8) // four source edges, bottom replaced by five pieces
    expect(layout.labels).toEqual(
      expect.arrayContaining(['P', 'S_{\\mathrm{source}}', 'A_{\\mathrm{arc}}', 'E', 'X']),
    )
    for (const name of ['P', 'S_{\\mathrm{source}}', 'A_{\\mathrm{arc}}', 'E', 'X'])
      expect(layout.labels.filter((s) => s === name)).toHaveLength(1)
    expect(layout.circles).toBe(5) // four real vertices and the pole; no generated joints
    for (const scale of [1, 2, 3]) {
      await page.getByLabel('PNG 分辨率').selectOption(String(scale))
      const png = await download(page, '导出 PNG')
      expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
      expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([
        Math.ceil(layout.width * scale),
        Math.ceil(layout.height * scale),
      ])
    }
    expect(await page.getByTestId('contour-canvas').innerHTML()).toBe(scene)
    expect(await savedProject(page)).toEqual(before)
    expect(await history()).toEqual(historyBefore)
    await page.getByRole('button', { name: '重做', exact: true }).click()
    expect((await savedProject(page)).document).toEqual(redoDocument)
    await page.getByRole('button', { name: '撤销', exact: true }).click()
    expect((await savedProject(page)).document).toEqual(before.document)
    await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled()
    await page.getByRole('button', { name: '画布与模板', exact: true }).click()
    await page.getByRole('button', { name: '切换到画布 Untitled', exact: true }).click()
    expect((await savedProject(page)).document.avoidances).toBeUndefined()
  },
)
