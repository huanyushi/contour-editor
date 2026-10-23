import { expect, test, type Page } from '@playwright/test'
import { defaultLabel, defaultPointStyle } from '../src/features/contour/appearance'
import type { ContourState } from '../src/features/contour/model'
import { serializeProject } from '../src/features/project/format'
import { createAvoidanceFixture } from '../src/test/avoidanceFixtures'
import { createRectangleConnectedFixture } from '../src/test/connectedAvoidanceFixtures'
import { createArcFixture } from '../src/test/fixtures'
import { openSection, selectObject, showInspector } from './navigation'

async function openProject(page: Page, state: ContourState) {
  await page.goto('/')
  await page.getByLabel('打开项目文件').setInputFiles({
    name: 'inspector-groups.json',
    mimeType: 'application/json',
    buffer: Buffer.from(serializeProject(state)),
  })
  await expect(page.getByText('已打开 inspector-groups.json', { exact: true })).toBeVisible()
}

for (const object of ['选择顶点 z1', '选择标记点 1']) {
  test(`${object}: mathematical categories keep actions without empty binding groups`, async ({
    page,
  }) => {
    const state = createArcFixture()
    state.markers = [
      { id: 'marker', re: 0, im: 0, label: defaultLabel('p'), pointStyle: defaultPointStyle() },
    ]
    await openProject(page, state)
    await selectObject(page, object)
    await showInspector(page)
    const panel = page.locator('#properties-panel')
    const category = panel.getByLabel('数学类型', { exact: true })
    await expect(category).toHaveValue('ordinary')
    await expect(panel.getByRole('heading', { name: /^绕行绑定/ })).toHaveCount(0)
    await expect(panel.getByRole('button', { name: '添加绕行', exact: true })).toHaveCount(0)
    for (const value of ['isolated', 'branch']) {
      await category.selectOption(value)
      await expect(category).toHaveValue(value)
      await expect(panel.getByRole('heading', { name: /^绕行绑定/ })).toHaveCount(0)
      await expect(panel.getByRole('button', { name: '添加绕行', exact: true })).toBeVisible()
    }
    await panel.getByRole('button', { name: '添加绕行', exact: true }).click()
    await showInspector(page)
    await expect(panel.getByRole('heading', { name: '选择绕行目标', exact: true })).toBeVisible()
    await panel.getByRole('button', { name: '取消选择目标', exact: true }).click()
    await category.selectOption('ordinary')
    await expect(panel.getByRole('heading', { name: /^绕行绑定/ })).toHaveCount(0)
    await expect(panel.getByRole('button', { name: '添加绕行', exact: true })).toHaveCount(0)
    await expect(panel.locator('.property-group .property-group')).toHaveCount(0)
  })
}

test('line and arc keep avoidance guidance without an empty binding heading', async ({ page }) => {
  const state = createArcFixture()
  state.vertices[0].mathematicalKind = 'isolated'
  await openProject(page, state)
  const panel = page.locator('#properties-panel')
  for (const object of ['选择路径段 1', '选择路径段 2']) {
    await selectObject(page, object)
    await showInspector(page)
    await expect(panel.getByRole('heading', { name: /^绕行绑定/ })).toHaveCount(0)
    await expect(panel.getByText('选择奇点后添加绕行，再点击目标直线或圆弧。')).toBeVisible()
    await expect(panel.getByRole('button', { name: '选择奇点 1 添加绕行' })).toBeVisible()
    await openSection(page, '几何')
    if (object === '选择路径段 2') {
      await panel.getByText('圆弧参数', { exact: true }).click()
      await expect(panel.getByLabel('圆弧半径', { exact: true })).toHaveText('2')
    }
    await expect(panel.locator('.property-group .property-group')).toHaveCount(0)
  }
  await panel.getByRole('button', { name: '选择奇点 1 添加绕行' }).click()
  await expect(panel.getByLabel('数学类型', { exact: true })).toHaveValue('isolated')
})

test('retained source pieces have one stroke group and keep existing binding navigation', async ({
  page,
}) => {
  await openProject(page, createRectangleConnectedFixture())
  await selectObject(page, '选择路径段 1 的保留段 1')
  await showInspector(page)
  const panel = page.locator('#properties-panel')
  await expect(
    panel.getByText('形状由原路径和绕行参数确定；以下设置只作用于当前段。'),
  ).toBeVisible()
  await expect(panel.getByRole('heading', { name: '绕行绑定 · 1', exact: true })).toBeVisible()
  await expect(panel.locator('.property-group .property-group')).toHaveCount(0)
  await expect(panel.getByRole('group', { name: '线条样式', exact: true })).toHaveCount(1)
  await panel.getByRole('button', { name: '编辑绕行 1', exact: true }).click()
  await expect(panel.getByLabel('绕行半径', { exact: true })).toHaveValue('0.4')
  await expect(panel.getByLabel('绕行部件', { exact: true })).toBeVisible()
})

test('a point keeps its existing hidden binding editable when the closing edge is stored', async ({
  page,
}) => {
  const state = createAvoidanceFixture()
  state.markers[0] = { ...state.markers[0], re: -4, im: 1.5 }
  state.avoidances[0].targetSegmentId = 'edge-d'
  state.closed = false
  await openProject(page, state)
  await selectObject(page, '选择标记点 1')
  await showInspector(page)
  const panel = page.locator('#properties-panel')
  await expect(panel.getByLabel('数学类型', { exact: true })).toHaveValue('isolated')
  await expect(panel.getByRole('heading', { name: '绕行绑定 · 1', exact: true })).toBeVisible()
  await expect(page.getByTestId('segment-avoid:avoid-1:arc')).toHaveCount(0)
  await panel.getByRole('button', { name: '编辑绕行 1', exact: true }).click()
  const radius = panel.getByLabel('绕行半径', { exact: true })
  await expect(radius).toHaveValue('0.5')
  await expect(panel.getByText('原路径暂存，部件暂不显示；设置已保留。')).toBeVisible()
  await radius.fill('0.75')
  await radius.press('Enter')
  await expect(radius).toHaveValue('0.75')
  await panel.getByRole('button', { name: '定位奇点', exact: true }).click()
  await panel.getByRole('button', { name: '编辑绕行 1', exact: true }).click()
  await expect(radius).toHaveValue('0.75')
})
