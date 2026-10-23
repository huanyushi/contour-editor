import type { Dispatch } from 'react'
import { LocateFixed, Maximize, Minus, Plus, RotateCcw, SlidersHorizontal } from 'lucide-react'
import { defaultViewport, type CanvasSize } from '../../lib/viewport'
import type { ContourAction, ContourState } from './model'
import { fitScene } from './scene/sceneView'
import { transientLock } from '../../components/transientLock'

export function ViewToolbar({
  state,
  dispatch,
  busy,
  size,
  onSettings,
  settingsOpen,
  settingsDisabled = false,
}: {
  state: ContourState
  dispatch: Dispatch<ContourAction>
  busy: boolean
  size: CanvasSize
  onSettings: () => void
  settingsOpen: boolean
  settingsDisabled?: boolean
}) {
  return (
    <div className="view-toolbar" aria-label="画布视图操作">
      <button
        aria-label="放大视图"
        data-tooltip="放大视图"
        {...transientLock(busy)}
        onClick={() => dispatch({ type: 'zoomView', anchor: { x: 400, y: 300 }, factor: 1.25 })}
      >
        <Plus className="ui-icon" aria-hidden="true" />
      </button>
      <button
        aria-label="缩小视图"
        data-tooltip="缩小视图"
        {...transientLock(busy)}
        onClick={() => dispatch({ type: 'zoomView', anchor: { x: 400, y: 300 }, factor: 0.8 })}
      >
        <Minus className="ui-icon" aria-hidden="true" />
      </button>
      <span className="zoom-status">
        {Number((state.viewport.scaleX / 40).toPrecision(3))}×
        {state.viewport.locked ? '' : ` / ${Number((state.viewport.scaleY / 40).toPrecision(3))}×`}
      </span>
      <button
        aria-label="适应图形"
        data-tooltip="适应图形"
        {...transientLock(busy)}
        onClick={() => {
          const value = fitScene(state, size)
          dispatch(
            value
              ? { type: 'viewport', value }
              : {
                  type: 'viewError',
                  message: '对象或标签范围过大，无法适应当前视图范围。请缩短标签或调整坐标。',
                },
          )
        }}
      >
        <Maximize className="ui-icon" aria-hidden="true" />
      </button>
      <button
        aria-label="回到原点"
        data-tooltip="回到原点 · 保留当前缩放和比例"
        {...transientLock(busy)}
        onClick={() =>
          dispatch({ type: 'viewport', value: { ...state.viewport, centerRe: 0, centerIm: 0 } })
        }
      >
        <LocateFixed className="ui-icon" aria-hidden="true" />
      </button>
      <button
        aria-label="重置视图"
        data-tooltip="重置视图"
        {...transientLock(busy)}
        onClick={() => dispatch({ type: 'viewport', value: defaultViewport() })}
      >
        <RotateCcw className="ui-icon" aria-hidden="true" />
      </button>
      <button
        aria-label="视图设置"
        data-tooltip={settingsDisabled ? '新建画布后设置' : '视图设置'}
        disabled={settingsDisabled}
        aria-expanded={settingsOpen}
        aria-controls="view-settings"
        {...transientLock(busy)}
        onClick={onSettings}
      >
        <SlidersHorizontal className="ui-icon" aria-hidden="true" />
      </button>
    </div>
  )
}
