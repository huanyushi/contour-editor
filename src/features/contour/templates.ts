import type { ComplexPoint } from '../../lib/geometry'
import { defaultLabel, defaultPointStyle } from './appearance'
import type { ContourState, Vertex } from './model'
import { createWorkspaceState, type SceneObject } from './workspace'

export interface ContourTemplate {
  id: string
  name: string
  description: string
  create: () => ContourState
}

interface EdgePreset {
  through?: ComplexPoint
  tex?: string
  dx?: number
  dy?: number
}

const polar = (radius: number, degrees: number): ComplexPoint => ({
  re: radius * Math.cos((degrees * Math.PI) / 180),
  im: radius * Math.sin((degrees * Math.PI) / 180),
})

function point(re: number, im: number, tex = '', dx = 10, dy = 10): Vertex {
  return { id: '', re, im, label: { ...defaultLabel(tex), dx, dy, visible: !!tex } }
}

function polarPoint(radius: number, degrees: number, tex = ''): Vertex {
  const p = polar(radius, degrees)
  return point(p.re, p.im, tex)
}

function marker(id: string, re: number, im: number, tex: string): SceneObject {
  return { id, re, im, label: defaultLabel(tex), pointStyle: defaultPointStyle() }
}

function contour(
  points: Vertex[],
  edges: Partial<Record<number, EdgePreset>> = {},
  markers: SceneObject[] = [],
  formulas: SceneObject[] = [],
): ContourState {
  const vertices = points.map((p, i) => ({ ...p, id: p.id || `v${i + 1}` }))
  return {
    ...createWorkspaceState(),
    vertices,
    segments: vertices.map((vertex, index) => {
      const edge = edges[index]
      const common = {
        id: `edge-${vertex.id}`,
        startId: vertex.id,
        endId: vertices[(index + 1) % vertices.length].id,
        ...(edge?.tex
          ? { label: { ...defaultLabel(edge.tex), dx: edge.dx ?? 10, dy: edge.dy ?? -26 } }
          : {}),
      }
      return edge?.through
        ? { ...common, kind: 'arc', through: edge.through }
        : { ...common, kind: 'line' }
    }),
    markers,
    formulas,
    selectedId: vertices[0].id,
    selectedSegmentId: `edge-${vertices[0].id}`,
    selection: { kind: 'contour' },
    closed: true,
    error: '',
  }
}

export function createRectangleState(): ContourState {
  return contour([
    { ...point(-4, 0, '-R', -28), id: 'a' },
    { ...point(4, 0, 'R'), id: 'b' },
    { ...point(4, 3, 'R+\\mathrm{i}a', 10, -28), id: 'c' },
    { ...point(-4, 3, '-R+\\mathrm{i}a', -56, -28), id: 'd' },
  ])
}

function semicircle(indented: boolean): ContourState {
  return contour(
    [
      point(4, 0, 'R'),
      point(-4, 0, '-R', -28),
      ...(indented ? [point(-0.5, 0, '-\\delta', -32), point(0.5, 0, '\\delta')] : []),
    ],
    {
      0: { through: { re: 0, im: 4 }, tex: 'C_R' },
      ...(indented
        ? { 2: { through: { re: 0, im: 0.5 }, tex: 'C_\\delta', dx: 12, dy: -18 } }
        : {}),
    },
  )
}

function keyhole(indented: boolean): ContourState {
  // Match the TikZ parallel banks y = ±gap/2. Both inner and outer arcs
  // meet those banks on their circles, rather than on a common radial ray.
  const bank = 0.15
  const outerX = Math.sqrt(3.5 ** 2 - bank ** 2)
  const innerX = Math.sqrt(0.5 ** 2 - bank ** 2)
  if (!indented)
    return contour(
      [
        point(outerX, bank, 'R', 10, -28),
        point(outerX, -bank),
        point(innerX, -bank, '\\delta', 10, 14),
        point(innerX, bank),
      ],
      {
        0: { through: { re: -3.5, im: 0 }, tex: 'C_R', dx: -36 },
        2: { through: { re: -0.5, im: 0 }, tex: 'C_\\delta', dx: -46, dy: -26 },
      },
    )
  return contour(
    [
      point(outerX, bank, 'R', 10, -28),
      point(outerX, -bank),
      point(2 + innerX, -bank),
      point(2 - innerX, -bank),
      point(innerX, -bank, '\\delta', -6, 14),
      point(innerX, bank),
      point(2 - innerX, bank),
      point(2 + innerX, bank),
    ],
    {
      0: { through: { re: -3.5, im: 0 }, tex: 'C_R', dx: -36 },
      2: { through: { re: 2, im: -0.5 }, tex: 'C_{\\delta_1}', dx: -15, dy: 12 },
      4: { through: { re: -0.5, im: 0 }, tex: 'C_\\delta', dx: -46, dy: -26 },
      6: { through: { re: 2, im: 0.5 }, tex: 'C_{\\delta_2}', dx: -15 },
    },
    [marker('pole', 2, 0, 'z_0')],
  )
}

function bromwich(indented: boolean): ContourState {
  const top = polarPoint(4, 60, 'B')
  top.label = { ...top.label!, dy: -24 }
  const bottom = polarPoint(4, -60, 'A')
  if (!indented)
    return contour([top, bottom], {
      0: { through: { re: -4, im: 0 }, tex: 'C_R', dx: -38 },
      1: { tex: '\\operatorname{Re} z = \\sigma', dx: 16, dy: -12 },
    })
  const bank = 0.15
  const outerX = Math.sqrt(4 ** 2 - bank ** 2)
  const innerX = Math.sqrt(0.6 ** 2 - bank ** 2)
  const outerAngle = (Math.asin(bank / 4) * 180) / Math.PI
  return contour(
    [
      top,
      point(-outerX, bank, '-R', -28, -28),
      point(-innerX, bank, '-\\delta', -38, -28),
      point(-innerX, -bank),
      point(-outerX, -bank),
      bottom,
    ],
    {
      0: { through: polar(4, (60 + 180 - outerAngle) / 2), tex: 'C_{R_1}', dx: -36 },
      2: { through: { re: 0.6, im: 0 }, tex: 'C_\\delta', dx: 12, dy: -18 },
      4: { through: polar(4, (-180 + outerAngle - 60) / 2), tex: 'C_{R_2}', dy: 14 },
      5: { tex: '\\operatorname{Re} z = \\sigma', dx: 16, dy: -12 },
    },
  )
}

export const contourTemplates: ContourTemplate[] = [
  {
    id: 'circle',
    name: '圆形围道',
    description: 'Circular Contour · 逆时针圆周',
    create: () =>
      contour([point(3, 0, 'R'), point(-3, 0, '-R', -28)], {
        0: { through: { re: 0, im: 3 }, tex: 'C_R' },
        1: { through: { re: 0, im: -3 } },
      }),
  },
  {
    id: 'semicircle',
    name: '上半圆围道',
    description: 'Semicircular Contour · 上半平面正向边界',
    create: () => semicircle(false),
  },
  {
    id: 'indented-semicircle',
    name: '半圆凹口围道',
    description: 'Indented Semicircle · 顺时针小半圆绕过原点',
    create: () => semicircle(true),
  },
  {
    id: 'sector',
    name: '扇形围道',
    description: 'Sector Contour · 40° 逆时针扇形',
    create: () =>
      contour(
        [point(0, 0), point(5, 0, 'R'), polarPoint(5, 40, 'R \\mathrm{e}^{\\mathrm{i}\\theta}')],
        { 1: { through: polar(5, 20), tex: 'C_R' } },
        [],
        [marker('theta', 0.6, 0.25, '\\theta')],
      ),
  },
  {
    id: 'rectangle',
    name: '矩形围道',
    description: 'Rectangular Contour · 宽 8、高 3 的正向矩形',
    create: createRectangleState,
  },
  {
    id: 'keyhole',
    name: '钥匙孔围道',
    description: 'Keyhole Contour · 外圆逆时针，内圆顺时针，沿正实轴割开',
    create: () => keyhole(false),
  },
  {
    id: 'indented-keyhole',
    name: '钥匙孔避让奇点',
    description: 'Indented Keyhole · 割线两侧分别绕过实轴奇点',
    create: () => keyhole(true),
  },
  {
    id: 'bromwich',
    name: 'Bromwich 围道',
    description: 'Bromwich Contour · 竖线向上，圆弧向左闭合',
    create: () => bromwich(false),
  },
  {
    id: 'indented-bromwich',
    name: 'Bromwich 割线围道',
    description: 'Bromwich Contour · 避开负实轴割线和原点',
    create: () => bromwich(true),
  },
]
