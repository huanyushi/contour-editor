import { useState, type Dispatch, type RefObject } from 'react'
import { PanelLeftClose, Settings, X } from 'lucide-react'
import type { ContourState } from '../features/contour/model'
import type { EditorAction, GestureOwner } from '../features/contour/history'
import type { DrawingTool } from '../features/contour/ContourCanvas'
import { ObjectList } from '../features/contour/ObjectList'
import { ViewPanel } from '../features/contour/ViewPanel'
import { useSliderHistory } from '../features/contour/useSliderHistory'
import { createVertex } from '../features/contour/createVertex'

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
    <aside
      id="object-panel"
      className="object-panel side-panel"
      aria-label="对象列表"
      hidden={!open}
    >
      <div className="panel-heading">
        <h2>对象列表</h2>
        <button aria-label="收起对象列表" title="收起对象列表" onClick={onClose}>
          <PanelLeftClose className="ui-icon" aria-hidden="true" />
        </button>
      </div>
      <div className="panel-scroll" tabIndex={0} aria-label="对象列表内容">
        <ObjectList
          state={state}
          dispatch={(action) => {
            dispatch(action)
            onSelect()
          }}
        />
      </div>
    </aside>
  )
}

export function ViewSettingsPanel({
  state,
  dispatch,
  open,
  onClose,
  gestureOwner,
}: PanelProps & { gestureOwner: GestureOwner | null }) {
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
      <div className="panel-scroll" tabIndex={0} aria-label="视图设置内容">
        <ViewPanel state={state} dispatch={dispatch} />
      </div>
    </aside>
  )
}

export function ApplicationMenu({
  state,
  dispatch,
  tool,
  setTool,
  busy,
  onViewSettings,
  onInspect,
  triggerRef,
  onClearDraft,
}: {
  state: ContourState
  dispatch: Dispatch<EditorAction>
  tool: DrawingTool
  setTool: (tool: DrawingTool) => void
  busy: boolean
  onViewSettings: () => void
  onInspect: () => void
  triggerRef: RefObject<HTMLButtonElement | null>
  onClearDraft: () => void
}) {
  const [open, setOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const run = (action: EditorAction) => {
    dispatch(action)
    setOpen(false)
    onInspect()
  }
  return (
    <div
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
        disabled={busy}
        onClick={() => setOpen(!open)}
      >
        <Settings className="ui-icon" aria-hidden="true" />
      </button>
      <div id="application-options" className="application-options" hidden={!open}>
        <button
          onClick={() => {
            setOpen(false)
            onViewSettings()
          }}
        >
          视图设置
        </button>
        <button
          onClick={() => {
            onClearDraft()
            setOpen(false)
            triggerRef.current?.focus()
          }}
        >
          清除本地草稿
        </button>
        <details className="more-actions" open={moreOpen}>
          <summary
            aria-expanded={moreOpen}
            onClick={(event) => {
              event.preventDefault()
              setMoreOpen(!moreOpen)
            }}
          >
            更多操作
          </summary>
          <div className="tool-actions" hidden={!moreOpen}>
            <button
              onClick={() => {
                setTool('select')
                run({ type: 'semicircle' })
              }}
            >
              半圆示例
            </button>
            <button
              onClick={() => {
                setTool('select')
                run({ type: 'reset' })
              }}
            >
              重置示例
            </button>
            <button
              onClick={() => run({ type: 'add', vertex: createVertex({ re: 0, im: 0 }, state) })}
            >
              在原点追加顶点
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
        </details>
      </div>
    </div>
  )
}
