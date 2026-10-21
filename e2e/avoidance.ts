import { expect, type Page } from '@playwright/test'
import { arcThrough } from '../src/lib/arc'
import { parseProject, serializeProject, type ProjectFile } from '../src/features/project/project'
import { resolveScene } from '../src/features/contour/resolvedScene'
import type { ContourState } from '../src/features/contour/model'
import { selectObject, showCanvas } from './navigation'
import { clickPoint, screenPoint } from './selection'

export async function openAvoidanceProject(page: Page, state: ContourState | ProjectFile) {
  await page.getByLabel('打开项目文件').setInputFiles({
    name: 'avoidance.json',
    mimeType: 'application/json',
    buffer: Buffer.from('version' in state ? JSON.stringify(state) : serializeProject(state)),
  })
  await expect(page.getByText('已打开 avoidance.json', { exact: true })).toBeVisible()
  await showCanvas(page)
}

export async function startAvoidance(page: Page, marker = 1) {
  await selectObject(page, `选择标记点 ${marker}`)
  await page.getByRole('button', { name: '添加绕行', exact: true }).click()
}

export async function configureAvoidance(page: Page, marker = 1, targetRe = -2) {
  await startAvoidance(page, marker)
  await showCanvas(page)
  await clickPoint(page, targetRe, 0)
  await expect(page.getByRole('button', { name: '应用绕行', exact: true })).toBeEnabled()
  await expect(page.getByTestId('avoidance-preview')).toBeVisible()
}

export async function dragPoint(
  page: Page,
  from: [number, number],
  to: [number, number],
  cancel = false,
) {
  await showCanvas(page)
  const start = await screenPoint(page, ...from)
  const end = await screenPoint(page, ...to)
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(end.x, end.y, { steps: 8 })
  if (cancel) await page.keyboard.press('Escape')
  await page.mouse.up()
}

export interface BoundArcExpectation {
  radius: number
  side: 'left' | 'right'
  preferredOpeningWidth: number
  source: [[number, number], [number, number]]
}

/** Expected parameters come from pre-drag UI values and known source coordinates, never the result. */
export async function expectBoundCircle(
  page: Page,
  file: ProjectFile,
  center: [number, number],
  expected: BoundArcExpectation,
) {
  expect(file.version).toBe(3)
  expect(file.document.avoidances).toHaveLength(1)
  const binding = file.document.avoidances![0]
  expect(binding.radius, 'drag/history/reopen must preserve the independently applied radius').toBe(
    expected.radius,
  )
  expect(binding.side).toBe(expected.side)
  expect(binding.openingRatio).toBeCloseTo(
    expected.preferredOpeningWidth / (2 * expected.radius),
    12,
  )
  expect(file.document.markers.find((m) => m.id === binding.markerId)).toMatchObject({
    re: center[0],
    im: center[1],
  })
  const state = parseProject(JSON.stringify(file))
  // Equal mathematical axes make SVG arclength fractions true circle-angle fractions.
  expect(state.viewport).toEqual({
    centerRe: 0,
    centerIm: 0,
    scaleX: 40,
    scaleY: 40,
    locked: true,
  })
  const source = state.segments.find((s) => s.id === binding.targetSegmentId)!
  for (const [index, id] of [source.startId, source.endId].entries()) {
    const point = state.vertices.find((v) => v.id === id)!
    expect([point.re, point.im]).toEqual(expected.source[index])
  }
  const resolution = resolveScene(state)
  expect(resolution.ok).toBe(true)
  if (!resolution.ok) throw new Error(resolution.error)
  const segment = resolution.scene.contourSegments.find((s) => s.id === `avoid:${binding.id}:arc`)!
  if (segment.kind !== 'arc') throw new Error('Expected bound arc')
  const circle = arcThrough(
    resolution.scene.points.get(segment.startId)!,
    resolution.scene.points.get(segment.endId)!,
    segment.through,
  )
  expect(circle.ok).toBe(true)
  if (!circle.ok) throw new Error(circle.error)
  expect(circle.arc.center.re).toBeCloseTo(center[0], 9)
  expect(circle.arc.center.im).toBeCloseTo(center[1], 9)
  expect(circle.arc.radius).toBeCloseTo(expected.radius, 9)
  const renderedPath = await page.getByTestId(`segment-${segment.id}`).evaluate((node) => {
    const path = node as SVGPathElement
    const length = path.getTotalLength()
    const at = (t: number) => {
      const p = path.getPointAtLength(length * t)
      return { re: (p.x - 400) / 40, im: (300 - p.y) / 40 }
    }
    return {
      samples: [0, 0.25, 0.5, 0.75, 1].map(at),
      tangent: [at(0.49), at(0.51)],
      length: length / 40,
      command: path
        .getAttribute('d')!
        .trim()
        .split(/[\s,]+/),
    }
  })
  const { samples, command } = renderedPath
  // Fit the exact SVG command, not a circle through Chromium's interpolated samples
  // (a tilted 8px arc's sampled midpoint can be ~.003px off the analytic circle).
  const svgStart = [(Number(command[1]) - 400) / 40, (300 - Number(command[2])) / 40]
  const svgEnd = [(Number(command[9]) - 400) / 40, (300 - Number(command[10])) / 40]
  const rx = Number(command[4]) / 40
  const chordX = svgEnd[0] - svgStart[0],
    chordY = svgEnd[1] - svgStart[1]
  const chordLength = Math.hypot(chordX, chordY)
  const heightSquared = rx ** 2 - (chordLength / 2) ** 2
  const height = Math.abs(heightSquared) < 1e-14 ? 0 : Math.sqrt(heightSquared)
  const centerSign = command[7] === command[8] ? 1 : -1
  expect((svgStart[0] + svgEnd[0]) / 2 - (centerSign * height * chordY) / chordLength).toBeCloseTo(
    center[0],
    9,
  )
  expect((svgStart[1] + svgEnd[1]) / 2 + (centerSign * height * chordX) / chordLength).toBeCloseTo(
    center[1],
    9,
  )

  // Independent analytic oracle in the directed source frame: no avoidance/arc kernel
  // computes these expectations. These fixtures are exactly online or farther than r
  // from the source, so offline openings equal the explicitly applied preference.
  const [[ax, ay], [bx, by]] = expected.source
  const length = Math.hypot(bx - ax, by - ay)
  const tx = (bx - ax) / length,
    ty = (by - ay) / length
  const signedDistance = -(center[0] - ax) * ty + (center[1] - ay) * tx
  const onLine = Math.abs(signedDistance) < 1e-12
  if (!onLine) expect(Math.abs(signedDistance)).toBeGreaterThan(expected.radius)
  const direction = onLine ? (expected.side === 'left' ? 1 : -1) : Math.sign(signedDistance)
  const halfOpening = onLine ? expected.radius : expected.preferredOpeningWidth / 2
  const inset = onLine ? 0 : Math.sqrt(expected.radius ** 2 - halfOpening ** 2)
  const sweep =
    -direction * (onLine ? Math.PI : 2 * Math.PI - 2 * Math.asin(halfOpening / expected.radius))
  const startAngle = Math.atan2(-direction * inset, -halfOpening)
  const inFrame = (p: { re: number; im: number }) => {
    const dx = p.re - center[0],
      dy = p.im - center[1]
    return { u: dx * tx + dy * ty, v: -dx * ty + dy * tx }
  }
  const local = samples.map(inFrame)
  // Chromium's length-based interpolation has subpixel error on short tilted arcs.
  // Keep exact command geometry at 1e-9; allow only 1/20 CSS pixel for sampled positions/length.
  const expectSample = (actual: number, value: number) =>
    expect(Math.abs(actual - value), 'SVG interpolation within .05 CSS pixel').toBeLessThanOrEqual(
      0.05 / 40,
    )
  expect(command).toHaveLength(11)
  expect([command[0], command[3]]).toEqual(['M', 'A'])
  expect(Number(command[4])).toBeCloseTo(expected.radius * 40, 9)
  expect(Number(command[5])).toBeCloseTo(expected.radius * 40, 9)
  expect(Number(command[6])).toBe(0)
  expect(command.slice(7, 9).map(Number), 'large-arc and SVG sweep flags').toEqual([
    onLine ? 0 : 1,
    direction > 0 ? 1 : 0,
  ])
  for (const [index, point] of [svgStart, svgEnd].entries()) {
    const endpoint = inFrame({ re: point[0], im: point[1] })
    expect(endpoint.u).toBeCloseTo(index ? halfOpening : -halfOpening, 9)
    expect(endpoint.v).toBeCloseTo(-direction * inset, 9)
  }
  expectSample(local[0].u, -halfOpening)
  expectSample(local[4].u, halfOpening)
  expectSample(local[0].v, -direction * inset)
  expectSample(local[4].v, -direction * inset)
  expectSample(local[2].u, 0)
  expectSample(local[2].v, direction * expected.radius)
  for (const [index, t] of [0, 0.25, 0.5, 0.75, 1].entries()) {
    expectSample(local[index].u, expected.radius * Math.cos(startAngle + sweep * t))
    expectSample(local[index].v, expected.radius * Math.sin(startAngle + sweep * t))
    expectSample(Math.hypot(local[index].u, local[index].v), expected.radius)
    if (index) {
      const previous = local[index - 1],
        current = local[index]
      expect(
        Math.sign(previous.u * current.v - previous.v * current.u),
        'signed angular traversal',
      ).toBe(-direction)
    }
  }
  const [beforeMid, afterMid] = renderedPath.tangent.map(inFrame)
  expect(afterMid.u - beforeMid.u, 'midpoint tangent follows source direction').toBeGreaterThan(0)
  expectSample(afterMid.v - beforeMid.v, 0)
  expectSample(renderedPath.length, expected.radius * Math.abs(sweep))
  if (!onLine) {
    const chordNormal = (local[0].v + local[4].v) / 2
    expect(chordNormal * signedDistance, 'opening faces the source, not away from it').toBeLessThan(
      0,
    )
    expect(Math.abs(signedDistance + chordNormal)).toBeLessThan(Math.abs(signedDistance))
  }
  await expect(page.locator('[data-testid^="through-avoid:"]')).toHaveCount(0)
  await expect(page.locator('[data-testid^="vertex-avoid:"]')).toHaveCount(0)
}
