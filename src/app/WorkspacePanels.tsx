import { useState, type Dispatch, type RefObject } from 'react'
import { Settings, X } from 'lucide-react'
import { LeftPanel } from '../components/LeftPanel'
import type { ContourState } from '../features/contour/model'
import type { EditorAction, GestureOwner } from '../features/contour/history'
import type { DrawingTool } from '../features/contour/ContourCanvas'
import { ObjectList } from '../features/contour/ObjectList'
import { ViewPanel } from '../features/contour/ViewPanel'
import { useSliderHistory } from '../features/contour/interaction/useSliderHistory'
import { createVertex } from '../features/contour/createVertex'
import { transientLock } from '../components/transientLock'
import { useOutsideDismiss } from '../components/useOutsideDismiss'

interface PanelProps {
  state: ContourState
  dispatch: Dispatch<EditorAction>
  open: boolean
  onClose: () => void
}

export function ObjectPanel({
  state,
  dispatch,
  open,
  onClose,
  onSelect,
}: PanelProps & { onSelect: () => void }) {
  return (
    <LeftPanel
      id="object-panel"
      title="对象列表"
      open={open}
      onClose={onClose}
      className="object-panel"
    >
      <ObjectList
        state={state}
        dispatch={(action) => {
          dispatch(action)
          onSelect()
        }}
      />
    </LeftPanel>
  )
}

export function ViewSettingsPanel({
  state,
  dispatch,
  open,
  onClose,
  gestureOwner,
  onAddVertex,
  readOnly = false,
}: PanelProps & {
  gestureOwner: GestureOwner | null
  onAddVertex: () => void
  readOnly?: boolean
}) {
  const sliders = useSliderHistory(dispatch, gestureOwner)
  return (
    <aside
      id="view-settings"
      className="view-settings side-panel"
      aria-label="视图设置"
      hidden={!open}
      inert={gestureOwner === 'canvas'}
      {...sliders}
    >
      <div className="panel-heading">
        <h2>视图设置</h2>
        <button aria-label="关闭视图设置" title="关闭视图设置" onClick={onClose}>
          <X className="ui-icon" aria-hidden="true" />
        </button>
      </div>
      <div className="panel-scroll" tabIndex={0} aria-label="视图设置内容" inert={readOnly}>
        <ViewPanel state={state} dispatch={dispatch} onAddVertex={onAddVertex} />
      </div>
    </aside>
  )
}

export function ApplicationMenu({
  state,
  dispatch,
  tool,
  busy,
  onViewSettings,
  onInspect,
  triggerRef,
}: {
  state: ContourState
  dispatch: Dispatch<EditorAction>
  tool: DrawingTool
  busy: boolean
  onViewSettings: () => void
  onInspect: () => void
  triggerRef: RefObject<HTMLButtonElement | null>
}) {
  const [open, setOpen] = useState(false)
  const menuRef = useOutsideDismiss<HTMLDivElement>(open, setOpen)
  const run = (action: EditorAction) => {
    dispatch(action)
    setOpen(false)
    onInspect()
  }
  return (
    <div
      ref={menuRef}
      className="application-menu"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.stopPropagation()
          setOpen(false)
          triggerRef.current?.focus()
        }
      }}
    >
      <button
        ref={triggerRef}
        aria-label="应用设置"
        title="应用设置"
        aria-expanded={open}
        aria-controls="application-options"
        {...transientLock(busy)}
        onClick={() => setOpen(!open)}
      >
        <Settings className="ui-icon" aria-hidden="true" />
      </button>
      <div id="application-options" className="application-options" hidden={!open} inert={busy}>
        <button
          onClick={() => {
            setOpen(false)
            onViewSettings()
          }}
        >
          视图设置
        </button>
        {tool === 'marker' && (
          <button
            onClick={() =>
              run({
                type: 'addMarker',
                id: createVertex({ re: 0, im: 0 }, state).id,
                point: { re: 0, im: 0 },
              })
            }
          >
            在原点添加独立点
          </button>
        )}
        {tool === 'formula' && (
          <button
            onClick={() =>
              run({
                type: 'addFormula',
                id: createVertex({ re: 0, im: 0 }, state).id,
                point: { re: 0, im: 0 },
              })
            }
          >
            在原点添加公式
          </button>
        )}
      </div>
    </div>
  )
}
