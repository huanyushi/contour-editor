import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { PanelRightOpen, Redo2, Undo2 } from 'lucide-react'
import { Github } from '../components/Github'
import { ContourCanvas, type DrawingTool } from '../features/contour/ContourCanvas'
import { PropertiesPanel } from '../features/contour/PropertiesPanel'
import { contourReducer } from '../features/contour/model'
import { useHistoryShortcuts } from '../features/contour/interaction/useHistoryShortcuts'
import { useCanvasSize } from '../features/contour/useCanvasSize'
import { ToolPalette } from './ToolPalette'
import { ApplicationMenu, ObjectPanel, ViewSettingsPanel } from './WorkspacePanels'
import {
  useCanvasWorkspace,
  type CanvasWorkspaceManager,
} from '../features/project/useCanvasWorkspace'
import { createBlankCanvasState, MAX_CANVASES } from '../features/project/canvasWorkspace'
import { downloadLocalRecovery } from '../features/project/canvasMigration'
import { ProjectControls } from '../features/project/ProjectControls'
import { ProjectName } from '../features/project/ProjectName'
import { ViewToolbar } from '../features/contour/ViewToolbar'
import type { ComplexPoint } from '../lib/geometry'
import { TemplatePanel } from '../features/contour/TemplatePanel'
import { TemplateCanvas } from '../features/contour/TemplateCanvas'
import type { ContourTemplate } from '../features/contour/templates'
import { fitScene } from '../features/contour/scene/sceneView'
import { createVertex } from '../features/contour/createVertex'
import { useSelectionShortcuts } from '../features/contour/interaction/useSelectionShortcuts'
import { transientLock } from '../components/transientLock'
import { useAvoidanceDraft } from '../features/contour/avoidance/useAvoidanceDraft'

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
  return requestAnimationFrame(() =>
    document
      .getElementById(id)
      ?.querySelector<HTMLDivElement>('.panel-scroll')
      ?.focus({ preventScroll: true }),
  )
}

export default function App() {
  const manager = useCanvasWorkspace()
  if (!manager.ready)
    return (
      <div className="startup-status" role="status">
        正在恢复画布…
      </div>
    )
  return <Editor manager={manager} />
}

function Editor({ manager }: { manager: CanvasWorkspaceManager }) {
  const { history, name: projectName, id: canvasId } = manager.active
  const dispatch = manager.dispatch
  const state = history.present
  const avoidanceWorkflow = useAvoidanceDraft(state, dispatch)
  const [tool, setTool] = useState<DrawingTool>('select')
  const [reading, setReading] = useState(false)
  const setProjectName = (name: string) => manager.rename(canvasId, name)
  const [toolsCollapsed, setToolsCollapsed] = useState(false)
  const [objectsOpen, setObjectsOpen] = useState(false)
  const [templatesOpen, setTemplatesOpen] = useState(false)
  const [previewTemplate, setPreviewTemplate] = useState<ContourTemplate | null>(null)
  const [previewGesture, setPreviewGesture] = useState(false)
  const [inspectorOpen, setInspectorOpen] = useState(() => !narrowScreen())
  const [viewOpen, setViewOpen] = useState(false)
  const inspectorVisible = inspectorOpen && !viewOpen
  const [pointer, setPointer] = useState<ComplexPoint | null>(null)
  const [focusCanvas, setFocusCanvas] = useState(false)
  const [previousCanvasId, setPreviousCanvasId] = useState(canvasId)
  if (previousCanvasId !== canvasId) {
    setPreviousCanvasId(canvasId)
    avoidanceWorkflow.cancel()
    setTool('select')
    setPointer(null)
    setPreviewTemplate(null)
  }
  const canvasArea = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<SVGSVGElement>(null)
  const settingsTrigger = useRef<HTMLButtonElement>(null)
  const targetError =
    avoidanceWorkflow.draft.kind === 'pickTarget' ? (avoidanceWorkflow.draft.error ?? '') : ''
  const [previousTargetError, setPreviousTargetError] = useState(targetError)
  if (previousTargetError !== targetError) {
    setPreviousTargetError(targetError)
    if (targetError) {
      setViewOpen(false)
      setInspectorOpen(true)
      if (narrowScreen()) {
        setObjectsOpen(false)
        setTemplatesOpen(false)
      }
    } else if (avoidanceWorkflow.draft.kind === 'pickTarget' && narrowScreen()) {
      // Retrying clears only the picking error; expose the canvas again.
      setInspectorOpen(false)
    }
  }
  const [avoidancePhase, setAvoidancePhase] = useState(avoidanceWorkflow.draft.kind)
  if (avoidancePhase !== avoidanceWorkflow.draft.kind) {
    setAvoidancePhase(avoidanceWorkflow.draft.kind)
    if (avoidanceWorkflow.draft.kind === 'pickTarget') {
      setTool('select')
      if (narrowScreen()) {
        setInspectorOpen(false)
        setViewOpen(false)
        setObjectsOpen(false)
        setTemplatesOpen(false)
      }
    } else if (
      avoidanceWorkflow.draft.kind === 'configure' ||
      (avoidancePhase === 'pickTarget' && state.selection.kind === 'segment')
    ) {
      setViewOpen(false)
      setInspectorOpen(true)
      if (narrowScreen()) {
        setObjectsOpen(false)
        setTemplatesOpen(false)
      }
    }
  }
  useLayoutEffect(() => {
    if (avoidanceWorkflow.draft.kind === 'pickTarget' && !targetError) {
      dispatch({ type: 'clearSelection' })
      canvasRef.current?.focus({ preventScroll: true })
    }
  }, [avoidanceWorkflow.draft.kind, targetError, dispatch])
  useEffect(() => {
    if (!focusCanvas || manager.working || reading || templatesOpen) return
    const frame = requestAnimationFrame(() => {
      canvasRef.current?.focus({ preventScroll: true })
      setFocusCanvas(false)
    })
    return () => cancelAnimationFrame(frame)
  }, [focusCanvas, manager.working, reading, templatesOpen, canvasId])
  useEffect(() => {
    if (!inspectorVisible || (avoidanceWorkflow.draft.kind !== 'configure' && !targetError)) return
    const frame = focusPanel('properties-panel')
    return () => cancelAnimationFrame(frame)
  }, [avoidanceWorkflow.draft.kind, targetError, inspectorVisible])
  const size = useCanvasSize(canvasArea)
  const busy = history.gesture !== null || reading || manager.working || previewGesture
  const editingLocked = busy || previewTemplate !== null
  useHistoryShortcuts(dispatch, editingLocked)
  useSelectionShortcuts(dispatch, state.selection, editingLocked)
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
    avoidanceWorkflow.cancel()
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
    avoidanceWorkflow.cancel()
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
    if (previewTemplate) canvasRef.current?.focus({ preventScroll: true })
    else document.querySelector<HTMLButtonElement>('.view-toolbar [aria-label="视图设置"]')?.focus()
  }
  const closeTemplates = () => {
    setTemplatesOpen(false)
    document.querySelector<HTMLButtonElement>('[aria-label="画布与模板"]')?.focus()
  }
  const afterCanvasChange = (success: boolean) => {
    if (!success) return
    avoidanceWorkflow.cancel()
    setTool('select')
    setPreviewTemplate(null)
    if (narrowScreen()) {
      setTemplatesOpen(false)
      setFocusCanvas(true)
    }
  }
  const loadTemplate = async (template: ContourTemplate) => {
    if (busy) return
    avoidanceWorkflow.cancel()
    const next = template.create()
    const viewport = fitScene(next, size)
    if (!viewport) {
      dispatch({ type: 'viewError', message: '当前画布空间不足，请收起侧栏后重试。' })
      return
    }
    next.viewport = viewport
    afterCanvasChange(await manager.add(next, template.name))
  }
  return (
    <div
      className="app-shell"
      onKeyDownCapture={(event) => {
        if (event.key !== 'Escape' || avoidanceWorkflow.draft.kind === 'idle') return
        if ((event.target as HTMLElement).closest('dialog, .canvas-rename')) return
        if ((event.target as HTMLElement).closest('.project-name')) return
        // Canvas owns pointer capture and must release its local drag as well.
        if (canvasRef.current?.contains(event.target as Node)) return
        event.preventDefault()
        event.stopPropagation()
        if (history.gesture) dispatch({ type: 'cancelGesture', owner: history.gesture.owner })
        avoidanceWorkflow.cancel()
        requestAnimationFrame(() => canvasRef.current?.focus({ preventScroll: true }))
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        const panel = (event.target as HTMLElement).closest('.side-panel')?.id
        if (previewTemplate) {
          if (panel === 'template-panel' && templatesOpen) closeTemplates()
          else if (viewOpen) closeView()
          else if (templatesOpen) closeTemplates()
          else if (narrowScreen() && inspectorOpen) closeInspector()
          return
        }
        if (
          state.selection.kind === 'multiple' ||
          ((tool === 'marquee' || tool === 'line') && state.selection.kind !== 'none')
        ) {
          dispatch({ type: 'clearSelection' })
          return
        }
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
          <div className="brand-text">
            <h1>Complex Contour Editor</h1>
            <ProjectName
              key={canvasId}
              name={projectName}
              onChange={setProjectName}
              busy={editingLocked}
            />
          </div>
        </div>
        <div className="global-actions">
          <div className="history-controls" aria-label="编辑历史">
            <button
              aria-label="撤销"
              title="撤销 · Ctrl / ⌘ + Z"
              disabled={!history.past.length}
              {...transientLock(editingLocked)}
              onClick={() => dispatch({ type: 'undo' })}
            >
              <Undo2 className="ui-icon" aria-hidden="true" />
            </button>
            <button
              aria-label="重做"
              title="重做 · Ctrl / ⌘ + Shift + Z，或 Ctrl + Y"
              disabled={!history.future.length}
              {...transientLock(editingLocked)}
              onClick={() => dispatch({ type: 'redo' })}
            >
              <Redo2 className="ui-icon" aria-hidden="true" />
            </button>
          </div>
          <ProjectControls
            state={state}
            projectName={projectName}
            disabled={editingLocked}
            draft={manager}
            canImport={manager.workspace.canvases.length < MAX_CANVASES}
            onRetry={() => {
              void manager.retry()
            }}
            onRecover={() => {
              void downloadLocalRecovery()
            }}
            onReadingChange={setReading}
            onLoad={async (loaded, name) => {
              const success = await manager.add(loaded, name)
              afterCanvasChange(success)
              return success
            }}
          />
          <div className="external-project">
            <a
              className="header-link"
              href="https://github.com/huanyushi/contour-editor"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="GitHub · 查看源代码"
              title="GitHub · 查看源代码"
              {...transientLock(busy)}
            >
              <Github className="ui-icon" aria-hidden="true" />
            </a>
          </div>
          <ApplicationMenu
            state={state}
            dispatch={dispatch}
            tool={tool}
            busy={editingLocked}
            onInspect={inspectAndFocus}
            triggerRef={settingsTrigger}
            onViewSettings={openView}
          />
        </div>
      </header>
      <main className="editor-layout" inert={reading || manager.working}>
        <ToolPalette
          state={state}
          dispatch={dispatch}
          tool={previewTemplate ? 'pan' : tool}
          setTool={chooseTool}
          busy={busy}
          readOnly={previewTemplate !== null}
          collapsed={toolsCollapsed}
          onCollapse={() => {
            if (state.selectionSource === 'marquee') dispatch({ type: 'clearSelection' })
            setToolsCollapsed(!toolsCollapsed)
          }}
          objectsOpen={objectsOpen}
          onObjects={() => {
            setPreviewTemplate(null)
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
          onPreview={(template) => {
            if (template) avoidanceWorkflow.cancel()
            setPointer(null)
            setPreviewTemplate(template)
          }}
          workspace={manager.workspace}
          onActivate={(id) => {
            void manager.activate(id).then(afterCanvasChange)
          }}
          onCreateBlank={() => {
            void manager.add(createBlankCanvasState(), 'Untitled').then(afterCanvasChange)
          }}
          onRename={manager.rename}
          onDuplicate={(id) => {
            void manager.duplicate(id).then(afterCanvasChange)
          }}
          onDelete={async (id) => {
            const active = id === canvasId
            const success = await manager.remove(id)
            if (active) afterCanvasChange(success)
            return success
          }}
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
                {...transientLock(editingLocked)}
                onClick={inspectAndFocus}
              >
                <PanelRightOpen className="ui-icon" aria-hidden="true" /> <span>属性</span>
              </button>
            )}
            {previewTemplate ? (
              <TemplateCanvas
                key={`template-${previewTemplate.id}`}
                template={previewTemplate}
                size={size}
                canvasRef={canvasRef}
                onPointerPosition={setPointer}
                onGestureChange={setPreviewGesture}
              />
            ) : (
              <>
                <ContourCanvas
                  key={canvasId}
                  canvasRef={canvasRef}
                  size={size}
                  state={state}
                  dispatch={dispatch}
                  gestureOwner={history.gesture?.owner ?? null}
                  tool={tool}
                  onPointerPosition={setPointer}
                  onInspect={inspect}
                  avoidanceWorkflow={avoidanceWorkflow}
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
              </>
            )}
            <div className="canvas-status" id="canvas-help">
              <span role="status">
                {previewTemplate
                  ? previewTemplate.name
                  : avoidanceWorkflow.draft.kind === 'pickTarget'
                    ? '选择绕行目标 · 点击源路径（直线或圆弧），Esc 取消'
                    : hints[tool]}
              </span>
              <span className="pointer-position">
                {pointer
                  ? `Re ${pointer.re.toFixed(2)} · Im ${pointer.im.toFixed(2)}`
                  : state.snap
                    ? '网格吸附'
                    : '自由定位'}
              </span>
            </div>
            {!previewTemplate &&
              (state.error ||
                (!inspectorVisible &&
                  avoidanceWorkflow.preview &&
                  !avoidanceWorkflow.preview.ok)) && (
                <p role="alert" className="error geometry-error">
                  {!inspectorVisible && avoidanceWorkflow.preview && !avoidanceWorkflow.preview.ok
                    ? avoidanceWorkflow.preview.error
                    : state.error}
                </p>
              )}
          </div>
        </section>
        <PropertiesPanel
          key={`properties-${canvasId}`}
          state={state}
          dispatch={dispatch}
          avoidanceWorkflow={avoidanceWorkflow}
          readOnly={previewTemplate !== null}
          gestureOwner={history.gesture?.owner ?? null}
          open={inspectorVisible}
          onClose={closeInspector}
        />
        <ViewSettingsPanel
          key={`view-${canvasId}`}
          state={state}
          dispatch={dispatch}
          gestureOwner={history.gesture?.owner ?? null}
          open={viewOpen}
          onClose={closeView}
          readOnly={previewTemplate !== null}
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
