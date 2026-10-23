import { expect, test, type Locator } from '@playwright/test'
import { defaultLabel, defaultPointStyle } from '../src/features/contour/appearance'
import { serializeProject } from '../src/features/project/format'
import { createArcFixture } from '../src/test/fixtures'
import { openSection, selectObject } from './navigation'

// Hidden scrollbars cannot reproduce the width lost to a native scrollbar.
test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } })

async function textLeft(locator: Locator) {
  return locator.evaluate((node) => {
    const text = Array.from(node.childNodes).find(
      (child) => child.nodeType === Node.TEXT_NODE && child.textContent!.trim(),
    )!
    const range = document.createRange()
    range.selectNodeContents(text)
    return range.getBoundingClientRect().left
  })
}

test('inspector content keeps its width when a native scrollbar appears and disappears', async ({
  page,
}) => {
  await page.setViewportSize({ width: page.viewportSize()!.width, height: 720 })
  await page.goto('/')
  await openSection(page, '几何')
  const panel = page.locator('#properties-panel')
  const scroll = panel.getByLabel('属性面板内容', { exact: true })
  const measure = () =>
    panel.evaluate((node) => {
      const scroll = node.querySelector('.panel-scroll')!
      const summary = node.querySelector('.property-section > summary')!
      const actions = node.querySelector('.contour-actions')!
      const bounds = (element: Element) => {
        const box = element.getBoundingClientRect()
        return { left: box.left, width: box.width }
      }
      return {
        overflowing: scroll.scrollHeight > scroll.clientHeight,
        contentWidth: scroll.clientWidth,
        summary: bounds(summary),
        actions: bounds(actions),
      }
    })
  const before = await measure()
  expect(before.overflowing).toBe(false)

  await openSection(page, '标签')
  const expanded = await measure()
  expect(expanded.overflowing).toBe(true)
  expect(expanded.contentWidth).toBe(before.contentWidth)
  expect(expanded.summary).toEqual(before.summary)
  expect(expanded.actions).toEqual(before.actions)

  await panel.getByText('标签', { exact: true }).click()
  expect(await measure()).toEqual(before)
  expect(await scroll.evaluate((node) => node.scrollWidth)).toBe(before.contentWidth)
})

test('inspector section titles and expanded fields share one left edge for every object type', async ({
  page,
}) => {
  const state = createArcFixture()
  state.markers = [
    { id: 'marker', re: 0, im: 0, label: defaultLabel('p'), pointStyle: defaultPointStyle() },
  ]
  state.formulas = [
    { id: 'formula', re: 0, im: -1, label: defaultLabel('f(z)'), pointStyle: defaultPointStyle() },
  ]
  await page.goto('/')
  await page.getByLabel('打开项目文件').setInputFiles({
    name: 'inspector-layout.json',
    mimeType: 'application/json',
    buffer: Buffer.from(serializeProject(state)),
  })
  await expect(page.getByText('已打开 inspector-layout.json', { exact: true })).toBeVisible()
  const panel = page.locator('#properties-panel')
  const cases = [
    { object: '选择顶点 z1', sections: ['几何', '外观', '标签'] },
    { object: '选择标记点 1', sections: ['几何', '外观', '标签'] },
    { object: '选择路径段 1', sections: ['几何', '外观', '标签'] },
    { object: '选择路径段 2', sections: ['几何', '外观', '标签'] },
    { object: '选择公式 1', sections: ['公式', '位置'] },
    { object: '整体围道 闭合', sections: ['填充', '线条'] },
  ]
  for (const { object, sections } of cases) {
    await selectObject(page, object)
    for (const title of sections) {
      await test.step(`${object} → ${title}`, async () => {
        await openSection(page, title)
        const section = panel.locator('.property-section[open]')
        if (object === '选择路径段 2' && title === '几何')
          await section.getByText('圆弧参数', { exact: true }).click()
        const left = await panel.locator('.inspector-fields').evaluate((node) => {
          return node.getBoundingClientRect().left + 18
        })
        for (const summary of await section.locator('summary:visible').all()) {
          expect(await textLeft(summary), `${object} / ${title} title`).toBeCloseTo(left, 1)
        }
        const fields = section.locator(
          'legend:visible, h3:visible, .coordinate-fields:visible, .field-row:visible, .range-field:visible, .stack-field:visible, .check-row:visible, .geometry-values:visible, .endpoint-actions:visible, textarea:visible, button.full-width:visible',
        )
        expect(await fields.count()).toBeGreaterThan(0)
        for (const field of await fields.all()) {
          expect((await field.boundingBox())!.x, `${object} / ${title} field`).toBeCloseTo(left, 1)
        }
        const scroll = panel.locator('.panel-scroll')
        expect(await scroll.evaluate((node) => node.scrollWidth - node.clientWidth)).toBe(0)
      })
    }
  }
})
