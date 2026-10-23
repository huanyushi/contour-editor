import { Fragment, type Dispatch, type ReactNode } from 'react'
import {
  CircleDot,
  Hand,
  LayoutTemplate,
  List,
  MousePointer2,
  PaintBucket,
  PanelLeftClose,
  PanelLeftOpen,
  Sigma,
  SquareDashedMousePointer,
  Waypoints,
} from 'lucide-react'
import type { ContourAction, ContourState } from '../features/contour/model'
import type { DrawingTool } from '../features/contour/ContourCanvas'
import { transientLock } from '../components/transientLock'

interface Props {
  state: ContourState
  dispatch: Dispatch<ContourAction>
  tool: DrawingTool
  setTool: (tool: DrawingTool) => void
  busy: boolean
  readOnly?: boolean
  collapsed: boolean
  onCollapse: () => void
  objectsOpen: boolean
  onObjects: () => void
  templatesOpen: boolean
  onTemplates: () => void
  onInspect: () => void
}

const tools: { id: DrawingTool; icon: ReactNode; name: string; hint: string }[] = [
  {
    id: 'select',
    icon: <MousePointer2 className="ui-icon" aria-hidden="true" />,
    name: '选择工具',
    hint: '选择 · 点击对象，拖动调整位置',
  },
  {
    id: 'pan',
    icon: <Hand className="ui-icon" aria-hidden="true" />,
    name: '平移工具',
    hint: '平移 · 拖动画布移动视野',
  },
  {
    id: 'marquee',
    icon: <SquareDashedMousePointer className="ui-icon" aria-hidden="true" />,
    name: '框选工具',
    hint: '框选 · 拖动选择区域，Ctrl / ⌘ 可追加选择',
  },
  {
    id: 'add',
    icon: <Waypoints className="ui-icon" aria-hidden="true" />,
    name: '添加顶点',
    hint: '围道端点 · 点击追加端点',
  },
  {
    id: 'marker',
    icon: <CircleDot className="ui-icon" aria-hidden="true" />,
    name: '独立点工具',
    hint: '独立点 · 点击放置标记点',
  },
  {
    id: 'line',
    icon: (
      <svg className="ui-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 19 19 5" />
      </svg>
    ),
    name: '线段工具',
    hint: '线段 · 依次选择两个点',
  },
  {
    id: 'arc',
    icon: (
      <svg className="ui-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 18a8 8 0 0 1 16 0" />
      </svg>
    ),
    name: '圆弧工具',
    hint: '圆弧 · 选中路径段后点击第三经过点',
  },
  {
    id: 'formula',
    icon: <Sigma className="ui-icon" aria-hidden="true" />,
    name: '公式工具',
    hint: '公式 · 点击放置，在属性中编辑 LaTeX',
  },
]

export function ToolPalette({
  state,
  dispatch,
  tool,
  setTool,
  busy,
  readOnly = false,
  collapsed,
  onCollapse,
  objectsOpen,
  onObjects,
  templatesOpen,
  onTemplates,
  onInspect,
}: Props) {
  return (
    <aside
      className={`tool-palette ${collapsed ? 'collapsed' : ''}`}
      aria-label="绘图工具"
      inert={busy}
    >
      <fieldset className="tool-controls" inert={busy || readOnly} hidden={collapsed}>
        <div
          className="drawing-tools"
          role="toolbar"
          aria-label="绘图工具选择"
          aria-orientation="vertical"
        >
          {tools.map((item) => (
            <Fragment key={item.id}>
              {(item.id === 'add' || item.id === 'formula') && (
                <span className="tool-separator" aria-hidden="true" />
              )}
              <button
                className={`tool-button ${tool === item.id ? 'active' : ''}`}
                aria-label={item.name}
                aria-pressed={tool === item.id}
                data-tooltip={item.hint}
                onClick={() => {
                  setTool(item.id)
                  if (item.id === 'arc')
                    dispatch({ type: 'selectSegment', id: state.selectedSegmentId })
                }}
              >
                {item.icon}
              </button>
            </Fragment>
          ))}
          <button
            className="tool-button"
            aria-label="围道属性"
            data-tooltip="围道属性 · 编辑填充和整体线条"
            aria-controls="properties-panel"
            onClick={() => {
              setTool('select')
              dispatch({ type: 'selectObject', selection: { kind: 'contour' } })
              onInspect()
            }}
          >
            <PaintBucket className="ui-icon" aria-hidden="true" />
          </button>
        </div>
      </fieldset>
      <div className="rail-bottom">
        <button
          className={`tool-button ${templatesOpen ? 'active' : ''}`}
          aria-label="画布与模板"
          data-tooltip="画布与模板"
          aria-expanded={templatesOpen}
          aria-controls="template-panel"
          {...transientLock(busy)}
          onClick={onTemplates}
        >
          <LayoutTemplate className="ui-icon" aria-hidden="true" />
        </button>
        <button
          className="tool-button"
          aria-label="对象列表"
          data-tooltip="对象列表"
          aria-expanded={objectsOpen}
          aria-controls="object-panel"
          onClick={onObjects}
        >
          <List className="ui-icon" aria-hidden="true" />
        </button>
        <button
          className="rail-collapse"
          aria-label={collapsed ? '展开绘图工具' : '收起绘图工具'}
          data-tooltip={collapsed ? '展开绘图工具' : '收起绘图工具'}
          aria-expanded={!collapsed}
          onClick={onCollapse}
        >
          {collapsed ? (
            <PanelLeftOpen className="ui-icon" aria-hidden="true" />
          ) : (
            <PanelLeftClose className="ui-icon" aria-hidden="true" />
          )}
        </button>
      </div>
    </aside>
  )
}
