import { expect, test, type Locator, type Page } from '@playwright/test'
import { openSection, openView, selectObject } from './navigation'
import { loadBoxFixture } from './selection'

async function paint(page: Page) {
  return page
    .locator(
      '.template-card, .rail-bottom button, .view-toolbar button, .global-actions button, .export-menu > summary, .export-options input, .export-options select',
    )
    .evaluateAll((nodes) =>
      nodes.map((node) => {
        const style = getComputedStyle(node)
        return {
          name: node.getAttribute('aria-label'),
          opacity: style.opacity,
          color: style.color,
          background: style.backgroundColor,
          border: style.borderColor,
          filter: style.filter,
        }
      }),
    )
}

async function dragSlider(page: Page, slider: Locator) {
  await slider.scrollIntoViewIfNeeded()
  const box = (await slider.boundingBox())!
  const value = Number(await slider.inputValue()),
    min = Number(await slider.getAttribute('min')),
    max = Number(await slider.getAttribute('max'))
  const x = box.x + 8 + ((box.width - 16) * (value - min)) / (max - min)
  await page.mouse.move(x, box.y + box.height / 2)
  const before = await paint(page)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.75, box.y + box.height / 2, { steps: 5 })
  expect(await paint(page)).toEqual(before)
  await page.mouse.up()
  expect(await paint(page)).toEqual(before)
}

test(
  'dragging points and labels leaves all nine template previews and other controls unchanged',
  { tag: '@desktop-only' },
  async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/')
    await loadBoxFixture(page)
    await page.getByRole('button', { name: '示例模板', exact: true }).click()
    await expect(page.locator('.template-card')).toHaveCount(9)
    for (const id of ['vertex-a', 'label-handle-a']) {
      const box = (await page.getByTestId(id).boundingBox())!
      const x = box.x + box.width / 2,
        y = box.y + box.height / 2
      await page.mouse.move(x, y)
      const before = await paint(page)
      await page.mouse.down()
      await page.mouse.move(x + 40, y + 20, { steps: 5 })
      expect(await paint(page)).toEqual(before)
      await page.mouse.up()
      expect(await paint(page)).toEqual(before)
    }
  },
)

test(
  'offset and axis sliders keep previews and unrelated controls visually stable',
  { tag: '@desktop-only' },
  async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/')
    await loadBoxFixture(page)
    await selectObject(page, '选择顶点 z1')
    await page.getByRole('button', { name: '收起对象列表', exact: true }).click()
    await openSection(page, '标签')
    await page.getByRole('button', { name: '示例模板', exact: true }).click()
    await expect(page.locator('.template-card')).toHaveCount(9)
    for (const name of ['标签水平偏移', '标签垂直偏移'])
      await dragSlider(page, page.getByRole('slider', { name, exact: true }))
    await openView(page)
    for (const name of ['坐标轴线宽', '坐标轴箭头大小'])
      await dragSlider(page, page.getByRole('slider', { name, exact: true }))
  },
)
