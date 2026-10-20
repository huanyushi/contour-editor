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
import { TemplatePanel } from '../features/contour/TemplatePanel'
import type { ContourTemplate } from '../features/contour/templates'
import { fitScene } from '../features/contour/sceneView'
import { createVertex } from '../features/contour/createVertex'
import { useSelectionShortcuts } from '../features/contour/useSelectionShortcuts'
import { transientLock } from '../components/transientLock'

const hints: Record<DrawingTool, string> = {
  select: '选择 · 点击对象编辑，拖动调整位置',
  pan: '平移 · 拖动画布，滚轮缩放',
  marquee: '框选 · 拖动选择区域，Ctrl / ⌘ 追加，Delete 删除',
  add: '围道端点 · 点击追加端点',
  marker: '独立点 · 点击放置标记点',
  line: '线段 · 依次选择两个点',
  arc: '圆弧 · 选中路径段后点击第三经过点',
  formula: '公式 · 点击放置，在属性中编辑 LaTeX',
}

const narrowScreen = () => window.innerWidth <= 700
const focusPanel = (id: 'properties-panel' | 'view-settings' | 'template-panel') => {
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
  const [templatesOpen, setTemplatesOpen] = useState(false)
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
  useSelectionShortcuts(dispatch, state.selection, busy)
  useEffect(() => {
    let wasNarrow = narrowScreen()
    const resize = () => {
      const narrow = narrowScreen()
      if (narrow && !wasNarrow) {
        setObjectsOpen(false)
        setTemplatesOpen(false)
      }
      wasNarrow = narrow
    }
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])

  const inspect = () => {
    setViewOpen(false)
    setInspectorOpen(true)
    if (narrowScreen()) {
      setObjectsOpen(false)
      setTemplatesOpen(false)
    }
  }
  const chooseTool = (next: DrawingTool) => {
    dispatch({ type: 'clearSelection' })
    setTool(next)
    if (narrowScreen()) {
      setInspectorOpen(false)
      setViewOpen(false)
      setObjectsOpen(false)
      setTemplatesOpen(false)
    }
  }
  const inspectAndFocus = () => {
    inspect()
    focusPanel('properties-panel')
  }
  const openView = () => {
    setViewOpen(true)
    if (narrowScreen()) {
      setObjectsOpen(false)
      setTemplatesOpen(false)
    }
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
  const closeTemplates = () => {
    setTemplatesOpen(false)
    document.querySelector<HTMLButtonElement>('[aria-label="示例模板"]')?.focus()
  }
  const loadTemplate = (template: ContourTemplate) => {
    if (busy) return
    const next = {
      ...template.create(),
      axes: state.axes,
      grid: state.grid,
      snap: state.snap,
      handles: state.handles,
      viewport: state.viewport,
    }
    const viewport = fitScene(next, size)
    if (!viewport) {
      dispatch({ type: 'viewError', message: '当前画布空间不足，请收起侧栏后重试。' })
      return
    }
    next.viewport = viewport
    dispatch({ type: 'loadProject', state: next })
    setProjectName(template.name)
    setTool('select')
    draft.saveNow(next)
    if (narrowScreen()) {
      setTemplatesOpen(false)
      requestAnimationFrame(() => canvasRef.current?.focus({ preventScroll: true }))
    }
  }
  return (
    <div
      className="app-shell"
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        if (
          state.selection.kind === 'multiple' ||
          ((tool === 'marquee' || tool === 'line') && state.selection.kind !== 'none')
        ) {
          dispatch({ type: 'clearSelection' })
          return
        }
        const panel = (event.target as HTMLElement).closest('.side-panel')?.id
        if (panel === 'template-panel' && templatesOpen) closeTemplates()
        else if (panel === 'object-panel' && objectsOpen) closeObjects()
        else if (viewOpen) closeView()
        else if (templatesOpen) closeTemplates()
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
              disabled={!history.past.length}
              {...transientLock(busy)}
              onClick={() => dispatch({ type: 'undo' })}
            >
              <Undo2 className="ui-icon" aria-hidden="true" />
            </button>
            <button
              aria-label="重做"
              title="重做 · Ctrl / ⌘ + Shift + Z，或 Ctrl + Y"
              disabled={!history.future.length}
              {...transientLock(busy)}
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
          onCollapse={() => {
            if (state.selectionSource === 'marquee') dispatch({ type: 'clearSelection' })
            setToolsCollapsed(!toolsCollapsed)
          }}
          objectsOpen={objectsOpen}
          onObjects={() => {
            if (state.selectionSource === 'marquee') dispatch({ type: 'clearSelection' })
            setObjectsOpen(!objectsOpen)
            setTemplatesOpen(false)
            if (narrowScreen()) {
              setInspectorOpen(false)
              setViewOpen(false)
            }
          }}
          templatesOpen={templatesOpen}
          onTemplates={() => {
            if (state.selectionSource === 'marquee') dispatch({ type: 'clearSelection' })
            if (templatesOpen) closeTemplates()
            else {
              setTemplatesOpen(true)
              setObjectsOpen(false)
              if (narrowScreen()) {
                setInspectorOpen(false)
                setViewOpen(false)
              }
              focusPanel('template-panel')
            }
          }}
          onInspect={inspect}
        />
        <TemplatePanel
          open={templatesOpen}
          onClose={closeTemplates}
          disabled={busy}
          onLoad={loadTemplate}
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
                {...transientLock(busy)}
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
          onAddVertex={() => {
            dispatch({ type: 'add', vertex: createVertex({ re: 0, im: 0 }, state) })
            setTool('select')
            inspectAndFocus()
          }}
        />
      </main>
    </div>
  )
}
