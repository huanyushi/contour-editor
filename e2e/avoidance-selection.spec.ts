import { expect, test, type Page } from '@playwright/test'
import { createAvoidanceFixture } from '../src/test/avoidanceFixtures'
import { defaultLabel } from '../src/features/contour/appearance'
import { serializeProject } from '../src/features/project/format'
import { showCanvas } from './navigation'
import { clickPoint, savedProject, screenPoint } from './selection'
import { sourcePieceId } from '../src/features/contour/sourcePieces'

async function loadAvoidance(page: Page, labels = false) {
  const state = createAvoidanceFixture()
  state.markers[0].label.visible = false
  state.vertices.forEach((v) => {
    if (v.label) v.label.visible = false
  })
  if (labels) {
    state.segments[0].label = { ...defaultLabel('S'), dx: -80, dy: -60 }
    state.avoidances[0].partLabels = { arc: { ...defaultLabel('A'), dx: 40, dy: -60 } }
  }
  await page.goto('/')
  await page.getByLabel('打开项目文件').setInputFiles({
    name: 'avoidance.json',
    mimeType: 'application/json',
    buffer: Buffer.from(serializeProject(state)),
  })
  await expect(page.getByText('已打开 avoidance.json', { exact: true })).toBeVisible()
  await showCanvas(page)
}

test('selected visible closing part keeps an explained editable binding when opened and reclosed', async ({
  page,
}) => {
  const state = createAvoidanceFixture()
  state.markers[0] = { ...state.markers[0], re: -4, im: 1.5 }
  state.avoidances[0].targetSegmentId = 'edge-d'
  await page.goto('/')
  await page.getByLabel('打开项目文件').setInputFiles({
    name: 'closing-avoidance.json',
    mimeType: 'application/json',
    buffer: Buffer.from(serializeProject(state)),
  })
  await expect(page.getByText('已打开 closing-avoidance.json', { exact: true })).toBeVisible()
  await showCanvas(page)
  await clickPoint(page, -3.5, 1.5)
  const radius = page.getByLabel('绕行半径', { exact: true })
  await expect(radius).toHaveValue('0.5')
  await page.getByRole('checkbox', { name: '闭合围道' }).uncheck()
  await expect(page.getByTestId('segment-avoid:avoid-1:arc')).toHaveCount(0)
  await expect(radius).toHaveValue('0.5')
  await expect(page.getByText(/原路径暂存，部件暂不显示/)).toBeVisible()
  await expect(page.getByRole('button', { name: '取消绕行', exact: true })).toBeEnabled()
  await radius.fill('0.75')
  await radius.press('Enter')
  await page.getByRole('button', { name: '定位原路径', exact: true }).click()
  await page.getByRole('button', { name: '编辑绕行 1', exact: true }).click()
  await expect(radius).toHaveValue('0.75')
  await page.getByRole('checkbox', { name: '闭合围道' }).check()
  await expect(page.getByTestId('segment-avoid:avoid-1:arc')).toBeVisible()
  const saved = await savedProject(page)
  expect(saved.document.avoidances).toEqual([{ ...state.avoidances[0], radius: 0.75 }])
})

test('resolved parts and poles box-drag once from the start snapshot, keep controls stable, and never expose free joints', async ({
  page,
}) => {
  await loadAvoidance(page)
  if (page.viewportSize()!.width > 700) {
    await page.getByRole('button', { name: '示例模板', exact: true }).click()
    expect(await page.locator('.template-thumbnail').count()).toBeGreaterThan(0)
  }
  await page.getByRole('button', { name: '框选工具', exact: true }).click()
  const start = await screenPoint(page, -1, -0.5)
  const end = await screenPoint(page, 1, 1)
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(end.x, end.y, { steps: 5 })
  await page.mouse.up()
  await expect(page.getByTestId('selection-toolbar')).toContainText('2 个对象')
  await showCanvas(page)
  const controls = () =>
    page
      .locator(
        '.template-card, .template-thumbnail, [aria-label="示例模板"], [aria-label="保存项目"], [aria-label="撤销"], [aria-label="重做"]',
      )
      .evaluateAll((nodes) =>
        nodes.map((node) => {
          const style = getComputedStyle(node)
          return [style.opacity, style.color, style.backgroundColor, style.borderColor]
        }),
      )
  const styles = await controls()
  const dragStart = await screenPoint(page, 0, 0.25)
  await page.mouse.move(dragStart.x, dragStart.y)
  await page.mouse.down()
  await page.mouse.move(dragStart.x + 20, dragStart.y - 10, { steps: 3 })
  await page.mouse.move(dragStart.x + 40, dragStart.y - 20, { steps: 3 })
  expect(await controls()).toEqual(styles)
  await page.mouse.up()
  expect(await controls()).toEqual(styles)
  const moved = await savedProject(page)
  expect(moved.document.vertices.slice(0, 2).map(({ re, im }) => ({ re, im }))).toEqual([
    { re: -3, im: 0.5 },
    { re: 5, im: 0.5 },
  ])
  expect(moved.document.markers[0]).toMatchObject({ re: 1, im: 0.5 })
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  const restored = await savedProject(page)
  expect(restored.document.markers[0]).toMatchObject({ re: 0, im: 0 })
  expect(restored.document.vertices[0]).toMatchObject({ re: -4, im: 0 })
  await page.getByRole('button', { name: '重做', exact: true }).click()
  await page.getByRole('button', { name: '独立点工具', exact: true }).click()
  await clickPoint(page, 0.5, 0.5)
  const added = await savedProject(page)
  expect(added.document.markers).toHaveLength(2)
  expect(added.document.markers[1]).toMatchObject({ re: 0.5, im: 0.5 })
  expect(added.document.markers[1].id).not.toContain('avoid:')
})

test('source and generated part labels drag independently and Delete only hides the part label', async ({
  page,
}) => {
  await loadAvoidance(page, true)
  const retainedId = sourcePieceId('edge-a', { startAvoidanceId: null, endAvoidanceId: 'avoid-1' })
  for (const id of [retainedId, 'avoid:avoid-1:arc']) {
    await showCanvas(page)
    const handle = page.getByTestId(`label-handle-${id}`)
    const box = (await handle.boundingBox())!
    const x = box.x + box.width / 2,
      y = box.y + box.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x + 16, y - 8, { steps: 4 })
    await page.mouse.up()
  }
  const moved = await savedProject(page)
  expect(moved.document.segments[0].pieces?.[0].label).toMatchObject({ dx: -64, dy: -68 })
  expect(moved.document.segments[0].label).toMatchObject({ dx: -80, dy: -60 })
  expect(moved.document.avoidances?.[0].partLabels?.arc).toMatchObject({ dx: 56, dy: -68 })
  await showCanvas(page)
  await page.getByTestId('label-handle-avoid:avoid-1:arc').click()
  await page.keyboard.press('Delete')
  const hidden = await savedProject(page)
  expect(hidden.document.avoidances).toHaveLength(1)
  expect(hidden.document.avoidances?.[0].partLabels?.arc?.visible).toBe(false)
  expect(hidden.document.segments).toHaveLength(4)
})
