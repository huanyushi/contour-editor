import type { ContourState, PathSegment, Vertex } from '../contour/model'
import type { MarkerObject, SceneObject } from '../contour/workspace'
import type { Avoidance } from '../contour/avoidance/avoidanceTypes'
import { defaultAxes, defaultViewport, type Viewport, type AxesSettings } from '../../lib/viewport'
import { writeAvoidance } from './avoidanceSchema'

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
  version: 1 | 2 | 3 | 4 | 5 | 6 | 7
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
  const changedStyle = (style: Partial<ContourState['appearance']['stroke']> | undefined) =>
    !!style &&
    ((style.arrowShape !== undefined && style.arrowShape !== 'triangle') ||
      (style.arrowSize !== undefined && style.arrowSize !== 10))
  const hasArrowData =
    changedStyle(state.appearance.stroke) ||
    [...state.segments, ...state.connections].some(
      (s) =>
        s.arrowPosition !== undefined ||
        changedStyle(s.style) ||
        s.pieces?.some((p) => p.arrowPosition !== undefined || changedStyle(p.style)),
    ) ||
    state.avoidances.some(
      (a) =>
        a.partArrowPositions !== undefined || Object.values(a.partStyles ?? {}).some(changedStyle),
    )
  const hasSemanticData =
    state.avoidances.length > 0 ||
    [...state.vertices, ...state.markers].some(
      (point) => (point.mathematicalKind ?? 'ordinary') !== 'ordinary',
    )
  const project: ProjectFile = {
    format: 'complex-contour-editor',
    version: hasArrowData
      ? 7
      : state.avoidances.some((a) => a.kind === 'corridor' && a.alignment)
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
