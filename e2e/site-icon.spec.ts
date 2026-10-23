import { expect, test } from '@playwright/test'

test('contour brand logo fits its header and its arrow follows the curve tangent', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: info.project.name === 'narrow' ? 320 : 1280, height: 720 })
  await page.goto('/')
  const logo = page.locator('.brand-icon')
  await expect(logo.locator('svg')).toBeVisible()
  await expect(logo.locator('circle')).toHaveCount(1)
  const geometry = await logo.evaluate((node) => {
    const svg = node.querySelector('svg')!
    const [contour, arrow] = svg.querySelectorAll('path')
    const point = (path: SVGPathElement, length: number) => {
      const p = path.getPointAtLength(length)
      return new DOMPoint(p.x, p.y).matrixTransform(path.getScreenCTM()!)
    }
    const arrowLength = arrow.getTotalLength()
    const tip = point(arrow, arrowLength / 2)
    const start = point(arrow, 0)
    const end = point(arrow, arrowLength)
    const direction = { x: tip.x - (start.x + end.x) / 2, y: tip.y - (start.y + end.y) / 2 }
    const openingDegrees =
      (Math.acos(
        ((start.x - tip.x) * (end.x - tip.x) + (start.y - tip.y) * (end.y - tip.y)) /
          (Math.hypot(start.x - tip.x, start.y - tip.y) * Math.hypot(end.x - tip.x, end.y - tip.y)),
      ) *
        180) /
      Math.PI
    const length = contour.getTotalLength()
    const contourSamples: DOMPoint[] = []
    let nearest = 0
    let distance = Infinity
    for (let i = 0; i <= 1000; i++) {
      const at = (i / 1000) * length
      const p = point(contour, at)
      contourSamples.push(p)
      const d = Math.hypot(p.x - tip.x, p.y - tip.y)
      if (d < distance) {
        distance = d
        nearest = at
      }
    }
    const before = point(contour, nearest - 0.05)
    const after = point(contour, nearest + 0.05)
    const tangent = { x: after.x - before.x, y: after.y - before.y }
    const alignment =
      (direction.x * tangent.x + direction.y * tangent.y) /
      (Math.hypot(direction.x, direction.y) * Math.hypot(tangent.x, tangent.y))
    const strokeRadius = (path: SVGPathElement) => {
      const matrix = path.getScreenCTM()!
      return (parseFloat(getComputedStyle(path).strokeWidth) * Math.hypot(matrix.a, matrix.b)) / 2
    }
    const strokePadding = strokeRadius(contour) + strokeRadius(arrow)
    const wingClearances = [0, 0.125, 0.875, 1].map((fraction) => {
      const wing = point(arrow, arrowLength * fraction)
      return (
        Math.min(...contourSamples.map((p) => Math.hypot(p.x - wing.x, p.y - wing.y))) -
        strokePadding
      )
    })
    const bounds = (element: Element) => {
      const box = element.getBoundingClientRect()
      return { x: box.x, y: box.y, width: box.width, height: box.height }
    }
    const svgBounds = bounds(svg)
    return {
      distance,
      alignment,
      openingDegrees,
      wingClearances,
      tipPosition: {
        x: (tip.x - svgBounds.x) / svgBounds.width,
        y: (tip.y - svgBounds.y) / svgBounds.height,
      },
      container: bounds(node),
      svg: svgBounds,
    }
  })
  expect(geometry.distance, 'arrow tip sits on the contour').toBeLessThan(0.1)
  expect(geometry.alignment, 'arrow points along the directed tangent').toBeGreaterThan(0.999)
  expect(geometry.openingDegrees, 'arrowhead keeps a compact opening').toBeLessThanOrEqual(95)
  expect(geometry.tipPosition.x, 'arrow sits on the right-hand arc').toBeGreaterThan(0.55)
  expect(geometry.tipPosition.y, 'arrow sits on the lower arc').toBeGreaterThan(0.55)
  for (const clearance of geometry.wingClearances) {
    expect(clearance, 'both arrow wings stay visibly separate from the contour').toBeGreaterThan(
      0.3,
    )
  }
  expect(geometry.svg).toEqual(geometry.container)
  await expect(page.locator('.brand h1')).toHaveText('Complex Contour Editor')
  await page
    .locator('.site-header')
    .screenshot({ path: info.outputPath('contour-logo-header.png') })
})

test(
  'site icons load and decode from the deployed project subdirectory',
  {
    tag: '@desktop-only',
  },
  async ({ page }) => {
    await page.goto('/contour-editor/')
    const icons = page.locator('link[rel="icon"]')
    await expect(icons).toHaveCount(3)
    for (const icon of await icons.all()) {
      const href = await icon.getAttribute('href')
      const url = new URL(href!, page.url())
      expect(url.origin).toBe(new URL(page.url()).origin)
      expect(url.pathname).toMatch(/^\/contour-editor\/favicon/)
      const response = await page.request.get(url.href)
      expect(response.ok()).toBe(true)
      const dimensions = await page.evaluate(async (href) => {
        const image = new Image()
        image.src = href
        await image.decode()
        return { width: image.naturalWidth, height: image.naturalHeight }
      }, url.href)
      expect(dimensions.width).toBeGreaterThan(0)
      expect(dimensions.width).toBe(dimensions.height)
      const sizes = await icon.getAttribute('sizes')
      if (sizes) expect(`${dimensions.width}x${dimensions.height}`).toBe(sizes)
    }
  },
)
