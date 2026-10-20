import { expect, test, type Locator } from '@playwright/test'
import { loadArcFixture, openSection, openView, selectObject } from './navigation'

async function expectPanelTypography(panel: Locator) {
  const sizes = await panel
    .locator('label:visible, input:visible, select:visible, textarea:visible, button:visible')
    .evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).fontSize))
  expect(sizes.length).toBeGreaterThan(0)
  expect([...new Set(sizes)]).toEqual(['12px'])
  await expect(panel.locator('h2')).toHaveCSS('font-size', '14px')
  for (const help of await panel.locator('.muted.small:visible').all()) {
    await expect(help).toHaveCSS('font-size', '11px')
  }
}

async function expectCoordinateMath(panel: Locator) {
  const labels = panel.locator('.coordinate-fields label:has(.math-text)')
  await expect(labels).toHaveCount(2)
  for (const label of await labels.all()) {
    await expect(label).toHaveCSS('font-size', '12px')
    const dimensions = await label.locator('.math-text > svg').evaluate((node) => {
      const box = node.getBoundingClientRect()
      return {
        width: box.width,
        height: box.height,
        intrinsicWidth: Number(node.getAttribute('width')),
        intrinsicHeight: Number(node.getAttribute('height')),
      }
    })
    expect(dimensions.width / dimensions.intrinsicWidth).toBeCloseTo(0.75, 2)
    expect(dimensions.height / dimensions.intrinsicHeight).toBeCloseTo(0.75, 2)
  }
}

test('point inspector uses matching Chinese and coordinate math sizes and keeps precise Enter submission', async ({
  page,
}) => {
  await page.goto('/')
  await loadArcFixture(page)
  await selectObject(page, '选择顶点 z1')
  await openSection(page, '几何')
  const panel = page.getByRole('complementary', { name: '对象属性' })
  await expectPanelTypography(panel)
  await expectCoordinateMath(panel)

  const re = panel.getByLabel('实部 Re', { exact: true })
  const im = panel.getByLabel('虚部 Im', { exact: true })
  const path = page.getByTestId('contour-path')
  const before = await path.getAttribute('d')
  await re.fill('1.23456789')
  await im.fill('-0.987654321')
  await im.press('Enter')
  await expect(im).toBeFocused()
  await expect(path).not.toHaveAttribute('d', before!)
  await selectObject(page, '选择路径段 2')
  await selectObject(page, '选择顶点 z1')
  await expect(re).toHaveValue('1.23456789')
  await expect(im).toHaveValue('-0.987654321')
})

test('viewport center shares the readable typography and keeps precise Enter submission', async ({
  page,
}) => {
  await page.goto('/')
  await openView(page)
  const panel = page.locator('.view-settings')
  await expectPanelTypography(panel)
  await expectCoordinateMath(panel)

  const re = panel.getByLabel('视图中心实部 Re', { exact: true })
  const im = panel.getByLabel('视图中心虚部 Im', { exact: true })
  const path = page.getByTestId('contour-path')
  const before = await path.getAttribute('d')
  await re.fill('1.23456789')
  await im.fill('-0.987654321')
  await im.press('Enter')
  await expect(im).toBeFocused()
  await expect(path).not.toHaveAttribute('d', before!)
  await page.getByRole('button', { name: '关闭视图设置' }).click()
  await openView(page)
  await expect(re).toHaveValue('1.23456789')
  await expect(im).toHaveValue('-0.987654321')
})

test('appearance and label controls share body sizing while math preview and canvas retain configured sizing', async ({
  page,
}) => {
  await page.goto('/')
  await loadArcFixture(page)
  await selectObject(page, '选择顶点 z1')
  const panel = page.getByRole('complementary', { name: '对象属性' })
  await openSection(page, '外观')
  await expectPanelTypography(panel)
  await openSection(page, '标签')
  await expectPanelTypography(panel)
  const preview = panel.getByLabel('公式预览').locator('.math-text > svg')
  const label = page.getByTestId('label-a')
  const previewBefore = (await preview.boundingBox())!.width
  const canvasBefore = (await label.boundingBox())!.width
  await panel.getByLabel('标签字号', { exact: true }).fill('24')
  expect((await preview.boundingBox())!.width / previewBefore).toBeCloseTo(1.5, 2)
  expect((await label.boundingBox())!.width / canvasBefore).toBeCloseTo(1.5, 2)
  await expectPanelTypography(panel)
})
