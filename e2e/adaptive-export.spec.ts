import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { defaultLabel, defaultPointStyle } from '../src/features/contour/appearance'
import { serializeProject } from '../src/features/project/format'
import { createArcFixture } from '../src/test/fixtures'

async function download(page: Page, name: string) {
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name, exact: true }).click()
  const path = await (await pending).path()
  if (!path) throw new Error('Download did not complete')
  return readFile(path)
}

test(
  'exports a complete wide labeled figure at natural SVG and 2×/3× PNG sizes',
  {
    tag: '@desktop-only',
  },
  async ({ page }) => {
    const state = createArcFixture()
    state.vertices = [
      { id: 'a', re: -18, im: -1, label: { ...defaultLabel('L'), dx: -110, dy: 70 } },
      {
        id: 'b',
        re: 18,
        im: -1,
        label: { ...defaultLabel('R_{\\mathrm{outside}}'), dx: 140, dy: -130 },
      },
      { id: 'c', re: 18, im: 1 },
      { id: 'd', re: -18, im: 1 },
    ]
    state.segments = state.vertices.map((p, i) => ({
      id: `edge-${i}`,
      kind: 'line',
      startId: p.id,
      endId: state.vertices[(i + 1) % 4].id,
    }))
    state.markers = [
      { id: 'p', re: 2, im: 0, pointStyle: defaultPointStyle(), label: defaultLabel('p') },
      { id: 'q', re: 0, im: 2, pointStyle: defaultPointStyle(), label: defaultLabel('q') },
    ]
    state.connections = [
      { id: 'major', kind: 'arc', startId: 'p', endId: 'q', through: { re: -2, im: 0 } },
    ]
    await page.goto('/')
    await page.getByLabel('打开项目文件').setInputFiles({
      name: 'wide.json',
      mimeType: 'application/json',
      buffer: Buffer.from(serializeProject(state)),
    })
    await expect(page.getByText('已打开 wide.json', { exact: true })).toBeVisible()
    const before = await page.getByTestId('contour-path').getAttribute('d')
    const sceneBefore = await page.getByTestId('contour-canvas').innerHTML()
    const saved = JSON.parse((await download(page, '保存项目')).toString())
    const undo = await page.getByRole('button', { name: '撤销', exact: true }).isEnabled()
    const redo = await page.getByRole('button', { name: '重做', exact: true }).isEnabled()
    await page.locator('summary[aria-label="导出图像"]').click()
    await expect(page.getByLabel('导出范围')).toHaveValue('content')
    const svg = (await download(page, '导出 SVG')).toString()
    const layout = await page.evaluate((text) => {
      const doc = new DOMParser().parseFromString(text, 'image/svg+xml')
      const svg = document.importNode(doc.documentElement, true) as unknown as SVGSVGElement
      svg.style.position = 'fixed'
      svg.style.left = '-10000px'
      document.body.append(svg)
      const view = svg.viewBox.baseVal
      const box = svg.getBBox()
      const result = {
        width: Number(svg.getAttribute('width')),
        height: Number(svg.getAttribute('height')),
        inside:
          box.x >= view.x - 1 &&
          box.y >= view.y - 1 &&
          box.x + box.width <= view.x + view.width + 1 &&
          box.y + box.height <= view.y + view.height + 1,
        arc: !!svg.querySelector('path[d*=" A "]'),
        label: [...svg.querySelectorAll('[aria-label]')].some(
          (node) =>
            node.getAttribute('aria-label') === 'R_{\\mathrm{outside}}' &&
            node.querySelector('path'),
        ),
        circles: svg.querySelectorAll('circle').length,
      }
      svg.remove()
      return result
    }, svg)
    expect(layout.inside).toBe(true)
    expect(layout.arc).toBe(true)
    expect(layout.label).toBe(true)
    expect(layout.circles).toBe(2)
    expect(layout.width).toBeGreaterThan(1700)
    expect(layout.width / layout.height).toBeGreaterThan(4)
    await expect(page.locator('.export-options legend')).toContainText(
      `${layout.width} × ${layout.height}`,
    )
    for (const scale of [2, 3]) {
      const option = page.getByLabel('PNG 分辨率').locator(`option[value="${scale}"]`)
      await expect(option).toHaveText(
        `${scale}× · ${layout.width * scale}×${layout.height * scale}`,
      )
      await page.getByLabel('PNG 分辨率').selectOption(String(scale))
      const png = await download(page, '导出 PNG')
      expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
      expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([
        layout.width * scale,
        layout.height * scale,
      ])
    }
    await page.getByLabel('导出范围').selectOption('view')
    const fixed = (await download(page, '导出 SVG')).toString()
    expect(fixed).toContain('viewBox="0 0 800 600"')
    await expect(page.getByTestId('contour-path')).toHaveAttribute('d', before!)
    expect(await page.getByTestId('contour-canvas').innerHTML()).toBe(sceneBefore)
    expect(JSON.parse((await download(page, '保存项目')).toString())).toEqual(saved)
    expect(await page.getByRole('button', { name: '撤销', exact: true }).isEnabled()).toBe(undo)
    expect(await page.getByRole('button', { name: '重做', exact: true }).isEnabled()).toBe(redo)
  },
)
