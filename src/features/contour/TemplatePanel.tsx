import { useEffect, useRef, useState } from 'react'
import { Copy, Pencil, Plus, Trash2 } from 'lucide-react'
import { LeftPanel } from '../../components/LeftPanel'
import { contourTemplates, type ContourTemplate } from './templates'
import { transientLock } from '../../components/transientLock'
import { SceneThumbnail } from './scene/SceneThumbnail'
import {
  CANVAS_LIMIT_MESSAGE,
  committedState,
  MAX_CANVASES,
  type CanvasEntry,
  type CanvasWorkspace,
} from '../project/canvasWorkspace'

// Model creation is independent of the currently edited canvas.
const templates = contourTemplates.map((template) => ({ template, state: template.create() }))

interface Props {
  open: boolean
  onClose: () => void
  disabled: boolean
  workspace: CanvasWorkspace
  onLoad: (template: ContourTemplate) => void
  onPreview?: (template: ContourTemplate | null) => void
  onActivate: (id: string) => void
  onCreateBlank: () => void
  onRename: (id: string, name: string) => void
  onDuplicate: (id: string) => void
  onDelete: (id: string) => Promise<boolean>
}

export function TemplatePanel({
  open,
  onClose,
  disabled,
  workspace,
  onLoad,
  onPreview,
  onActivate,
  onCreateBlank,
  onRename,
  onDuplicate,
  onDelete,
}: Props) {
  const [tab, setTab] = useState<'canvases' | 'templates'>('canvases')
  const [selected, setSelected] = useState<(typeof templates)[number] | null>(null)
  const [renaming, setRenaming] = useState<CanvasEntry | null>(null)
  const [name, setName] = useState('')
  const [deleting, setDeleting] = useState<CanvasEntry | null>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const cancel = useRef<HTMLButtonElement>(null)
  const renameInput = useRef<HTMLInputElement>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const limit = workspace.canvases.length >= MAX_CANVASES
  useEffect(() => {
    if (!deleting) return
    const node = dialog.current
    if (node?.showModal) node.showModal()
    else node?.setAttribute('open', '')
    cancel.current?.focus()
  }, [deleting])
  useEffect(() => {
    if (renaming) {
      renameInput.current?.focus()
      renameInput.current?.select()
    }
  }, [renaming])
  const restore = () =>
    requestAnimationFrame(() => {
      if (returnFocus.current?.isConnected) returnFocus.current.focus()
      else
        document.querySelector<HTMLButtonElement>('#template-panel [aria-current="true"]')?.focus()
    })
  const closeDialog = () => {
    dialog.current?.close?.()
    setDeleting(null)
    restore()
  }
  const changeTab = (next: typeof tab) => {
    setTab(next)
    onPreview?.(next === 'templates' ? (selected?.template ?? null) : null)
  }
  return (
    <LeftPanel
      id="template-panel"
      title="画布与模板"
      className="template-panel"
      open={open}
      onClose={onClose}
      header={
        open && (
          <div
            className="canvas-tabs"
            role="tablist"
            aria-label="画布与模板分类"
            onKeyDown={(event) => {
              if (disabled) return
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
              event.preventDefault()
              const next =
                event.key === 'Home'
                  ? 'canvases'
                  : event.key === 'End'
                    ? 'templates'
                    : tab === 'canvases'
                      ? 'templates'
                      : 'canvases'
              changeTab(next)
              document.getElementById(`tab-${next}`)?.focus()
            }}
          >
            {(
              [
                ['canvases', '我的画布'],
                ['templates', '示例模板'],
              ] as const
            ).map(([value, title]) => (
              <button
                key={value}
                role="tab"
                id={`tab-${value}`}
                aria-selected={tab === value}
                aria-controls={`tabpanel-${value}`}
                tabIndex={tab === value ? 0 : -1}
                {...transientLock(disabled)}
                onClick={() => changeTab(value)}
              >
                {title}
              </button>
            ))}
          </div>
        )
      }
      footer={
        open &&
        tab === 'templates' && (
          <div className="template-footer">
            <button
              className="primary"
              aria-label="以此模板新建画布"
              title={
                limit
                  ? CANVAS_LIMIT_MESSAGE
                  : selected
                    ? `以${selected.template.name}新建画布`
                    : '选择模板后新建画布'
              }
              disabled={limit || !selected}
              {...transientLock(disabled)}
              onClick={() => {
                if (selected) onLoad(selected.template)
              }}
            >
              <span className="template-create-content">
                <Plus className="ui-icon" aria-hidden="true" />
                <span>新建画布</span>
              </span>
            </button>
          </div>
        )
      }
    >
      {open && (
        <>
          {limit && (
            <p className="canvas-limit" role="status">
              {CANVAS_LIMIT_MESSAGE}
            </p>
          )}
          <div
            role="tabpanel"
            id="tabpanel-canvases"
            aria-labelledby="tab-canvases"
            hidden={tab !== 'canvases'}
          >
            {tab === 'canvases' && (
              <>
                <p className="template-intro">
                  {workspace.canvases.length} / {MAX_CANVASES} 张 · 自动保存在此浏览器
                </p>
                <div className="template-grid canvas-grid">
                  {workspace.canvases.map((entry) => (
                    <div
                      className={`canvas-card ${workspace.activeId === entry.id ? 'current' : ''}`}
                      key={entry.id}
                    >
                      <button
                        className="template-card"
                        aria-label={`切换到画布 ${entry.name}`}
                        aria-current={workspace.activeId === entry.id ? 'true' : undefined}
                        title={entry.name}
                        {...transientLock(disabled)}
                        onClick={() => onActivate(entry.id)}
                      >
                        <SceneThumbnail
                          state={committedState(entry.history)}
                          label={`${entry.name}缩略图`}
                        />
                        <span>{entry.name}</span>
                        {workspace.activeId === entry.id && (
                          <small className="current-badge">当前</small>
                        )}
                      </button>
                      <div className="canvas-card-actions">
                        <button
                          aria-label={`重命名画布 ${entry.name}`}
                          title="重命名"
                          {...transientLock(disabled)}
                          onClick={(event) => {
                            returnFocus.current = event.currentTarget
                            setRenaming(entry)
                            setName(entry.name)
                          }}
                        >
                          <Pencil className="ui-icon" aria-hidden="true" />
                        </button>
                        <button
                          aria-label={`复制画布 ${entry.name}`}
                          title={limit ? CANVAS_LIMIT_MESSAGE : '复制'}
                          disabled={limit}
                          {...transientLock(disabled)}
                          onClick={() => onDuplicate(entry.id)}
                        >
                          <Copy className="ui-icon" aria-hidden="true" />
                        </button>
                        <button
                          aria-label={`删除画布 ${entry.name}`}
                          title="删除"
                          {...transientLock(disabled)}
                          onClick={(event) => {
                            returnFocus.current = event.currentTarget
                            setDeleting(entry)
                          }}
                        >
                          <Trash2 className="ui-icon" aria-hidden="true" />
                        </button>
                      </div>
                      {renaming?.id === entry.id && (
                        <form
                          className="canvas-rename"
                          onSubmit={(event) => {
                            event.preventDefault()
                            onRename(entry.id, name)
                            setRenaming(null)
                            restore()
                          }}
                          onKeyDown={(event) => {
                            if (event.key === 'Escape') {
                              event.stopPropagation()
                              setRenaming(null)
                              restore()
                            }
                          }}
                        >
                          <input
                            ref={renameInput}
                            aria-label="画布名称"
                            maxLength={100}
                            value={name}
                            onChange={(event) => setName(event.target.value)}
                          />
                          <button type="submit" {...transientLock(disabled)}>
                            确认名称
                          </button>
                        </form>
                      )}
                    </div>
                  ))}
                  <button
                    className="template-card add-canvas"
                    aria-label="新建空白画布"
                    title={limit ? CANVAS_LIMIT_MESSAGE : '新建完全空白的画布'}
                    disabled={limit}
                    {...transientLock(disabled)}
                    onClick={onCreateBlank}
                  >
                    <Plus className="ui-icon" aria-hidden="true" />
                    <span>新建空白画布</span>
                  </button>
                </div>
              </>
            )}
          </div>
          <div
            role="tabpanel"
            id="tabpanel-templates"
            aria-labelledby="tab-templates"
            hidden={tab !== 'templates'}
          >
            {tab === 'templates' && (
              <>
                <div className="template-grid">
                  {templates.map((item) => (
                    <button
                      key={item.template.id}
                      className="template-card"
                      aria-label={`预览${item.template.name}`}
                      aria-pressed={selected === item}
                      title={item.template.description}
                      {...transientLock(disabled)}
                      onClick={() => {
                        setSelected(item)
                        onPreview?.(item.template)
                      }}
                    >
                      <SceneThumbnail state={item.state} label={`${item.template.name}缩略图`} />
                      <span>{item.template.name}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          {deleting && (
            <dialog
              ref={dialog}
              className="canvas-confirm"
              aria-labelledby="canvas-delete-title"
              onKeyDown={(event) => {
                if (event.key === 'Escape') event.stopPropagation()
              }}
              onCancel={(event) => {
                event.preventDefault()
                closeDialog()
              }}
            >
              <h2 id="canvas-delete-title">删除画布</h2>
              <p>
                确定删除“{deleting.name}”？
                {workspace.canvases.length === 1
                  ? '这是最后一张画布，将重置为空白画布。'
                  : '此操作无法撤销。'}
              </p>
              <div className="export-actions">
                <button ref={cancel} onClick={closeDialog}>
                  取消
                </button>
                <button
                  className="danger"
                  {...transientLock(disabled)}
                  onClick={() => {
                    void onDelete(deleting.id).then((success) => {
                      if (success) closeDialog()
                    })
                  }}
                >
                  确认删除
                </button>
              </div>
            </dialog>
          )}
        </>
      )}
    </LeftPanel>
  )
}
