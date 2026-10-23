import { expect, test, type Page } from '@playwright/test'
import { openTemplates, openView, showCanvas } from './navigation'
import { clickPoint, savedProject, screenPoint } from './selection'

async function drawOpenChain(page: Page) {
  await page.goto('/')
  const canvases = page.getByRole('button', { name: '画布与模板', exact: true })
  if ((await canvases.getAttribute('aria-expanded')) !== 'true') await canvases.click()
  await page.getByRole('tab', { name: '我的画布', exact: true }).click()
  await page.getByRole('button', { name: '新建空白画布', exact: true }).click()
  const close = page.getByRole('button', { name: '收起画布与模板', exact: true })
  if (await close.isVisible()) await close.click()
  await page.getByRole('button', { name: '添加顶点', exact: true }).click()
  for (const [re, im] of [
    [-3, -1],
    [-1, -1],
    [1, -1],
    [1, 1],
  ])
    await clickPoint(page, re, im)
  await expect(page.getByTestId('contour-path')).toHaveAttribute('fill', 'none')
}

for (const target of ['first', 'middle'] as const) {
  test(`endpoint tool closes at the ${target} point with one undoable edit`, async ({ page }) => {
    await drawOpenChain(page)
    const before = await savedProject(page)
    await clickPoint(page, target === 'first' ? -3 : -1, -1)
    await expect(page.getByTestId('contour-path')).not.toHaveAttribute('fill', 'none')
    await expect(page.getByTestId('contour-path')).toHaveAttribute('d', / Z$/)
    const after = await savedProject(page)
    const ids = before.document.vertices.map((v) => v.id)
    expect(after.document.closed).toBe(true)
    expect(after.document.vertices.map((v) => v.id)).toEqual(
      target === 'first' ? ids : ids.slice(1),
    )
    expect(after.document.segments.at(-1)).toMatchObject({
      startId: ids[3],
      endId: ids[target === 'first' ? 0 : 1],
    })
    if (target === 'middle') {
      expect(after.document.connections).toEqual([before.document.segments[0]])
      expect(after.document.markers[0]).toMatchObject({ id: ids[0], re: -3, im: -1 })
      expect(after.document.vertices.map((v) => v.label?.tex)).toEqual(['z_{2}', 'z_{3}', 'z_{4}'])
      await expect(page.getByTestId(`segment-${before.document.segments[0].id}`)).toHaveAttribute(
        'd',
        'M 280 340 L 360 340',
      )
      await expect(page.getByTestId(`segment-${before.document.segments[0].id}`)).toHaveCSS(
        'visibility',
        'visible',
      )
      expect(await page.getByTestId('contour-path').getAttribute('d')).not.toContain('280 340')
    }
    await page.getByRole('button', { name: '撤销', exact: true }).click()
    expect((await savedProject(page)).document).toEqual(before.document)
    await expect(page.getByTestId('contour-path')).toHaveAttribute('fill', 'none')
    await page.getByRole('button', { name: '重做', exact: true }).click()
    expect((await savedProject(page)).document).toEqual(after.document)
    await clickPoint(page, -1, -1)
    expect((await savedProject(page)).document).toEqual(after.document)
    const pending = after.document
    await page.getByLabel('打开项目文件').setInputFiles({
      name: 'closed.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(after)),
    })
    await expect(page.getByText('已打开 closed.json', { exact: true })).toBeVisible()
    expect((await savedProject(page)).document).toEqual(pending)
  })
}

test('endpoint dragging and cancelled clicks never close the contour', async ({ page }) => {
  await drawOpenChain(page)
  const before = await savedProject(page)
  const id = before.document.vertices[1].id
  for (const cancel of ['escape', 'pointercancel', 'blur']) {
    await showCanvas(page)
    const p = await screenPoint(page, -1, -1)
    await page.mouse.move(p.x, p.y)
    await page.mouse.down()
    if (cancel === 'escape') await page.keyboard.press('Escape')
    else if (cancel === 'blur') await page.evaluate(() => window.dispatchEvent(new Event('blur')))
    else await page.getByTestId('contour-canvas').dispatchEvent('pointercancel', { pointerId: 1 })
    await page.mouse.up()
    expect((await savedProject(page)).document).toEqual(before.document)
  }
  await showCanvas(page)
  const from = await screenPoint(page, -1, -1)
  const to = await screenPoint(page, -1, 0)
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 5 })
  await page.mouse.up()
  const moved = await savedProject(page)
  expect(moved.document.closed).toBe(false)
  expect(moved.document.vertices.find((v) => v.id === id)).toMatchObject({ re: -1, im: 0 })
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  expect((await savedProject(page)).document).toEqual(before.document)
  await clickPoint(page, -1, -1)
  await expect(page.getByTestId('contour-path')).not.toHaveAttribute('fill', 'none')
  await showCanvas(page)
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 5 })
  await page.mouse.up()
  const closedMoved = await savedProject(page)
  expect(closedMoved.document.vertices.find((v) => v.id === id)).toMatchObject({ re: -1, im: 0 })
  expect(closedMoved.document.connections?.[0].endId).toBe(id)
  expect(closedMoved.document.vertices).toHaveLength(3)
  expect(closedMoved.document.markers).toHaveLength(1)
})

test('hidden endpoint handles still allow closure without duplicate points', async ({ page }) => {
  await drawOpenChain(page)
  await openView(page)
  await page.getByLabel('显示编辑手柄', { exact: true }).uncheck()
  await clickPoint(page, -1, -1)
  await expect(page.getByTestId('contour-path')).not.toHaveAttribute('fill', 'none')
  const after = await savedProject(page)
  expect(after.document.vertices).toHaveLength(3)
  expect(after.document.markers).toHaveLength(1)
})

test(
  'endpoint closure keeps unrelated controls and all template previews visually stable',
  {
    tag: '@desktop-only',
  },
  async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await drawOpenChain(page)
    await openTemplates(page)
    await expect(page.locator('.template-grid .scene-thumbnail')).toHaveCount(9)
    const paints = () =>
      page
        .locator(
          '.template-card, .scene-thumbnail, .tool-palette button, .view-toolbar button, .global-actions button',
        )
        .evaluateAll((nodes) =>
          nodes.map((node) => {
            const style = getComputedStyle(node)
            return [
              node.getAttribute('aria-label'),
              style.color,
              style.backgroundColor,
              style.opacity,
              style.filter,
            ]
          }),
        )
    const p = await screenPoint(page, -1, -1)
    await page.mouse.move(p.x, p.y)
    const before = await paints()
    await page.mouse.down()
    expect(await paints()).toEqual(before)
    await page.mouse.up()
    await expect(page.getByTestId('contour-path')).not.toHaveAttribute('fill', 'none')
    const unrelated = (values: Awaited<ReturnType<typeof paints>>) =>
      values.filter(([name]) => name !== '撤销' && name !== '重做')
    expect(unrelated(await paints())).toEqual(unrelated(before))
  },
)
