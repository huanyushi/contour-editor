import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { createRectangleConnectedFixture } from '../src/test/connectedAvoidanceFixtures'
import { sourcePieceId } from '../src/features/contour/sourcePieces'
import { openAvoidanceProject } from './avoidance'
import { selectObject, setCustomColor, showCanvas } from './navigation'
import { savedProject, screenPoint } from './selection'

test(
  'five detour objects have independent arrows, colors, widths and labels through shape edits, reopen and export',
  { tag: '@desktop-only' },
  async ({ page }) => {
    await page.goto('/')
    await openAvoidanceProject(page, createRectangleConnectedFixture())
    const objects = [
      {
        row: '选择路径段 1 的保留段 1',
        rendered: 'gap:edge-a:before:parent',
        id: sourcePieceId('edge-a', { startAvoidanceId: null, endAvoidanceId: 'parent' }),
        color: '#cc2233',
      },
      {
        row: '选择绕行 1 的进入连接段',
        rendered: 'avoid:parent:entry',
        id: 'avoid:parent:entry',
        color: '#2563eb',
      },
      {
        row: '选择绕行 1 的绕行圆弧',
        rendered: 'avoid:parent:arc',
        id: 'avoid:parent:arc',
        color: '#15803d',
      },
      {
        row: '选择绕行 1 的离开连接段',
        rendered: 'avoid:parent:exit',
        id: 'avoid:parent:exit',
        color: '#c2410c',
      },
      {
        row: '选择路径段 1 的保留段 2',
        rendered: 'gap:edge-a:after:parent',
        id: sourcePieceId('edge-a', { startAvoidanceId: 'parent', endAvoidanceId: null }),
        color: '#7e22ce',
      },
    ]
    // A horizontal/vertical SVG line has a zero-area geometry box even though its
    // stroke and marker are painted; assert the actual painted arrow attributes.
    for (const item of objects) {
      const arrow = page.getByTestId(`arrow-${item.rendered}`)
      await expect(arrow).toHaveAttribute('marker-end', /^url\(#direction-/)
      await expect(arrow).toHaveCSS('visibility', 'visible')
    }
    for (const [index, item] of objects.entries()) {
      await selectObject(page, item.row)
      await setCustomColor(page, '线条颜色', item.color)
      const width = page.getByRole('slider', { name: '线条粗细', exact: true })
      for (let step = 0; step <= index; step++) await width.press('ArrowRight')
      await page
        .getByRole('checkbox', { name: '显示方向箭头', exact: true })
        .setChecked(index % 2 === 0)
      await page.getByLabel('LaTeX 标签', { exact: true }).fill(`C_${index + 1}`)
      await page.getByRole('button', { name: '应用标签', exact: true }).click()
      for (const [otherIndex, other] of objects.entries()) {
        await expect(page.getByTestId(`segment-${other.rendered}`)).toHaveAttribute(
          'stroke',
          otherIndex <= index ? other.color : '#263238',
        )
        await expect(page.getByTestId(`segment-${other.rendered}`)).toHaveAttribute(
          'stroke-width',
          String(otherIndex <= index ? 2 + (otherIndex + 1) * 0.5 : 2),
        )
      }
    }
    const beforeShape = await savedProject(page)
    expect(beforeShape.version).toBe(5)
    expect(beforeShape.document.segments[0].style).toBeUndefined()
    expect(beforeShape.document.segments[0].pieces).toHaveLength(2)
    await selectObject(page, '选择绕行 1 的绕行圆弧')
    await page.getByLabel('绕行半径', { exact: true }).fill('0.5')
    await page.getByLabel('绕行半径', { exact: true }).press('Enter')
    const changed = await savedProject(page)
    expect(changed.document.segments).toEqual(beforeShape.document.segments)
    expect(changed.document.avoidances![0]).toMatchObject({
      radius: 0.5,
      partStyles: beforeShape.document.avoidances![0].partStyles,
      partLabels: beforeShape.document.avoidances![0].partLabels,
    })
    await openAvoidanceProject(page, changed)
    for (const [index, item] of objects.entries()) {
      await expect(page.getByTestId(`segment-${item.rendered}`)).toHaveAttribute(
        'stroke',
        item.color,
      )
      await expect(page.getByTestId(`label-${item.id}`)).toHaveAttribute(
        'aria-label',
        `C_${index + 1}`,
      )
      await expect(page.getByTestId(`arrow-${item.rendered}`)).toHaveCount(index % 2 === 0 ? 1 : 0)
    }
    await showCanvas(page)
    const p = await screenPoint(page, -2, 0)
    await page.mouse.click(p.x, p.y)
    await expect(page.getByRole('slider', { name: '线条粗细', exact: true })).toHaveValue('2.5')
    await expect(page.locator('path[stroke="#238b8b20"]')).toHaveCount(1)
    await page.locator('summary[aria-label="导出图像"]').click()
    const pending = page.waitForEvent('download')
    await page.getByRole('button', { name: '导出 SVG', exact: true }).click()
    const path = await (await pending).path()
    if (!path) throw new Error('Missing SVG download')
    const svg = (await readFile(path)).toString()
    for (let i = 1; i <= 5; i++)
      expect(svg.match(new RegExp(`aria-label="C_${i}"`, 'g'))).toHaveLength(1)
    expect(svg).not.toMatch(/data-|avoidance-gap|avoidance-port/)
  },
)

test('narrow view selects and edits only one retained object', async ({ page }) => {
  test.skip(page.viewportSize()!.width > 700, 'Narrow inspector layout only')
  await page.goto('/')
  await openAvoidanceProject(page, createRectangleConnectedFixture())
  await selectObject(page, '选择路径段 1 的保留段 2')
  await expect(page.getByRole('slider', { name: '线条粗细', exact: true })).toBeVisible()
  await page.getByRole('slider', { name: '线条粗细', exact: true }).press('ArrowRight')
  await expect(page.getByTestId('segment-gap:edge-a:after:parent')).toHaveAttribute(
    'stroke-width',
    '2.5',
  )
  await expect(page.getByTestId('segment-gap:edge-a:before:parent')).toHaveAttribute(
    'stroke-width',
    '2',
  )
  const file = await savedProject(page)
  expect(file.version).toBe(5)
  expect(file.document.segments[0].pieces).toHaveLength(1)
})
