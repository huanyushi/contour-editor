import type { ComplexPoint } from '../../lib/geometry'
import { defaultLabel, defaultPointStyle, type LabelSettings } from './appearance'
import { makeAvoidanceTarget } from './avoidance/avoidanceTarget'
import type { AvoidancePart, MathematicalKind } from './avoidance/avoidanceTypes'
import type { ContourState, Vertex } from './model'
import { resolvedScene } from './scene/sceneObjects'
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

function marker(
  id: string,
  re: number,
  im: number,
  tex: string,
  mathematicalKind?: MathematicalKind,
): SceneObject {
  return {
    id,
    re,
    im,
    ...(mathematicalKind ? { mathematicalKind } : {}),
    label: defaultLabel(tex),
    pointStyle: defaultPointStyle(),
  }
}

function withAvoidance(
  state: ContourState,
  markerId: string,
  target: Parameters<typeof makeAvoidanceTarget>[2],
  partLabels: Partial<Record<AvoidancePart, LabelSettings>>,
): ContourState {
  const result = makeAvoidanceTarget(state, markerId, target)
  if (!result.ok) throw new Error(`模板绕行创建失败：${result.error}`)
  return {
    ...state,
    avoidances: [
      ...state.avoidances,
      {
        ...result.value,
        partLabels,
      },
    ],
  }
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
  const state = contour(
    [point(4, 0, 'R'), point(-4, 0, '-R', -28)],
    { 0: { through: { re: 0, im: 4 }, tex: 'C_R' } },
    indented ? [marker('origin', 0, 0, '0', 'isolated')] : [],
  )
  return indented
    ? withAvoidance(
        state,
        'origin',
        { renderedId: 'edge-v2' },
        {
          arc: { ...defaultLabel('C_\\delta'), dy: -44 },
        },
      )
    : state
}

function keyhole(indented: boolean): ContourState {
  // Only the source circle is authored here. The right-hand opening, inner
  // arc and both banks are derived by the same construction as user drawing.
  const state = contour(
    [point(0, 3.5), point(0, -3.5)],
    {
      0: { through: { re: -3.5, im: 0 }, tex: 'C_R', dx: -36 },
      1: { through: { re: 3.5, im: 0 } },
    },
    [
      marker('origin', 0, 0, '0', 'branch'),
      ...(indented ? [marker('pole', 2, 0, 'z_0', 'isolated')] : []),
    ],
  )
  const parent = withAvoidance(
    state,
    'origin',
    { renderedId: 'edge-v2', point: { re: 3.5, im: 0 } },
    { arc: { ...defaultLabel('C_\\delta'), dx: -46 } },
  )
  if (!indented) return parent
  const bank = resolvedScene(parent).contourSegments.find(
    (segment) => segment.origin.kind === 'avoidance' && segment.origin.part === 'entry',
  )!
  return withAvoidance(
    parent,
    'pole',
    { renderedId: bank.id },
    {
      'bank-entry': { ...defaultLabel('C_{\\delta_1}'), dx: -15, dy: 12 },
      'bank-exit': { ...defaultLabel('C_{\\delta_2}'), dx: -15 },
    },
  )
}

function bromwich(indented: boolean): ContourState {
  const top = polarPoint(4, 60, 'B')
  top.label = { ...top.label!, dy: -24 }
  const bottom = polarPoint(4, -60, 'A')
  const state = contour(
    [top, bottom],
    {
      0: { through: { re: -4, im: 0 }, tex: 'C_R', dx: -38 },
      1: { tex: '\\operatorname{Re} z = \\sigma', dx: 16, dy: -12 },
    },
    indented ? [marker('origin', 0, 0, '0', 'branch')] : [],
  )
  return indented
    ? withAvoidance(
        state,
        'origin',
        { renderedId: 'edge-v1', point: { re: -4, im: 0 } },
        { arc: { ...defaultLabel('C_\\delta'), dx: 24 } },
      )
    : state
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
