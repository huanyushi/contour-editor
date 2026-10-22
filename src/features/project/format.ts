import type { ContourState, PathSegment, Vertex } from '../contour/model'
import type { MarkerObject, SceneObject } from '../contour/workspace'
import type { Avoidance } from '../contour/avoidanceTypes'
import type { ResolvedScene, SceneResolution } from '../contour/resolvedScene'
import { validateAvoidances } from '../contour/avoidanceValidation'
import { defaultAxes, defaultViewport, type Viewport, type AxesSettings } from '../../lib/viewport'
import { readAvoidanceAppearance, readAlignment, writeAvoidance } from './avoidanceSchema'
import { validateSourcePieces } from './sourcePieceSchema'

// Shared by the editor and reader so every accepted edit remains saveable.
export const MAX_PROJECT_BYTES = 2_000_000
export const MAX_VERTICES = 1000
export const MAX_MARKERS = 1000
export const MAX_FORMULAS = 200
export const MAX_CONNECTIONS = 2000
export const MAX_AVOIDANCES = 1000
export const MAX_RESOLVED_POINTS = 10000
export const MAX_RESOLVED_SEGMENTS = 10000

export interface ProjectFile {
  format: 'complex-contour-editor'
  version: 1 | 2 | 3 | 4 | 5 | 6
  document: {
    vertices: Vertex[]
    segments: PathSegment[]
    connections?: PathSegment[]
    avoidances?: Avoidance[]
    markers: MarkerObject[]
    formulas: SceneObject[]
    closed: boolean
    appearance: ContourState['appearance']
    view: Pick<ContourState, 'snap' | 'grid' | 'handles'> & {
      viewport?: Viewport
      axes?: AxesSettings
    }
  }
}

export function serializeProject(state: ContourState): string {
  const hasSemanticData =
    state.avoidances.length > 0 ||
    [...state.vertices, ...state.markers].some(
      (point) => (point.mathematicalKind ?? 'ordinary') !== 'ordinary',
    )
  const project: ProjectFile = {
    format: 'complex-contour-editor',
    version: state.avoidances.some((a) => a.kind === 'corridor' && a.alignment)
      ? 6
      : [...state.segments, ...state.connections].some((s) => s.pieces?.length)
        ? 5
        : state.avoidances.some((a) => a.kind === 'corridor' || a.kind === 'bank-clearance')
          ? 4
          : hasSemanticData
            ? 3
            : state.connections.length
              ? 2
              : 1,
    document: {
      vertices: state.vertices,
      segments: state.segments,
      ...(state.connections.length ? { connections: state.connections } : {}),
      ...(state.avoidances.length
        ? {
            avoidances: state.avoidances.map(writeAvoidance),
          }
        : {}),
      markers: state.markers.map(({ mathematicalKind, ...marker }) => ({
        ...marker,
        ...(mathematicalKind && mathematicalKind !== 'ordinary' ? { mathematicalKind } : {}),
      })),
      formulas: state.formulas,
      closed: state.closed,
      appearance: state.appearance,
      view: {
        snap: state.snap,
        grid: state.grid,
        handles: state.handles,
        ...(JSON.stringify(state.viewport) === JSON.stringify(defaultViewport())
          ? {}
          : { viewport: state.viewport }),
        ...(JSON.stringify(state.axes) === JSON.stringify(defaultAxes())
          ? {}
          : { axes: state.axes }),
      },
    },
  }
  // Compact output cannot grow from added formatting whitespace on the next save.
  return JSON.stringify(project)
}

export function projectCapacityError(state: ContourState): string {
  const result = validateProjectCapacity(state)
  return result.ok ? '' : result.error
}

/** Validate before consuming a derived scene; share the result with projection checks. */
export function validateProjectCapacity(state: ContourState): SceneResolution {
  try {
    validateSourcePieces(state)
    state.avoidances.forEach((avoidance, index) => {
      readAvoidanceAppearance(avoidance, `绕行 ${index + 1}（${avoidance.id}）`)
      if (avoidance.kind === 'corridor') readAlignment(avoidance.alignment, `绕行 ${index + 1}`)
    })
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : '绕行样式或标签无效。' }
  }
  const resolution = validateAvoidances(state)
  if (!resolution.ok) return resolution
  const error = capacityError(state, resolution.scene)
  return error ? { ok: false, error } : resolution
}

function capacityError(state: ContourState, scene: ResolvedScene): string {
  if (state.avoidances.length > MAX_AVOIDANCES)
    return `绕行声明最多 ${MAX_AVOIDANCES} 个，请先删除部分绕行。`
  if (state.connections.length > MAX_CONNECTIONS)
    return `独立路径段最多 ${MAX_CONNECTIONS} 条，请先删除部分路径段。`
  if (state.vertices.length > MAX_VERTICES)
    return `围道端点最多 ${MAX_VERTICES} 个，请先删除部分端点。`
  if (state.markers.length > MAX_MARKERS)
    return `独立点最多 ${MAX_MARKERS} 个，请先删除部分独立点。`
  if (state.formulas.length > MAX_FORMULAS) return `公式最多 ${MAX_FORMULAS} 个，请先删除部分公式。`
  if (scene.points.size > MAX_RESOLVED_POINTS)
    return `派生场景点最多 ${MAX_RESOLVED_POINTS} 个，请减少对象或绕行。`
  if (scene.contourSegments.length + scene.connectionSegments.length > MAX_RESOLVED_SEGMENTS)
    return `派生场景路径段最多 ${MAX_RESOLVED_SEGMENTS} 条，请减少对象或绕行。`
  if (new TextEncoder().encode(serializeProject(state)).byteLength > MAX_PROJECT_BYTES)
    return '项目数据超过 2 MB，请缩短标签或减少对象；本次修改未应用。'
  return ''
}
