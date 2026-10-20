import { useEffect, useReducer, useRef, useState } from 'react'
import { PanelRightOpen, Redo2, Undo2 } from 'lucide-react'
import { ContourCanvas, type DrawingTool } from '../features/contour/ContourCanvas'
import { PropertiesPanel } from '../features/contour/PropertiesPanel'
import { contourReducer } from '../features/contour/model'
import { createHistory, historyReducer } from '../features/contour/history'
import { useHistoryShortcuts } from '../features/contour/useHistoryShortcuts'
import { useCanvasSize } from '../features/contour/useCanvasSize'
import { ToolPalette } from './ToolPalette'
import { ApplicationMenu, ObjectPanel, ViewSettingsPanel } from './WorkspacePanels'
import { readLocalDraft, useLocalDraft } from '../features/project/useLocalDraft'
import { ProjectControls } from '../features/project/ProjectControls'
import { ViewToolbar } from '../features/contour/ViewToolbar'
import type { ComplexPoint } from '../lib/geometry'

const hints: Record<DrawingTool, string> = {
  select: '选择 · 点击对象编辑，拖动调整位置',
  pan: '平移 · 拖动画布，滚轮缩放',
  add: '围道端点 · 点击追加端点',
  marker: '独立点 · 点击放置标记点',
  line: '直线 · 点击追加直线',
  arc: '圆弧 · 选中路径段后点击第三经过点',
  formula: '公式 · 点击放置，在属性中编辑 LaTeX',
}

const narrowScreen = () => window.innerWidth <= 700
const focusPanel = (id: 'properties-panel' | 'view-settings') => {
  requestAnimationFrame(() =>
    document
      .getElementById(id)
      ?.querySelector<HTMLDivElement>('.panel-scroll')
      ?.focus({ preventScroll: true }),
  )
}

export default function App() {
  const [startup] = useState(readLocalDraft)
  const [history, dispatch] = useReducer(historyReducer, startup.state, createHistory)
  const state = history.present
  const [tool, setTool] = useState<DrawingTool>('select')
  const [reading, setReading] = useState(false)
  const [projectName, setProjectName] = useState('未命名项目')
  const [toolsCollapsed, setToolsCollapsed] = useState(false)
  const [objectsOpen, setObjectsOpen] = useState(false)
  const [inspectorOpen, setInspectorOpen] = useState(() => !narrowScreen())
  const [viewOpen, setViewOpen] = useState(false)
  const [pointer, setPointer] = useState<ComplexPoint | null>(null)
  const canvasArea = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<SVGSVGElement>(null)
  const settingsTrigger = useRef<HTMLButtonElement>(null)
  const size = useCanvasSize(canvasArea)
  const busy = history.gesture !== null || reading
  const draft = useLocalDraft(state, busy, startup)
  useHistoryShortcuts(dispatch, busy)
  useEffect(() => {
    let wasNarrow = narrowScreen()
    const resize = () => {
      const narrow = narrowScreen()
      if (narrow && !wasNarrow) setObjectsOpen(false)
      wasNarrow = narrow
    }
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])

  const inspect = () => {
    setViewOpen(false)
    setInspectorOpen(true)
    if (narrowScreen()) setObjectsOpen(false)
  }
  const chooseTool = (next: DrawingTool) => {
    setTool(next)
    if (narrowScreen()) {
      setInspectorOpen(false)
      setViewOpen(false)
      setObjectsOpen(false)
    }
  }
  const inspectAndFocus = () => {
    inspect()
    focusPanel('properties-panel')
  }
  const openView = () => {
    setViewOpen(true)
    if (narrowScreen()) setObjectsOpen(false)
    focusPanel('view-settings')
  }
  const closeInspector = () => {
    setInspectorOpen(false)
    requestAnimationFrame(() =>
      document.querySelector<HTMLButtonElement>('[aria-label="展开属性面板"]')?.focus(),
    )
  }
  const closeObjects = () => {
    setObjectsOpen(false)
    document.querySelector<HTMLButtonElement>('[aria-label="对象列表"]')?.focus()
  }
  const closeView = () => {
    setViewOpen(false)
    document.querySelector<HTMLButtonElement>('.view-toolbar [aria-label="视图设置"]')?.focus()
  }
  return (
    <div
      className="app-shell"
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        if (viewOpen) closeView()
        else if (objectsOpen) closeObjects()
        else if (narrowScreen() && inspectorOpen) closeInspector()
      }}
    >
      <header className="site-header">
        <div className="brand">
          <span className="brand-icon" aria-hidden="true">
            ∮
          </span>
          <div>
            <h1>Complex Contour Editor</h1>
            <p title={projectName}>{projectName}</p>
          </div>
        </div>
        <div className="global-actions">
          <div className="history-controls" aria-label="编辑历史">
            <button
              aria-label="撤销"
              title="撤销 · Ctrl / ⌘ + Z"
              disabled={!history.past.length || busy}
              onClick={() => dispatch({ type: 'undo' })}
            >
              <Undo2 className="ui-icon" aria-hidden="true" />
            </button>
            <button
              aria-label="重做"
              title="重做 · Ctrl / ⌘ + Shift + Z，或 Ctrl + Y"
              disabled={!history.future.length || busy}
              onClick={() => dispatch({ type: 'redo' })}
            >
              <Redo2 className="ui-icon" aria-hidden="true" />
            </button>
          </div>
          <ProjectControls
            state={state}
            disabled={busy}
            draft={draft}
            onReadingChange={setReading}
            onLoad={(loaded, name) => {
              dispatch({ type: 'loadProject', state: loaded })
              setProjectName(name)
              setTool('select')
              draft.saveNow(loaded)
            }}
          />
          <ApplicationMenu
            state={state}
            dispatch={dispatch}
            tool={tool}
            setTool={setTool}
            busy={busy}
            onInspect={inspectAndFocus}
            triggerRef={settingsTrigger}
            onClearDraft={draft.clear}
            onViewSettings={openView}
          />
        </div>
      </header>
      <main className="editor-layout" inert={reading}>
        <ToolPalette
          state={state}
          dispatch={dispatch}
          tool={tool}
          setTool={chooseTool}
          busy={busy}
          collapsed={toolsCollapsed}
          onCollapse={() => setToolsCollapsed(!toolsCollapsed)}
          objectsOpen={objectsOpen}
          onObjects={() => {
            setObjectsOpen(!objectsOpen)
            if (narrowScreen()) {
              setInspectorOpen(false)
              setViewOpen(false)
            }
          }}
          onInspect={inspect}
        />
        <ObjectPanel
          state={state}
          dispatch={dispatch}
          open={objectsOpen}
          onClose={closeObjects}
          onSelect={inspectAndFocus}
        />
        <section className="workspace" aria-label="围道工作区">
          <div className="canvas-area" ref={canvasArea}>
            {!inspectorOpen && !viewOpen && (
              <button
                className="inspector-restore"
                aria-label="展开属性面板"
                title="展开对象属性"
                aria-expanded="false"
                aria-controls="properties-panel"
                disabled={busy}
                onClick={inspectAndFocus}
              >
                <PanelRightOpen className="ui-icon" aria-hidden="true" /> <span>属性</span>
              </button>
            )}
            <ContourCanvas
              canvasRef={canvasRef}
              size={size}
              state={state}
              dispatch={dispatch}
              gestureOwner={history.gesture?.owner ?? null}
              tool={tool}
              onPointerPosition={setPointer}
              onInspect={inspect}
              onArcPoint={(point) => {
                const action = {
                  type: 'setArc' as const,
                  id: state.selectedSegmentId,
                  through: point,
                }
                const result = contourReducer(state, action)
                dispatch(action)
                if (!result.error) {
                  setTool('select')
                  inspect()
                }
              }}
            />
            <ViewToolbar
              state={state}
              dispatch={dispatch}
              busy={busy}
              size={size}
              settingsOpen={viewOpen}
              onSettings={() => {
                if (viewOpen) closeView()
                else openView()
              }}
            />
            <div className="canvas-status" id="canvas-help">
              <span role="status">{hints[tool]}</span>
              <span className="pointer-position">
                {pointer
                  ? `Re ${pointer.re.toFixed(2)} · Im ${pointer.im.toFixed(2)}`
                  : state.snap
                    ? '整数吸附'
                    : '自由定位'}
              </span>
            </div>
            {state.error && (
              <p role="alert" className="error geometry-error">
                {state.error}
              </p>
            )}
          </div>
        </section>
        <PropertiesPanel
          state={state}
          dispatch={dispatch}
          gestureOwner={history.gesture?.owner ?? null}
          open={inspectorOpen && !viewOpen}
          onClose={closeInspector}
        />
        <ViewSettingsPanel
          state={state}
          dispatch={dispatch}
          gestureOwner={history.gesture?.owner ?? null}
          open={viewOpen}
          onClose={closeView}
        />
      </main>
    </div>
  )
}
