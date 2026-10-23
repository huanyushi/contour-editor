import { expect, test } from '@playwright/test'
import { defaultLabel, defaultPointStyle } from '../src/features/contour/appearance'
import { serializeProject } from '../src/features/project/format'
import { createArcFixture } from '../src/test/fixtures'
import { selectObject } from './navigation'

test('header actions stay still throughout autosave when marker mathematical types change', async ({
  page,
}, info) => {
  const state = createArcFixture()
  state.markers = [
    { id: 'marker', re: 0, im: 0, label: defaultLabel('p'), pointStyle: defaultPointStyle() },
  ]
  await page.goto('/')
  await page.getByLabel('打开项目文件').setInputFiles({
    name: 'header-layout.json',
    mimeType: 'application/json',
    buffer: Buffer.from(serializeProject(state)),
  })
  await expect(page.getByText('已打开 header-layout.json', { exact: true })).toBeVisible()
  await page.reload()
  const status = page.getByLabel('画布保存状态', { exact: true })
  await expect(status).toContainText('已恢复')
  const widths = info.project.name === 'desktop' ? [1280, 1000, 800] : [390, 320]
  for (const width of widths) {
    await test.step(`${width}px`, async () => {
      await page.setViewportSize({ width, height: 720 })
      await selectObject(page, '选择标记点 1')
      const probe = await page.evaluateHandle(() => {
        const capture = () => ({
          status: document.querySelector('.draft-line')!.textContent,
          bounds: Array.from(
            document.querySelectorAll(
              '.history-controls button, .project-buttons > button, .export-menu > summary, .draft-line, .external-project, .application-menu > button',
            ),
          ).map((node) => {
            const box = node.getBoundingClientRect()
            return { x: box.x, y: box.y, width: box.width, height: box.height }
          }),
        })
        const samples = [capture()]
        // Capture the transient saving state, not just the identical before/after states.
        const observer = new MutationObserver(() => samples.push(capture()))
        observer.observe(document.querySelector('.draft-line')!, {
          subtree: true,
          childList: true,
          characterData: true,
          attributes: true,
        })
        return { samples, observer }
      })
      for (const kind of ['isolated', 'branch', 'ordinary']) {
        await page.getByLabel('数学类型', { exact: true }).selectOption(kind)
        await expect(status).toHaveText('画布已保存')
        await expect(status).toHaveAttribute('title', '自动保存在此浏览器：画布已保存')
      }
      const samples = await probe.evaluate(({ samples, observer }) => {
        observer.disconnect()
        return samples
      })
      await probe.dispose()
      expect(samples.some((sample) => sample.status === '正在保存画布…')).toBe(true)
      expect(samples.at(-1)!.status).toBe('画布已保存')
      for (const sample of samples) {
        expect(sample.bounds, `${width}px / ${sample.status}`).toEqual(samples[0].bounds)
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
    })
  }
})
