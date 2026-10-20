import type { ContourState, PathSegment, Vertex } from '../contour/model'
import type { SceneObject } from '../contour/workspace'
import { defaultAxes, defaultViewport, type Viewport, type AxesSettings } from '../../lib/viewport'

// Shared by the editor and reader so every accepted edit remains saveable.
export const MAX_PROJECT_BYTES = 2_000_000
export const MAX_VERTICES = 1000
export const MAX_MARKERS = 1000
export const MAX_FORMULAS = 200

export interface ProjectFile {
  format: 'complex-contour-editor'
  version: 1
  document: {
    vertices: Vertex[]
    segments: PathSegment[]
    markers: SceneObject[]
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
  const project: ProjectFile = {
    format: 'complex-contour-editor',
    version: 1,
    document: {
      vertices: state.vertices,
      segments: state.segments,
      markers: state.markers,
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
  if (state.vertices.length > MAX_VERTICES)
    return `围道端点最多 ${MAX_VERTICES} 个，请先删除部分端点。`
  if (state.markers.length > MAX_MARKERS)
    return `独立点最多 ${MAX_MARKERS} 个，请先删除部分独立点。`
  if (state.formulas.length > MAX_FORMULAS) return `公式最多 ${MAX_FORMULAS} 个，请先删除部分公式。`
  if (new TextEncoder().encode(serializeProject(state)).byteLength > MAX_PROJECT_BYTES)
    return '项目数据超过 2 MB，请缩短标签或减少对象；本次修改未应用。'
  return ''
}
