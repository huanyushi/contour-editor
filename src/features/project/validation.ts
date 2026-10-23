import type { ContourState } from '../contour/model'
import { canProjectResolvedScene } from '../contour/scene/sceneView'
import {
  MAX_AVOIDANCES,
  MAX_CONNECTIONS,
  MAX_VERTICES,
  MAX_MARKERS,
  MAX_FORMULAS,
  MAX_RESOLVED_POINTS,
  MAX_RESOLVED_SEGMENTS,
  MAX_PROJECT_BYTES,
  serializeProject,
} from './format'
import type { ResolvedScene, SceneResolution } from '../contour/scene/resolvedScene'
import { validateAvoidances } from '../contour/avoidance/avoidanceValidation'
import { readAvoidanceAppearance, readAlignment } from './avoidanceSchema'
import { validateSourcePieces } from './sourcePieceSchema'
import { arrowPosition, stroke } from './schema'

/** Validate before consuming a derived scene; share the result with projection checks. */
export function validateProjectCapacity(state: ContourState): SceneResolution {
  try {
    stroke(state.appearance.stroke, '默认线条')
    for (const segment of [...state.segments, ...state.connections]) {
      if (segment.style) stroke(segment.style, `路径 ${segment.id}样式`, true)
      if (segment.arrowPosition !== undefined)
        arrowPosition(segment.arrowPosition, `路径 ${segment.id}箭头位置`)
    }
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

/** The final acceptance boundary for both parsed documents and editor candidates. */
export function projectSceneError(state: ContourState): string {
  const resolution = validateProjectCapacity(state)
  if (!resolution.ok) return resolution.error
  // Project the exact candidate scene whose capacity/geometry was just checked.
  if (!canProjectResolvedScene(state, state.viewport, resolution.scene))
    return '当前数值无法在此视图比例下安全绘制，请减小倍率或调整视图。'
  return ''
}
