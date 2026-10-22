import type { ContourState } from '../contour/model'
import { canProjectResolvedScene } from '../contour/sceneView'
import { validateProjectCapacity } from './format'

/** The final acceptance boundary for both parsed documents and editor candidates. */
export function projectSceneError(state: ContourState): string {
  const resolution = validateProjectCapacity(state)
  if (!resolution.ok) return resolution.error
  // Project the exact candidate scene whose capacity/geometry was just checked.
  if (!canProjectResolvedScene(state, state.viewport, resolution.scene))
    return '当前数值无法在此视图比例下安全绘制，请减小倍率或调整视图。'
  return ''
}
