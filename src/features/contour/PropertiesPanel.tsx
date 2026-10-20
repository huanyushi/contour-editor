import { useEffect, useRef, type Dispatch } from 'react'
import { PanelRightClose } from 'lucide-react'
import { canClose, type ContourState } from './model'
import type { EditorAction, GestureOwner } from './history'
import { ObjectProperties } from './ObjectProperties'
import { useSliderHistory } from './useSliderHistory'
import { findSegment } from './sceneObjects'

export function PropertiesPanel({
  state,
  dispatch,
  gestureOwner,
  open,
  onClose,
}: {
  state: ContourState
  dispatch: Dispatch<EditorAction>
  gestureOwner: GestureOwner | null
  open: boolean
  onClose: () => void
}) {
  const scrollArea = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (scrollArea.current) scrollArea.current.scrollTop = 0
  }, [state.selection])
  const sliders = useSliderHistory(dispatch, gestureOwner)
  const selection = state.selection
  const segment = selection.kind === 'segment' ? findSegment(state, selection.id) : undefined
  const title = segment
    ? segment.kind === 'arc'
      ? '圆弧属性'
      : '线段属性'
    : selection.kind === 'vertex'
      ? '顶点属性'
      : selection.kind === 'marker'
        ? '标记点属性'
        : selection.kind === 'formula'
          ? '公式属性'
          : selection.kind === 'multiple'
            ? '多选属性'
            : selection.kind === 'none'
              ? '对象属性'
              : '围道与填充'
  const key = 'id' in selection ? `${selection.kind}:${selection.id}` : selection.kind
  return (
    <aside
      id="properties-panel"
      className="properties-panel side-panel"
      aria-label="对象属性"
      hidden={!open}
      inert={gestureOwner === 'canvas'}
      {...sliders}
    >
      <div className="panel-heading">
        <div>
          <span className="eyebrow">INSPECTOR</span>
          <h2>{title}</h2>
        </div>
        <button
          aria-label="收起属性面板"
          title="收起属性面板"
          aria-expanded="true"
          aria-controls="properties-panel"
          onClick={onClose}
        >
          <PanelRightClose className="ui-icon" aria-hidden="true" />
        </button>
      </div>
      <div ref={scrollArea} className="panel-scroll" tabIndex={0} aria-label="属性面板内容">
        <fieldset className="inspector-fields">
          <ObjectProperties key={key} state={state} dispatch={dispatch} />
          {selection.kind !== 'multiple' && selection.kind !== 'none' && (
            <div className="contour-actions">
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={state.closed}
                  disabled={!canClose(state)}
                  onChange={() => dispatch({ type: 'toggleClosed' })}
                />
                闭合围道
              </label>
              <button
                className="full-width"
                disabled={!state.vertices.length}
                onClick={() => dispatch({ type: 'reverse' })}
              >
                反转方向
              </button>
            </div>
          )}
        </fieldset>
      </div>
    </aside>
  )
}
