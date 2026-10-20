import { readFile } from 'node:fs/promises'
import { expect, type Page } from '@playwright/test'
import { createInitialState } from '../src/features/contour/model'
import { serializeProject, type ProjectFile } from '../src/features/project/format'
import { showCanvas } from './navigation'

export async function screenPoint(page: Page, re: number, im: number) {
  return page.getByTestId('contour-canvas').evaluate(
    (node, point) => {
      const p = new DOMPoint(400 + point.re * 40, 300 - point.im * 40).matrixTransform(
        (node as SVGSVGElement).getScreenCTM()!,
      )
      return { x: p.x, y: p.y }
    },
    { re, im },
  )
}

export async function clickPoint(
  page: Page,
  re: number,
  im: number,
  modifier?: 'Control' | 'Meta',
) {
  await showCanvas(page)
  const point = await screenPoint(page, re, im)
  if (modifier) await page.keyboard.down(modifier)
  await page.mouse.click(point.x, point.y)
  if (modifier) await page.keyboard.up(modifier)
}

export async function savedProject(page: Page): Promise<ProjectFile> {
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: '保存项目', exact: true }).click()
  const path = await (await pending).path()
  if (!path) throw new Error('Project download failed')
  return JSON.parse((await readFile(path)).toString()) as ProjectFile
}

export async function loadBoxFixture(page: Page) {
  const fixture = createInitialState()
  fixture.vertices = fixture.vertices.map((v) => ({ ...v, re: v.re / 2, im: (v.im * 2) / 3 }))
  await page.getByLabel('打开项目文件').setInputFiles({
    name: 'box.json',
    mimeType: 'application/json',
    buffer: Buffer.from(serializeProject(fixture)),
  })
  await expect(page.getByText('已打开 box.json', { exact: true })).toBeVisible()
}

export async function selectBottomRow(page: Page) {
  const tool = page.getByRole('button', { name: '框选工具', exact: true })
  const pressed = await tool.getAttribute('aria-pressed')
  if (pressed !== 'true') await tool.click()
  await showCanvas(page)
  const start = await screenPoint(page, -2.5, -0.5),
    end = await screenPoint(page, 2.5, 0.5)
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(end.x, end.y, { steps: 5 })
  await page.mouse.up()
  await expect(page.getByTestId('selection-toolbar')).toContainText('3 个对象')
}
