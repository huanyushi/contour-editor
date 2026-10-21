import { expect, test, type Locator } from '@playwright/test'
import { createAvoidanceFixture } from '../src/test/avoidanceFixtures'
import { configureAvoidance, openAvoidanceProject, startAvoidance } from './avoidance'
import { selectObject, showInspector } from './navigation'

async function expectSelectRow(select: Locator) {
  await select.scrollIntoViewIfNeeded()
  const geometry = await select.evaluate((node) => {
    const row = node.closest('label')!
    const text = Array.from(row.childNodes).find(
      (child) => child.nodeType === Node.TEXT_NODE && child.textContent!.trim(),
    )!
    const range = document.createRange()
    range.selectNodeContents(text)
    const label = range.getBoundingClientRect()
    const control = node.getBoundingClientRect()
    const bounds = row.getBoundingClientRect()
    return {
      gap: control.left - label.right,
      left: label.left - bounds.left,
      right: bounds.right - control.right,
      centerOffset: Math.abs(label.top + label.height / 2 - control.top - control.height / 2),
      width: control.width,
      overflow: row.scrollWidth - row.clientWidth,
    }
  })
  expect(geometry.gap, 'label and select need a readable horizontal gap').toBeGreaterThanOrEqual(12)
  expect(geometry.left).toBeCloseTo(0, 0)
  expect(geometry.right, 'select aligns with the right inner gutter').toBeCloseTo(0, 0)
  expect(geometry.centerOffset, 'label and select stay on the same row').toBeLessThan(2)
  expect(geometry.width).toBeCloseTo(135, 0)
  expect(geometry.overflow, 'narrow Inspector must not overflow').toBeLessThanOrEqual(1)
}

async function expectInnerGutter(content: Locator) {
  await content.scrollIntoViewIfNeeded()
  const gutter = await content.evaluate((node) => {
    const bounds = node.getBoundingClientRect()
    const inspector = node.closest('.inspector-fields')!.getBoundingClientRect()
    return { left: bounds.left - inspector.left, right: inspector.right - bounds.right }
  })
  expect(gutter.left, 'content has one 18px inner gutter').toBeCloseTo(18, 0)
  expect(gutter.right, 'full-width content respects the right gutter').toBeCloseTo(18, 0)
}

test('online side and current-part selectors have left labels and right-aligned controls', async ({
  page,
}) => {
  await page.goto('/')
  await openAvoidanceProject(page, createAvoidanceFixture())
  await selectObject(page, '选择标记点 1')
  await page.getByRole('button', { name: '编辑绕行 1', exact: true }).click()
  await expectSelectRow(page.getByLabel('绕行侧', { exact: true }))
  await expectSelectRow(page.getByLabel('绕行部件', { exact: true }))
})

test('part appearance separator precedes its heading instead of following its description', async ({
  page,
}) => {
  await page.goto('/')
  await openAvoidanceProject(page, createAvoidanceFixture())
  await selectObject(page, '选择标记点 1')
  await page.getByRole('button', { name: '编辑绕行 1', exact: true }).click()
  const heading = page.getByText('部件外观与标签', { exact: true })
  await heading.scrollIntoViewIfNeeded()
  const separator = await heading.evaluate((node) => {
    const group = node.closest('fieldset')!
    const style = getComputedStyle(group)
    const bounds = group.getBoundingClientRect()
    const title = node.getBoundingClientRect()
    const description = group.querySelector('p:last-child')!.getBoundingClientRect()
    return {
      topBorder: parseFloat(style.borderTopWidth),
      bottomBorder: parseFloat(style.borderBottomWidth),
      headingInset: title.top - bounds.top,
      headingBottom: title.bottom,
      descriptionTop: description.top,
    }
  })
  expect(separator.topBorder, 'separator belongs before the part heading').toBe(1)
  expect(separator.bottomBorder, 'no separator below the current-part description').toBe(0)
  expect(separator.headingInset).toBeGreaterThanOrEqual(18)
  expect(separator.descriptionTop).toBeGreaterThan(separator.headingBottom)
  await expect(page.getByRole('group', { name: '绕行参数', exact: true })).toHaveCSS(
    'border-bottom-width',
    '1px',
  )
})

test('marker, target picking and preview configuration share one Inspector inner gutter', async ({
  page,
}) => {
  const state = createAvoidanceFixture()
  state.avoidances = []
  await page.goto('/')
  await openAvoidanceProject(page, state)
  await startAvoidance(page)
  await showInspector(page)
  await expectInnerGutter(page.getByRole('heading', { name: '选择绕行目标', exact: true }))
  await expectInnerGutter(
    page.locator('#properties-panel p').filter({ hasText: /^点击画布中的源/ }),
  )
  await expectInnerGutter(page.getByRole('button', { name: '取消选择目标', exact: true }))
  await page.getByRole('button', { name: '取消选择目标', exact: true }).click()
  await expectInnerGutter(page.getByRole('button', { name: '添加绕行', exact: true }))
  // Restart picking so narrow auto-hide exposes the canvas without explicitly
  // closing the Inspector, which intentionally cancels the active workflow.
  await configureAvoidance(page)
  await expectInnerGutter(page.getByRole('group', { name: '绕行参数', exact: true }))
  await expectInnerGutter(page.getByRole('button', { name: '应用绕行', exact: true }))
})
