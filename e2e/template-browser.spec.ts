import { expect, test } from '@playwright/test'
import { savedProject } from './selection'

test('template browsing uses the central canvas and a stable fixed-footer button', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('button', { name: '画布与模板', exact: true }).click()
  const canvasesTab = page.getByRole('tab', { name: '我的画布' })
  const templatesTab = page.getByRole('tab', { name: '示例模板' })
  const before = await canvasesTab.boundingBox()
  const originalPath = await page.getByTestId('contour-path').getAttribute('d')
  await templatesTab.click()
  const after = await canvasesTab.boundingBox()
  expect(after!.x).toBe(before!.x)
  expect(after!.width).toBe(before!.width)
  await page.getByRole('button', { name: '预览圆形围道', exact: true }).click()
  await expect(page.getByTestId('contour-path')).toHaveAttribute('d', / A /)
  await page.screenshot({ path: test.info().outputPath('template-browser.png') })
  await expect(page.getByText('点击仅预览，不会修改当前画布')).toHaveCount(0)
  const create = page.getByRole('button', { name: '以此模板新建画布' })
  await expect(create).toBeInViewport()
  const footerBefore = await create.boundingBox()
  const scroll = page.getByLabel('画布与模板内容', { exact: true })
  await scroll.hover()
  await page.mouse.wheel(0, 1000)
  await expect.poll(() => scroll.evaluate((node) => node.scrollTop)).toBeGreaterThan(0)
  expect(await create.boundingBox()).toEqual(footerBefore)
  await canvasesTab.click()
  await expect(page.getByTestId('contour-path')).toHaveAttribute('d', originalPath!)
  await expect(page.getByRole('button', { name: '画布与模板', exact: true })).toHaveAttribute(
    'title',
    '画布与模板',
  )
  await expect(page.getByRole('button', { name: '对象列表', exact: true })).toHaveAttribute(
    'title',
    '对象列表',
  )
})

test(
  'template navigation and keyboard actions never change the saved work or its history',
  { tag: '@desktop-only' },
  async ({ page }) => {
    await page.goto('/')
    await page.getByLabel('实部 Re', { exact: true }).fill('-3')
    await page.getByRole('button', { name: '应用坐标' }).click()
    const original = await savedProject(page)
    await page.getByRole('button', { name: '画布与模板', exact: true }).click()
    await page.getByRole('tab', { name: '示例模板' }).click()
    await page.getByRole('button', { name: '预览圆形围道', exact: true }).click()
    const previewPath = await page.getByTestId('contour-path').getAttribute('d')
    await page.getByRole('button', { name: '收起画布与模板', exact: true }).click()
    await page.getByRole('button', { name: '放大视图', exact: true }).click()
    await expect(page.getByTestId('contour-path')).not.toHaveAttribute('d', previewPath!)
    const canvas = page.getByTestId('contour-canvas')
    const box = (await canvas.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 20, { steps: 4 })
    await page.mouse.up()
    await canvas.focus()
    await page.keyboard.press('Control+z')
    await page.keyboard.press('Delete')
    await page.getByRole('button', { name: '画布与模板', exact: true }).click()
    await page.getByRole('tab', { name: '我的画布' }).click()
    expect(await savedProject(page)).toEqual(original)
    await page.getByRole('button', { name: '撤销', exact: true }).click()
    expect((await savedProject(page)).document.vertices[0].re).toBe(-4)
  },
)

test('delete confirmation buttons match and heading has breathing room', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '画布与模板', exact: true }).click()
  await page.getByRole('button', { name: '删除画布 Untitled', exact: true }).click()
  const cancel = await page.getByRole('button', { name: '取消', exact: true }).boundingBox()
  const confirm = await page.getByRole('button', { name: '确认删除', exact: true }).boundingBox()
  expect(confirm!.width).toBe(cancel!.width)
  expect(confirm!.height).toBe(cancel!.height)
  expect(confirm!.y).toBe(cancel!.y)
  const gap = await page.getByRole('dialog').evaluate((dialog) => {
    return (
      dialog.querySelector('p')!.getBoundingClientRect().top -
      dialog.querySelector('h2')!.getBoundingClientRect().bottom
    )
  })
  expect(gap).toBeGreaterThanOrEqual(16)
})
