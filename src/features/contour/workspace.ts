import { isValidPoint, type ComplexPoint, type SvgPoint } from '../../lib/geometry'
import { renderMath } from '../../lib/math'
import {
  defaultAxes,
  defaultViewport,
  validAxes,
  validViewport,
  zoomViewport,
  type AxesSettings,
  type Viewport,
} from '../../lib/viewport'
import {
  defaultFill,
  LABEL_OFFSET_LIMIT,
  defaultLabel,
  defaultPointStyle,
  defaultStroke,
  inRange,
  validColor,
  validFill,
  validStroke,
  type FillStyle,
  type LabelSettings,
  type PointStyle,
  type Selection,
  type StrokeStyle,
} from './appearance'
import type { ContourState } from './model'

export interface SceneObject extends ComplexPoint {
  id: string
  label: LabelSettings
  pointStyle: PointStyle
}
export interface WorkspaceState {
  viewport: Viewport
  axes: AxesSettings
  selection: Selection
  markers: SceneObject[]
  formulas: SceneObject[]
  appearance: { stroke: StrokeStyle; fill: FillStyle }
  snap: boolean
  grid: boolean
  handles: boolean
}
export type WorkspaceAction =
  | { type: 'clearVertexLabel'; id: string }
  | { type: 'viewport'; value: Viewport }
  | { type: 'zoomView'; anchor: SvgPoint; factor: number }
  | { type: 'axes'; patch: Partial<AxesSettings> }
  | { type: 'viewError'; message: string }
  | { type: 'selectObject'; selection: Selection }
  | { type: 'addMarker' | 'addFormula'; id: string; point: ComplexPoint }
  | { type: 'moveObject'; kind: 'marker' | 'formula'; id: string; point: ComplexPoint }
  | { type: 'removeObject'; kind: 'marker' | 'formula'; id: string }
  | { type: 'label'; target: Selection; label: LabelSettings }
  | { type: 'pointStyle'; target: Selection; patch: Partial<PointStyle> }
  | { type: 'stroke'; id?: string; patch: Partial<StrokeStyle> }
  | { type: 'fill'; patch: Partial<FillStyle> }
  | { type: 'toggleSnap' | 'toggleGrid' | 'toggleHandles' }

export function createWorkspaceState(): WorkspaceState {
  return {
    viewport: defaultViewport(),
    axes: defaultAxes(),
    selection: { kind: 'vertex', id: 'a' },
    markers: [],
    formulas: [],
    appearance: { stroke: defaultStroke(), fill: defaultFill() },
    snap: true,
    grid: true,
    handles: true,
  }
}

export function workspaceReducer(state: ContourState, action: WorkspaceAction): ContourState {
  switch (action.type) {
    case 'clearVertexLabel':
      return {
        ...state,
        vertices: state.vertices.map((point) => {
          if (point.id !== action.id || !point.label) return point
          const copy = { ...point }
          delete copy.label
          return copy
        }),
        error: '',
      }
    case 'zoomView': {
      const viewport = zoomViewport(state.viewport, action.anchor, action.factor)
      return validViewport(viewport)
        ? { ...state, viewport, error: '' }
        : { ...state, error: '该缩放超出安全视图范围。' }
    }
    case 'viewport':
      return validViewport(action.value)
        ? { ...state, viewport: action.value, error: '' }
        : {
            ...state,
            error: '视图比例须在 0.01–4000 像素/单位之间，中心须是 ±1e12 范围内的有限数值。',
          }
    case 'axes': {
      const axes = { ...state.axes, ...action.patch }
      if (!validAxes(axes)) return { ...state, error: '坐标轴设置超出有效范围。' }
      for (const tex of [axes.reLabel, axes.imLabel]) {
        const result = renderMath(tex)
        if (result.error) return { ...state, error: result.error }
      }
      return { ...state, axes, error: '' }
    }
    case 'viewError':
      return { ...state, error: action.message }
    case 'selectObject': {
      const selection = action.selection
      const exists =
        selection.kind === 'contour' ||
        (selection.kind === 'vertex'
          ? state.vertices
          : selection.kind === 'segment'
            ? state.segments
            : selection.kind === 'marker'
              ? state.markers
              : state.formulas
        ).some((item) => item.id === selection.id)
      if (!exists) return state
      return {
        ...state,
        selection,
        ...(selection.kind === 'vertex' ? { selectedId: selection.id } : {}),
        ...(selection.kind === 'segment' ? { selectedSegmentId: selection.id } : {}),
        error: '',
      }
    }
    case 'addMarker':
    case 'addFormula': {
      if (
        !isValidPoint(action.point) ||
        [...state.markers, ...state.formulas].some((object) => object.id === action.id)
      )
        return state
      const kind = action.type === 'addMarker' ? 'marker' : 'formula'
      const key = kind === 'marker' ? 'markers' : 'formulas'
      const object: SceneObject = {
        ...action.point,
        id: action.id,
        label: {
          ...defaultLabel(kind === 'marker' ? 'z_0' : 'C_R'),
          ...(kind === 'formula' ? { dx: 0, dy: 0 } : {}),
        },
        pointStyle: defaultPointStyle(),
      }
      return {
        ...state,
        [key]: [...state[key], object],
        selection: { kind, id: object.id },
        error: '',
      }
    }
    case 'moveObject': {
      if (!isValidPoint(action.point)) return state
      const key = action.kind === 'marker' ? 'markers' : 'formulas'
      return {
        ...state,
        [key]: state[key].map((item) =>
          item.id === action.id ? { ...item, ...action.point } : item,
        ),
        error: '',
      }
    }
    case 'removeObject': {
      const key = action.kind === 'marker' ? 'markers' : 'formulas'
      return {
        ...state,
        [key]: state[key].filter((item) => item.id !== action.id),
        selection: { kind: 'contour' },
        error: '',
      }
    }
    case 'label': {
      const label = action.label
      if (
        label.tex.length > 2000 ||
        !inRange(label.size, 10, 40) ||
        !inRange(label.dx, -LABEL_OFFSET_LIMIT, LABEL_OFFSET_LIMIT) ||
        !inRange(label.dy, -LABEL_OFFSET_LIMIT, LABEL_OFFSET_LIMIT) ||
        !validColor(label.color)
      )
        return { ...state, error: '标签属性超出有效范围。' }
      const target = action.target
      if (target.kind === 'contour') return state
      const key =
        target.kind === 'vertex'
          ? 'vertices'
          : target.kind === 'segment'
            ? 'segments'
            : target.kind === 'marker'
              ? 'markers'
              : 'formulas'
      return {
        ...state,
        [key]: state[key].map((item) => (item.id === target.id ? { ...item, label } : item)),
        error: '',
      }
    }
    case 'pointStyle': {
      const target = action.target
      if (target.kind !== 'vertex' && target.kind !== 'marker') return state
      const key = target.kind === 'vertex' ? 'vertices' : 'markers'
      const item = state[key].find((point) => point.id === target.id)
      const style = { ...defaultPointStyle(), ...item?.pointStyle, ...action.patch }
      if (!validColor(style.color) || !inRange(style.radius, 2, 10))
        return { ...state, error: '点样式超出有效范围。' }
      return {
        ...state,
        [key]: state[key].map((point) =>
          point.id === target.id ? { ...point, pointStyle: style } : point,
        ),
        error: '',
      }
    }
    case 'stroke': {
      const segment = state.segments.find((item) => item.id === action.id)
      const style = {
        ...state.appearance.stroke,
        ...(action.id ? segment?.style : {}),
        ...action.patch,
      }
      if (!validStroke(style)) return { ...state, error: '线条样式超出有效范围。' }
      return action.id
        ? {
            ...state,
            segments: state.segments.map((item) =>
              item.id === action.id ? { ...item, style: { ...item.style, ...action.patch } } : item,
            ),
            error: '',
          }
        : { ...state, appearance: { ...state.appearance, stroke: style }, error: '' }
    }
    case 'fill': {
      const fill = { ...state.appearance.fill, ...action.patch }
      return validFill(fill)
        ? { ...state, appearance: { ...state.appearance, fill }, error: '' }
        : { ...state, error: '填充属性超出有效范围。' }
    }
    case 'toggleSnap':
      return { ...state, snap: !state.snap }
    case 'toggleGrid':
      return { ...state, grid: !state.grid }
    case 'toggleHandles':
      return { ...state, handles: !state.handles }
  }
}
