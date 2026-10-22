import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import type { ProjectFile } from '../src/features/project/project'
import { loadTemplate, openSection, selectObject, setCustomColor, showCanvas } from './navigation'

async function download(page: Page, name: string) {
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name, exact: true }).click()
  const path = await (await pending).path()
  if (!path) throw new Error('Download did not complete')
  return readFile(path)
}

test('templates share the left sidebar behavior, scroll independently and fit the loaded geometry', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: page.viewportSize()!.width, height: 600 })
  await page.goto('/')
  if (info.project.name === 'desktop')
    await page.getByRole('button', { name: '视图设置', exact: true }).click()
  const canvas = page.getByTestId('contour-canvas')
  const before = (await canvas.boundingBox())!
  const original = await page.getByTestId('contour-path').getAttribute('d')
  const trigger = page.getByRole('button', { name: '画布与模板', exact: true })
  await trigger.click()
  await page.getByRole('tab', { name: '示例模板' }).click()
  const panel = page.getByRole('complementary', { name: '画布与模板', exact: true })
  await expect(panel).toBeVisible()
  const panelBox = (await panel.boundingBox())!
  expect(panelBox.width).toBe(280)
  const first = (await panel
    .getByRole('button', { name: '预览圆形围道', exact: true })
    .boundingBox())!
  const second = (await panel
    .getByRole('button', { name: '预览上半圆围道', exact: true })
    .boundingBox())!
  expect(first.y).toBe(second.y)
  expect(second.x).toBeGreaterThan(first.x + first.width)
  if (info.project.name === 'desktop')
    await expect.poll(async () => (await canvas.boundingBox())!.width).toBe(before.width - 280)
  else expect((await canvas.boundingBox())!.width).toBe(before.width)
  const scroll = page.getByLabel('画布与模板内容', { exact: true })
  await scroll.hover()
  await page.mouse.wheel(0, 400)
  await expect.poll(() => scroll.evaluate((node) => node.scrollTop)).toBeGreaterThan(0)
  await expect(page.getByTestId('contour-path')).toHaveAttribute('d', original!)
  await page.keyboard.press('Escape')
  await expect(panel).toBeHidden()
  await expect(trigger).toBeFocused()
  if (info.project.name === 'desktop') {
    await expect(page.getByRole('complementary', { name: '视图设置', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '关闭视图设置' }).click()
  }
  await expect.poll(async () => (await canvas.boundingBox())!.width).toBe(before.width)
  await trigger.click()
  const templateCanvasBox = (await canvas.boundingBox())!
  const templatePanelBox = (await panel.boundingBox())!
  await page.getByRole('button', { name: '对象列表', exact: true }).click()
  await expect(panel).toBeHidden()
  const objectPanel = page.getByRole('complementary', { name: '对象列表', exact: true })
  await expect(objectPanel).toBeVisible()
  expect(await objectPanel.boundingBox()).toEqual(templatePanelBox)
  expect(await canvas.boundingBox()).toEqual(templateCanvasBox)
  await trigger.click()
  await expect(objectPanel).toBeHidden()
  expect(await panel.boundingBox()).toEqual(templatePanelBox)
  expect(await canvas.boundingBox()).toEqual(templateCanvasBox)
  await panel.getByRole('button', { name: '预览钥匙孔围道', exact: true }).click()
  await panel.getByRole('button', { name: '以此模板新建画布', exact: true }).click()
  if (info.project.name === 'narrow') {
    await expect(panel).toBeHidden()
    await expect(canvas).toBeFocused()
  }
  // Fit includes the almost-full outer circle, not just its nearby cut endpoints.
  const fits = await canvas.evaluate((node) => {
    const svg = node as SVGSVGElement
    const view = svg.viewBox.baseVal
    const path = svg.querySelector('[data-testid="contour-path"]') as SVGPathElement
    const box = path.getBBox()
    return {
      inside:
        box.x >= view.x &&
        box.y >= view.y &&
        box.x + box.width <= view.x + view.width &&
        box.y + box.height <= view.y + view.height,
      width: box.width,
      margin: Math.min(
        box.x - view.x,
        box.y - view.y,
        view.x + view.width - box.x - box.width,
        view.y + view.height - box.y - box.height,
      ),
    }
  })
  expect(fits.inside).toBe(true)
  expect(fits.width).toBeGreaterThan(150)
  expect(fits.margin).toBeGreaterThanOrEqual(55)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    page.viewportSize()!.width,
  )
  await page.screenshot({ path: info.outputPath('contour-templates.png') })
  if (info.project.name === 'narrow') {
    await page.setViewportSize({ width: 320, height: 600 })
    await trigger.click()
    const narrowPanelBox = (await panel.boundingBox())!
    expect(narrowPanelBox.width).toBe(260)
    expect(narrowPanelBox.x + narrowPanelBox.width).toBeLessThanOrEqual(320)
    await page.getByRole('button', { name: '对象列表', exact: true }).click()
    expect(await objectPanel.boundingBox()).toEqual(narrowPanelBox)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320)
  }
})

test(
  'template creation preserves the original canvas and the new geometry stays editable and exportable',
  { tag: '@desktop-only' },
  async ({ page }) => {
    await page.goto('/')
    await loadTemplate(page, '钥匙孔围道')
    await expect(page.getByTestId('contour-path')).toHaveAttribute('d', / A /)
    const saved = await download(page, '保存项目')
    const project = JSON.parse(saved.toString()) as ProjectFile
    expect(project.document.segments.map((segment) => segment.kind)).toEqual(['arc', 'arc'])
    expect(project.document.vertices).toHaveLength(2)
    expect(project.document.avoidances).toEqual([
      expect.objectContaining({ kind: 'corridor', radius: 0.5, gap: 0.3 }),
    ])
    expect(project.document.markers).toContainEqual(
      expect.objectContaining({ re: 0, im: 0, mathematicalKind: 'branch' }),
    )
    await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled()
    await page.getByRole('button', { name: '画布与模板', exact: true }).click()
    await page.getByRole('tab', { name: '我的画布' }).click()
    await page.getByRole('button', { name: '切换到画布 Untitled', exact: true }).click()
    const undone = JSON.parse((await download(page, '保存项目')).toString()) as ProjectFile
    expect(undone.document.segments.every((segment) => segment.kind === 'line')).toBe(true)
    await page.getByRole('button', { name: '切换到画布 钥匙孔围道', exact: true }).click()
    await page.getByRole('button', { name: '收起画布与模板', exact: true }).click()
    const beforeDrag = await page.getByTestId('contour-path').getAttribute('d')
    const vertex = (await page.getByTestId('vertex-v1').boundingBox())!
    await page.mouse.move(vertex.x + vertex.width / 2, vertex.y + vertex.height / 2)
    await page.mouse.down()
    await page.keyboard.down('Alt')
    await page.mouse.move(vertex.x + vertex.width / 2 - 25, vertex.y + vertex.height / 2 - 20, {
      steps: 4,
    })
    await page.mouse.up()
    await page.keyboard.up('Alt')
    await expect(page.getByTestId('contour-path')).not.toHaveAttribute('d', beforeDrag!)
    const moved = await page.getByTestId('contour-path').getAttribute('d')
    const through = (await page.getByTestId('through-edge-v1').boundingBox())!
    await page.mouse.move(through.x + through.width / 2, through.y + through.height / 2)
    await page.mouse.down()
    await page.mouse.move(through.x + through.width / 2 + 12, through.y + through.height / 2 - 16, {
      steps: 4,
    })
    await page.mouse.up()
    await expect(page.getByTestId('contour-path')).not.toHaveAttribute('d', moved!)
    await selectObject(page, '选择顶点 z1')
    await openSection(page, '标签')
    await page.getByRole('checkbox', { name: '显示标签', exact: true }).check()
    await page.getByLabel('LaTeX 标签').fill('R_0')
    await page.getByRole('button', { name: '应用标签' }).click()
    await expect(page.getByTestId('label-v1')).toHaveAttribute('aria-label', 'R_0')
    await page.getByRole('button', { name: '围道属性', exact: true }).click()
    await page.getByLabel('填充形式').selectOption('hatch')
    const edited = await download(page, '保存项目')
    await page
      .getByLabel('打开项目文件')
      .setInputFiles({ name: 'template.json', mimeType: 'application/json', buffer: edited })
    await expect(page.getByText(/已打开 template.json/)).toBeVisible()
    await expect(page.getByTestId('contour-path')).toHaveAttribute('fill', 'url(#contour-hatch)')
    await page.locator('summary[aria-label="导出图像"]').click()
    const svg = (await download(page, '导出 SVG')).toString()
    expect(svg).toContain('fill-rule="nonzero"')
    expect(svg).not.toContain('data-export-omit')
    expect(svg).toContain('C_R')
    const png = await download(page, '导出 PNG')
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
    await page.reload()
    await expect(page.getByTestId('contour-path')).toHaveAttribute('d', / A /)
  },
)

test(
  'keyhole SVG and PNG leave the inner disk, branch cut and pole indentations unfilled',
  { tag: '@desktop-only' },
  async ({ page }) => {
    await page.goto('/')
    await loadTemplate(page, '钥匙孔避让奇点')
    const saved = JSON.parse((await download(page, '保存项目')).toString()) as ProjectFile
    expect(saved.document.avoidances!.map((a) => a.radius)).toEqual([0.5, 0.5])
    const viewport = saved.document.view.viewport!
    await page.locator('summary[aria-label="导出图像"]').click()
    await page.getByLabel('导出范围').selectOption('view')
    await page.getByRole('checkbox', { name: '包含坐标轴', exact: true }).uncheck()
    for (const [name, mime] of [
      ['导出 SVG', 'image/svg+xml'],
      ['导出 PNG', 'image/png'],
    ]) {
      const bytes = await download(page, name)
      const pixels = await page.evaluate(
        async ({ base64, mime, viewport }) => {
          const image = new Image()
          image.src = `data:${mime};base64,${base64}`
          await image.decode()
          const canvas = document.createElement('canvas')
          canvas.width = image.naturalWidth
          canvas.height = image.naturalHeight
          const context = canvas.getContext('2d')!
          context.drawImage(image, 0, 0)
          const scale = image.naturalWidth / 800
          return [
            { re: -2, im: 1 },
            { re: -0.15, im: -0.15 },
            { re: 1, im: 0 },
            { re: 2, im: 0.21 },
            { re: 2, im: -0.21 },
          ].map((point) => {
            const x = (400 + (point.re - viewport.centerRe) * viewport.scaleX) * scale
            const y = (300 - (point.im - viewport.centerIm) * viewport.scaleY) * scale
            return [...context.getImageData(Math.round(x), Math.round(y), 1, 1).data]
          })
        },
        { base64: bytes.toString('base64'), mime, viewport },
      )
      expect(pixels[0][0]).toBeLessThan(250)
      for (const [i, pixel] of pixels.slice(1).entries())
        expect(pixel, `${name} blank sample ${i}`).toEqual([255, 255, 255, 255])
    }
  },
)

test(
  'template detours expose editable bindings and preserve their shape after save and reopen',
  { tag: '@desktop-only' },
  async ({ page }) => {
    await page.goto('/')
    for (const name of ['半圆凹口围道', '钥匙孔围道', '钥匙孔避让奇点', 'Bromwich 割线围道']) {
      await loadTemplate(page, name)
      await selectObject(page, '选择标记点 1')
      const binding = page.getByRole('button', { name: '编辑绕行 1', exact: true })
      await binding.click()
      const before = await page.getByTestId('contour-path').getAttribute('d')
      await page.getByLabel('绕行半径', { exact: true }).fill('0.6')
      await page.getByLabel('绕行半径', { exact: true }).press('Enter')
      await expect(page.getByTestId('contour-path')).not.toHaveAttribute('d', before!)
      const editedPath = await page.getByTestId('contour-path').getAttribute('d')
      const bytes = await download(page, '保存项目')
      const project = JSON.parse(bytes.toString()) as ProjectFile
      expect(project.document.avoidances![0].radius).toBe(0.6)
      expect(project.document.vertices).toHaveLength(2)
      if (name === '钥匙孔避让奇点') {
        expect(project.document.avoidances).toHaveLength(2)
        expect(project.document.avoidances![1].kind).toBe('bank-clearance')
      }
      await page.getByLabel('打开项目文件').setInputFiles({
        name: 'bound-template.json',
        mimeType: 'application/json',
        buffer: bytes,
      })
      await expect(page.getByText('已打开 bound-template.json', { exact: true })).toBeVisible()
      await expect(page.getByTestId('contour-path')).toHaveAttribute('d', editedPath!)
    }
  },
)

test('template detour labels remain separate from singularity labels at fitted scale', async ({
  page,
}, info) => {
  await page.goto('/')
  for (const name of ['半圆凹口围道', '钥匙孔围道', '钥匙孔避让奇点', 'Bromwich 割线围道']) {
    await loadTemplate(page, name)
    await showCanvas(page)
    const labels = await page
      .getByTestId('contour-canvas')
      .locator(
        '[data-testid="label-origin"], [data-testid="label-pole"], [data-testid^="label-avoid:"]',
      )
      .all()
    for (let i = 0; i < labels.length; i++) {
      const a = (await labels[i].boundingBox())!
      for (let j = i + 1; j < labels.length; j++) {
        const b = (await labels[j].boundingBox())!
        expect(
          a.x + a.width <= b.x ||
            b.x + b.width <= a.x ||
            a.y + a.height <= b.y ||
            b.y + b.height <= a.y,
          `${name}: ${await labels[i].getAttribute('aria-label')} / ${await labels[j].getAttribute('aria-label')}`,
        ).toBe(true)
      }
    }
    await page.screenshot({ path: info.outputPath(`${name}-labels.png`) })
  }
})

test(
  'template canvases have independent views and returning to the original restores its preferences',
  { tag: '@desktop-only' },
  async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: '视图设置', exact: true }).click()
    for (const name of [
      '显示网格',
      '显示坐标轴',
      '网格吸附',
      '显示编辑手柄',
      '显示坐标轴刻度标签',
      '锁定两轴 1:1',
    ])
      await page.getByRole('checkbox', { name, exact: true }).uncheck()
    await setCustomColor(page, '坐标轴颜色', '#123456')
    await page.getByLabel('坐标轴箭头', { exact: true }).selectOption('open')
    await page.getByLabel('实轴标签', { exact: true }).fill('x')
    await page.getByLabel('虚轴标签', { exact: true }).fill('y')
    await page.getByRole('button', { name: '应用轴标签', exact: true }).click()
    await page.getByLabel('坐标轴线宽', { exact: true }).focus()
    await page.keyboard.press('End')
    await page.getByLabel('坐标轴箭头大小', { exact: true }).focus()
    await page.keyboard.press('End')
    await page.getByLabel('横轴倍率', { exact: true }).fill('2')
    await page.getByLabel('纵轴倍率', { exact: true }).fill('1')
    await page.getByRole('button', { name: '应用视图比例', exact: true }).click()
    const before = (JSON.parse((await download(page, '保存项目')).toString()) as ProjectFile)
      .document.view
    for (const name of ['圆形围道', '钥匙孔围道', 'Bromwich 围道']) {
      await loadTemplate(page, name)
      const after = (JSON.parse((await download(page, '保存项目')).toString()) as ProjectFile)
        .document.view
      expect(after.grid).toBe(true)
      expect(after.axes).toBeUndefined()
      expect(after.viewport!.locked).toBe(true)
      expect(after.viewport!.scaleY / after.viewport!.scaleX).toBeCloseTo(1)
    }
    await page.getByRole('button', { name: '画布与模板', exact: true }).click()
    await page.getByRole('tab', { name: '我的画布' }).click()
    await page.getByRole('button', { name: '切换到画布 Untitled', exact: true }).click()
    await page.reload()
    const restored = (JSON.parse((await download(page, '保存项目')).toString()) as ProjectFile)
      .document.view
    expect(restored).toEqual(before)
    expect(restored.viewport!.locked).toBe(false)
    expect(restored.viewport!.scaleY / restored.viewport!.scaleX).toBeCloseTo(0.5)
  },
)
