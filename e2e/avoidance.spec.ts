import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { createAvoidanceFixture } from '../src/test/avoidanceFixtures'
import {
  configureAvoidance,
  dragPoint,
  expectBoundCircle,
  openAvoidanceProject,
  startAvoidance,
  type BoundArcExpectation,
} from './avoidance'
import { loadTemplate, selectObject, showCanvas } from './navigation'
import { clickPoint, loadBoxFixture, savedProject } from './selection'

test(
  'Inspector creates a bound pole; real drags stay centered offline, online, across the line, at source endpoints, through one undo and reopening',
  { tag: '@desktop-only' },
  async ({ page }) => {
    await page.goto('/')
    await loadBoxFixture(page)
    await page.getByRole('button', { name: '独立点工具', exact: true }).click()
    await clickPoint(page, 0, 0)
    await selectObject(page, '选择标记点 1')
    await page.getByLabel('数学类型', { exact: true }).selectOption('isolated')
    const unbound = await savedProject(page)
    expect(unbound.document.avoidances).toBeUndefined()
    await configureAvoidance(page, 1, -1)
    // Freeze the applied UI value BEFORE any pole or source-endpoint movement.
    const appliedRadius = Number(await page.getByLabel('绕行半径', { exact: true }).inputValue())
    expect(appliedRadius).toBe(0.2) // Common source-scale rule, independent of zoom or source placement.
    let expected: BoundArcExpectation = {
      radius: appliedRadius,
      side: 'left',
      preferredOpeningWidth: appliedRadius, // initial preference is half the diameter
      source: [
        [-2, 0],
        [2, 0],
      ],
    }
    await page.getByRole('button', { name: '应用绕行', exact: true }).click()
    let before = await savedProject(page)
    await expectBoundCircle(page, before, [0, 0], expected)
    await page.getByRole('button', { name: '撤销', exact: true }).click()
    expect((await savedProject(page)).document).toEqual(unbound.document)
    await page.getByRole('button', { name: '重做', exact: true }).click()
    await expectBoundCircle(page, await savedProject(page), [0, 0], expected)
    let from: [number, number] = [0, 0]
    for (const { to, side } of [
      { to: [0, 1], side: 'left' },
      { to: [0, 0], side: 'left' },
      { to: [0, -1], side: 'right' },
      { to: [0, 1], side: 'left' },
    ] as { to: [number, number]; side: 'left' | 'right' }[]) {
      const beforeMoveExpectation = expected
      // Leaving a captured source path is now an explicit Alt/free gesture.
      if (from[1] === 0 && to[1] !== 0) await page.keyboard.down('Alt')
      await dragPoint(page, from, to)
      if (from[1] === 0 && to[1] !== 0) await page.keyboard.up('Alt')
      // Off-line movement remembers that physical side for the next return online.
      expected = { ...expected, side }
      const moved = await savedProject(page)
      await expectBoundCircle(page, moved, to, expected)
      expect(moved.document.vertices).toEqual(before.document.vertices)
      expect(moved.document.segments).toEqual(before.document.segments)
      await page.getByRole('button', { name: '撤销', exact: true }).click()
      const restored = await savedProject(page)
      expect(restored.document).toEqual(before.document)
      await expectBoundCircle(page, restored, from, beforeMoveExpectation)
      await page.getByRole('button', { name: '重做', exact: true }).click()
      expect((await savedProject(page)).document).toEqual(moved.document)
      await expectBoundCircle(page, moved, to, expected)
      await page.getByRole('button', { name: '编辑绕行 1', exact: true }).click()
      const previousExpectation = expected
      if (to[1] === 0) {
        await expect(page.getByLabel('偏好开口宽度', { exact: true })).toHaveCount(0)
        await page.getByLabel('绕行侧', { exact: true }).selectOption('right')
        expected = { ...expected, side: 'right' }
      } else {
        await expect(page.getByLabel('绕行侧', { exact: true })).toHaveCount(0)
        await expect(page.getByLabel('偏好开口宽度', { exact: true })).toHaveCount(0)
        await expect(page.getByLabel('两岸间距', { exact: true })).toHaveValue(
          String(expected.preferredOpeningWidth),
        )
        // Viewing a legacy binding must not convert it; separate tests cover geometry edits.
        expect((await savedProject(page)).document).toEqual(moved.document)
        before = moved
        from = to
        continue
      }
      const edited = await savedProject(page)
      await expectBoundCircle(page, edited, to, expected)
      await page.getByRole('button', { name: '撤销', exact: true }).click()
      expect((await savedProject(page)).document).toEqual(moved.document)
      await expectBoundCircle(page, moved, to, previousExpectation)
      await page.getByRole('button', { name: '重做', exact: true }).click()
      await expectBoundCircle(page, await savedProject(page), to, expected)
      before = edited
      from = to
    }
    await dragPoint(page, [-2, 0], [-3, -1])
    const endpoint = await savedProject(page)
    expect(endpoint.document.vertices[0]).toMatchObject({ re: -3, im: -1 })
    const tilted: BoundArcExpectation = {
      ...expected,
      source: [
        [-3, -1],
        [2, 0],
      ],
    }
    await expectBoundCircle(page, endpoint, [0, 1], tilted)
    await page.getByRole('button', { name: '撤销', exact: true }).click()
    expect((await savedProject(page)).document).toEqual(before.document)
    await expectBoundCircle(page, before, [0, 1], expected)
    await page.getByRole('button', { name: '重做', exact: true }).click()
    await expectBoundCircle(page, await savedProject(page), [0, 1], tilted)
    await dragPoint(page, [0, 1], [1, 1], true)
    expect((await savedProject(page)).document).toEqual(endpoint.document)
    await expectBoundCircle(page, endpoint, [0, 1], tilted)
    await page.getByRole('button', { name: '撤销', exact: true }).click()
    expect((await savedProject(page)).document).toEqual(before.document)
    await expectBoundCircle(page, before, [0, 1], expected)
    await page.getByRole('button', { name: '重做', exact: true }).click()
    await expectBoundCircle(page, await savedProject(page), [0, 1], tilted)
    await openAvoidanceProject(page, endpoint)
    expect((await savedProject(page)).document).toEqual(endpoint.document)
    await expectBoundCircle(page, endpoint, [0, 1], tilted)
    await dragPoint(page, [0, 1], [1, 1])
    const reopenedMove = await savedProject(page)
    await expectBoundCircle(page, reopenedMove, [1, 1], tilted)
    await page.getByRole('button', { name: '撤销', exact: true }).click()
    expect((await savedProject(page)).document).toEqual(endpoint.document)
    await expectBoundCircle(page, endpoint, [0, 1], tilted)
    await expect(page.getByRole('button', { name: '重做', exact: true })).toBeEnabled()
    await page.getByRole('button', { name: '重做', exact: true }).click()
    await expectBoundCircle(page, await savedProject(page), [1, 1], tilted)
    await page.getByRole('button', { name: '撤销', exact: true }).click()

    // Same workflow, now a reversed tilted source. Side is relative to its direction;
    // leaving the line must remember the physical off-line side, not freeze the online choice.
    await page.getByRole('button', { name: '反转方向', exact: true }).click()
    const reversed: BoundArcExpectation = {
      ...tilted,
      source: [
        [2, 0],
        [-3, -1],
      ],
      side: 'right',
    }
    const reversedFile = await savedProject(page)
    await expectBoundCircle(page, reversedFile, [0, 1], reversed)
    await page.getByRole('button', { name: '撤销', exact: true }).click()
    expect((await savedProject(page)).document).toEqual(endpoint.document)
    await expectBoundCircle(page, endpoint, [0, 1], tilted)
    await page.getByRole('button', { name: '重做', exact: true }).click()
    await expectBoundCircle(page, await savedProject(page), [0, 1], reversed)
    // Exact midpoint of the tilted line: (-.5,-.5), not its horizontal projection.
    await dragPoint(page, [0, 1], [-0.5, -0.5])
    const reversedOnline = await savedProject(page)
    await expectBoundCircle(page, reversedOnline, [-0.5, -0.5], reversed)
    await page.getByRole('button', { name: '编辑绕行 1', exact: true }).click()
    await page.getByLabel('绕行侧', { exact: true }).selectOption('left')
    const reversedLeft: BoundArcExpectation = { ...reversed, side: 'left' }
    const leftFile = await savedProject(page)
    await expectBoundCircle(page, leftFile, [-0.5, -0.5], reversedLeft)
    await page.getByRole('button', { name: '撤销', exact: true }).click()
    expect((await savedProject(page)).document).toEqual(reversedOnline.document)
    await expectBoundCircle(page, reversedOnline, [-0.5, -0.5], reversed)
    await page.getByRole('button', { name: '重做', exact: true }).click()
    await expectBoundCircle(page, await savedProject(page), [-0.5, -0.5], reversedLeft)
    await openAvoidanceProject(page, leftFile)
    await expectBoundCircle(page, await savedProject(page), [-0.5, -0.5], reversedLeft)
    // Preserve this off-line avoidance-side regression while normal drags slide on the source.
    await page.keyboard.down('Alt')
    await dragPoint(page, [-0.5, -0.5], [0, 1])
    await page.keyboard.up('Alt')
    await expectBoundCircle(page, await savedProject(page), [0, 1], reversed)
  },
)

test(
  'two explicit bindings share a source without endpoint creation; retained pieces and detours select independently and edits stay isolated',
  { tag: '@desktop-only' },
  async ({ page }) => {
    const state = createAvoidanceFixture()
    state.avoidances = []
    state.markers[0].re = -1
    state.markers.push({ ...state.markers[0], id: 'pole2', re: 1 })
    await page.goto('/')
    await openAvoidanceProject(page, state)
    for (const marker of [1, 2]) {
      await configureAvoidance(page, marker, -3)
      await page.getByLabel('绕行半径', { exact: true }).fill('0.6')
      await page.getByLabel('绕行半径', { exact: true }).press('Enter')
      await page.getByRole('button', { name: '应用绕行', exact: true }).click()
    }
    const original = await savedProject(page)
    expect(original.document.avoidances).toHaveLength(2)
    expect(original.document.vertices).toEqual(state.vertices)
    expect(original.document.segments).toEqual(state.segments)
    await selectObject(page, '选择路径段 1 的保留段 1')
    await showCanvas(page)
    const painted = () =>
      page
        .locator('[data-testid="contour-canvas"] path[data-export-omit][stroke="#238b8b20"]')
        .locator('..')
        .locator('[data-testid^="segment-"]')
        .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-testid')))
    const sourcePaint = await painted()
    expect(sourcePaint).toEqual([
      `segment-gap:edge-a:before:${original.document.avoidances![0].id}`,
    ])
    await clickPoint(page, -1, 0.6)
    expect(await painted()).toEqual([`segment-avoid:${original.document.avoidances![0].id}:arc`])
    await page.getByLabel('绕行侧', { exact: true }).selectOption('right')
    await page.getByLabel('绕行半径', { exact: true }).fill('0.7')
    await page.getByLabel('绕行半径', { exact: true }).press('Enter')
    const changed = await savedProject(page)
    expect(changed.document.avoidances![0]).toMatchObject({ radius: 0.7, side: 'right' })
    expect(changed.document.avoidances![1]).toEqual(original.document.avoidances![1])
    await page.getByRole('button', { name: '取消绕行', exact: true }).click()
    const removed = await savedProject(page)
    expect(removed.document.avoidances).toEqual([original.document.avoidances![1]])
    expect(removed.document.vertices).toEqual(state.vertices)
    expect(removed.document.segments).toEqual(state.segments)
    await page.getByRole('button', { name: '撤销', exact: true }).click()
    expect((await savedProject(page)).document).toEqual(changed.document)
  },
)

test(
  'unbound lower-half-plane branch and ordinary points never autoroute the upper contour',
  { tag: '@desktop-only' },
  async ({ page }) => {
    await page.goto('/')
    await loadBoxFixture(page)
    const path = await page.getByTestId('contour-path').getAttribute('d')
    await page.getByRole('button', { name: '独立点工具', exact: true }).click()
    await clickPoint(page, 0, -2)
    await selectObject(page, '选择标记点 1')
    for (const kind of ['branch', 'isolated', 'ordinary']) {
      await page.getByLabel('数学类型', { exact: true }).selectOption(kind)
      const file = await savedProject(page)
      expect(file.document.avoidances).toBeUndefined()
      await expect(page.getByTestId('contour-path')).toHaveAttribute('d', path!)
      await expect(page.locator('[data-testid^="segment-avoid:"]')).toHaveCount(0)
    }
  },
)

for (const action of ['Escape', 'tool', 'template', 'project', 'close'] as const) {
  test(
    `preview is never persisted or exported and cancels on ${action}`,
    { tag: '@desktop-only' },
    async ({ page }) => {
      const state = createAvoidanceFixture()
      state.avoidances = []
      state.markers[0].im = -2
      await page.goto('/')
      await openAvoidanceProject(page, state)
      // Import creates an independent canvas; refresh restores only its applied document.
      await page.reload()
      const before = await savedProject(page)
      await configureAvoidance(page)
      const radius = page.getByLabel('绕行半径', { exact: true })
      await radius.fill('0.7')
      await radius.press('Enter')
      expect(await savedProject(page)).toEqual(before)
      await page.evaluate(() => window.dispatchEvent(new Event('pagehide')))
      expect(
        await page.evaluate(async () => {
          const db = await new Promise<IDBDatabase>((resolve, reject) => {
            const request = indexedDB.open('complex-contour-editor', 1)
            request.onsuccess = () => resolve(request.result)
            request.onerror = () => reject(request.error)
          })
          return new Promise((resolve, reject) => {
            const tx = db.transaction(['workspace', 'canvases'], 'readonly')
            let project: unknown
            const meta = tx.objectStore('workspace').get('current')
            meta.onsuccess = () => {
              const entry = tx.objectStore('canvases').get(meta.result.activeId)
              entry.onsuccess = () => {
                project = JSON.parse(entry.result.project)
              }
            }
            tx.oncomplete = () => {
              db.close()
              resolve(project)
            }
            tx.onabort = () => {
              db.close()
              reject(tx.error)
            }
          })
        }),
      ).toEqual(before)
      await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled()
      await page.locator('summary[aria-label="导出图像"]').click()
      const pending = page.waitForEvent('download')
      await page.getByRole('button', { name: '导出 SVG', exact: true }).click()
      const svg = (await readFile((await (await pending).path())!)).toString()
      expect(svg).not.toMatch(/avoidance-preview|data-preview-part|avoid:| A /)
      await page.locator('summary[aria-label="导出图像"]').click()
      if (action === 'Escape') await page.keyboard.press('Escape')
      if (action === 'tool')
        await page.getByRole('button', { name: '独立点工具', exact: true }).click()
      if (action === 'template') await loadTemplate(page, '上半圆围道')
      if (action === 'project') await openAvoidanceProject(page, before)
      if (action === 'close')
        await page.getByRole('button', { name: '收起属性面板', exact: true }).click()
      await expect(page.getByTestId('avoidance-preview')).toHaveCount(0)
      expect((await savedProject(page)).document.avoidances).toBeUndefined()
      if (action !== 'template')
        expect((await savedProject(page)).document).toEqual(before.document)
      await page.reload()
      await expect(page.getByTestId('avoidance-preview')).toHaveCount(0)
      expect((await savedProject(page)).document.avoidances).toBeUndefined()
    },
  )
}

test('窄屏 focused Inspector → pick → immediate Esc cancels; pick and apply restore Inspector focus', async ({
  page,
}) => {
  const state = createAvoidanceFixture()
  state.avoidances = []
  await page.goto('/')
  await openAvoidanceProject(page, state)
  await page.reload()
  const before = await savedProject(page)
  await selectObject(page, '选择标记点 1')
  await expect(page.getByLabel('属性面板内容', { exact: true })).toBeFocused()
  const trigger = page.getByRole('button', { name: '添加绕行', exact: true })
  await trigger.focus()
  await expect(trigger).toBeFocused()
  await trigger.press('Enter')
  const canvas = page.getByTestId('contour-canvas')
  await expect(canvas).toBeFocused()
  if (page.viewportSize()!.width <= 700) {
    await expect(page.getByRole('complementary', { name: '对象属性' })).toBeHidden()
    await expect(canvas).toBeFocused()
  }
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: '取消选择目标', exact: true })).toHaveCount(0)
  expect(await savedProject(page)).toEqual(before)
  await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: '重做', exact: true })).toBeDisabled()
  await configureAvoidance(page)
  await expect(page.getByLabel('属性面板内容', { exact: true })).toBeFocused()
  await page.getByRole('button', { name: '应用绕行', exact: true }).click()
  await expect(page.getByRole('complementary', { name: '对象属性' })).toBeVisible()
  await expect(page.getByLabel('属性面板内容', { exact: true })).toBeFocused()
  expect((await savedProject(page)).document.avoidances).toHaveLength(1)
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  expect((await savedProject(page)).document).toEqual(before.document)
  await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled()
  await startAvoidance(page)
  await clickPoint(page, -2, 0)
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('avoidance-preview')).toHaveCount(0)
  await expect(canvas).toBeFocused()
})
