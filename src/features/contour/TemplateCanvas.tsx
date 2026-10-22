import { useCallback, useEffect, useReducer, type RefObject } from 'react'
import { ContourCanvas } from './ContourCanvas'
import { createHistory, historyReducer, type EditorAction } from './history'
import type { ContourTemplate } from './templates'
import { fitScene } from './sceneView'
import { ViewToolbar } from './ViewToolbar'
import type { CanvasSize } from '../../lib/viewport'
import type { ComplexPoint } from '../../lib/geometry'

/** A separate in-memory view: no action here can reach a saved canvas. */
export function TemplateCanvas({
  template,
  size,
  canvasRef,
  onPointerPosition,
  onGestureChange,
}: {
  template: ContourTemplate
  size: CanvasSize
  canvasRef: RefObject<SVGSVGElement | null>
  onPointerPosition: (point: ComplexPoint | null) => void
  onGestureChange: (active: boolean) => void
}) {
  const [history, update] = useReducer(historyReducer, undefined, () => {
    const state = template.create()
    state.handles = false
    state.selection = { kind: 'none' }
    state.viewport = fitScene(state, size) ?? state.viewport
    return createHistory(state)
  })
  const dispatch = useCallback((action: EditorAction) => {
    if (
      ['viewport', 'zoomView', 'viewError', 'beginGesture', 'endGesture', 'cancelGesture'].includes(
        action.type,
      )
    )
      update(action)
  }, [])
  useEffect(() => {
    onGestureChange(history.gesture !== null)
    return () => onGestureChange(false)
  }, [history.gesture, onGestureChange])
  return (
    <>
      <ContourCanvas
        state={history.present}
        dispatch={dispatch}
        gestureOwner={history.gesture?.owner ?? null}
        tool="pan"
        size={size}
        canvasRef={canvasRef}
        onPointerPosition={onPointerPosition}
        onArcPoint={() => {}}
      />
      <ViewToolbar
        state={history.present}
        dispatch={dispatch}
        busy={history.gesture !== null}
        size={size}
        onSettings={() => {}}
        settingsOpen={false}
        settingsDisabled
      />
    </>
  )
}
