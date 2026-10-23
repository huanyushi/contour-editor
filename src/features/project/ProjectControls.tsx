import { useEffect, useMemo, useRef, useState } from 'react'
import { Download, FolderOpen, Save } from 'lucide-react'
import type { ContourState } from '../contour/model'
import { MAX_PROJECT_BYTES, parseProject, serializeProject } from './project'
import { downloadBlob } from './download'
import { defaultExportOptions, renderPng, type ExportOptions } from './export'
import { renderExport } from './renderExport'
import { renderMath } from '../../lib/math'
import { transientLock } from '../../components/transientLock'
import { useOutsideDismiss } from '../../components/useOutsideDismiss'
import { computeExportLayout } from './exportLayout'
import { DEFAULT_PROJECT_NAME, normalizeProjectName, projectDownloadName } from './projectName'
import { CANVAS_LIMIT_MESSAGE } from './canvasWorkspace'

interface Props {
  state: ContourState
  projectName: string
  disabled: boolean
  onLoad: (state: ContourState, name: string) => Promise<boolean>
  onReadingChange: (reading: boolean) => void
  draft: { status: string; error: string }
  canImport?: boolean
  onRetry?: () => void
  onRecover?: () => void
}

export function ProjectControls({
  state,
  projectName,
  disabled,
  onLoad,
  onReadingChange,
  draft,
  canImport = true,
  onRetry,
  onRecover,
}: Props) {
  const input = useRef<HTMLInputElement>(null)
  const [working, setWorking] = useState<'reading' | 'exporting' | null>(null)
  const [open, setOpen] = useState(false)
  const menuRef = useOutsideDismiss<HTMLDetailsElement>(open, setOpen)
  const [options, setOptions] = useState(defaultExportOptions)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const layout = useMemo(() => {
    if (!open) return null
    try {
      return { size: computeExportLayout(state, options).size, error: '' }
    } catch (problem) {
      return {
        size: null,
        error: problem instanceof Error ? problem.message : '无法计算导出尺寸。',
      }
    }
  }, [state, options, open])
  useEffect(() => {
    if (!message || working !== null) return
    const timeout = setTimeout(() => setMessage(''), 4500)
    return () => clearTimeout(timeout)
  }, [message, working])
  const unavailable = working !== null
  const locked = disabled || unavailable
  const update = (patch: Partial<ExportOptions>) => setOptions({ ...options, ...patch })
  const fail = (problem: unknown) => {
    setError(problem instanceof Error ? problem.message : '文件操作失败，请重试。')
    setMessage('')
  }

  function saveProject() {
    if (locked) return
    setError('')
    try {
      const text = serializeProject(state)
      parseProject(text)
      downloadBlob(
        new Blob([text], { type: 'application/json;charset=utf-8' }),
        projectDownloadName(projectName),
      )
      setMessage('项目文件已生成。')
    } catch (problem) {
      fail(problem)
    }
  }

  async function openProject(file: File) {
    if (locked) return
    if (!canImport) {
      setError(CANVAS_LIMIT_MESSAGE)
      return
    }
    setError('')
    setMessage('正在读取项目…')
    setWorking('reading')
    onReadingChange(true)
    try {
      if (file.size > MAX_PROJECT_BYTES) throw new Error('项目文件不能超过 2 MB。')
      const loaded = parseProject(await file.text())
      const success = await onLoad(
        loaded,
        normalizeProjectName(file.name.replace(/\.json$/i, '')) ?? DEFAULT_PROJECT_NAME,
      )
      setMessage(success ? `已打开 ${file.name}` : '')
    } catch (problem) {
      fail(problem)
    } finally {
      setWorking(null)
      onReadingChange(false)
    }
  }

  async function exportImage(format: 'svg' | 'png') {
    if (locked) return
    setError('')
    setMessage('正在生成图像…')
    setWorking('exporting')
    try {
      for (const object of [
        ...state.vertices,
        ...state.segments,
        ...state.connections,
        ...state.markers,
        ...state.formulas,
      ]) {
        if (object.label) {
          const rendering = renderMath(object.label.tex)
          if (rendering.error) throw new Error(rendering.error)
        }
      }
      const svg = renderExport(state, options)
      const blob =
        format === 'svg'
          ? new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
          : await renderPng(svg, options.scale)
      downloadBlob(blob, projectDownloadName(projectName, format))
      setMessage(`${format.toUpperCase()} 已生成。`)
    } catch (problem) {
      fail(problem)
    } finally {
      setWorking(null)
    }
  }

  return (
    <section className="project-controls" aria-label="项目文件与导出">
      <div className="project-buttons">
        <button
          aria-label="保存项目"
          data-tooltip="下载项目文件 (.json)"
          disabled={unavailable}
          {...transientLock(disabled)}
          onClick={saveProject}
        >
          <Save className="ui-icon" aria-hidden="true" />
        </button>
        <button
          aria-label="打开项目"
          data-tooltip={canImport ? '导入为新画布' : CANVAS_LIMIT_MESSAGE}
          disabled={unavailable || !canImport}
          {...transientLock(disabled)}
          onClick={() => input.current?.click()}
        >
          <FolderOpen className="ui-icon" aria-hidden="true" />
        </button>
        <input
          ref={input}
          aria-label="打开项目文件"
          type="file"
          accept=".json,application/json"
          hidden
          disabled={unavailable}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0]
            event.currentTarget.value = ''
            if (file) void openProject(file)
          }}
        />
        <details
          ref={menuRef}
          className="export-menu"
          open={open}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && open) {
              event.stopPropagation()
              setOpen(false)
              event.currentTarget.querySelector('summary')?.focus()
            }
          }}
        >
          <summary
            aria-label="导出图像"
            data-tooltip="导出 SVG / PNG"
            aria-expanded={open}
            {...transientLock(locked)}
            data-unavailable={unavailable ? '' : undefined}
            onClick={(event) => {
              event.preventDefault()
              if (!locked) setOpen(!open)
            }}
          >
            <Download className="ui-icon" aria-hidden="true" />
            <span>导出</span>
          </summary>
          <div className="export-options" hidden={!open}>
            {error && open && (
              <p className="error file-error" role="alert">
                {error}
              </p>
            )}
            <fieldset disabled={unavailable} inert={disabled}>
              <legend>
                独立导出区域{layout?.size && ` · ${layout.size.width} × ${layout.size.height}`}
              </legend>
              <label className="field-row">
                导出范围
                <select
                  aria-label="导出范围"
                  value={options.region}
                  onChange={(event) =>
                    update({ region: event.target.value as ExportOptions['region'] })
                  }
                >
                  <option value="content">适应图形（完整导出）</option>
                  <option value="view">当前视图（800×600）</option>
                </select>
              </label>
              <label className="field-row">
                导出背景
                <select
                  aria-label="导出背景"
                  value={options.background}
                  onChange={(event) =>
                    update({ background: event.target.value as ExportOptions['background'] })
                  }
                >
                  <option value="white">白色</option>
                  <option value="transparent">透明</option>
                </select>
              </label>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={options.axes}
                  onChange={(event) => update({ axes: event.target.checked })}
                />
                包含坐标轴
              </label>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={options.ticks}
                  onChange={(event) => update({ ticks: event.target.checked })}
                />
                包含坐标轴刻度标签
              </label>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={options.grid}
                  onChange={(event) => update({ grid: event.target.checked })}
                />
                包含网格
              </label>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={options.endpoints}
                  onChange={(event) => update({ endpoints: event.target.checked })}
                />
                包含围道端点标记
              </label>
              <label className="field-row">
                PNG 分辨率
                <select
                  aria-label="PNG 分辨率"
                  value={options.scale}
                  onChange={(event) =>
                    update({ scale: Number(event.target.value) as ExportOptions['scale'] })
                  }
                >
                  {([1, 2, 3] as const).map((scale) => (
                    <option key={scale} value={scale}>
                      {scale}×
                      {layout?.size &&
                        ` · ${layout.size.width * scale}×${layout.size.height * scale}`}
                    </option>
                  ))}
                </select>
              </label>
              <p className="muted small">
                {options.region === 'content'
                  ? '完整导出图形与标签，自动保留留白和长宽比；超大图形将等比缩小。PNG 倍率仅提高分辨率。'
                  : '按当前视图中心和比例导出 800×600 区域，范围与全屏画布可能不同。'}
              </p>
              {layout?.error && (
                <p className="error small" role="alert">
                  {layout.error}
                </p>
              )}
              <div className="export-actions">
                <button disabled={!!layout?.error} onClick={() => void exportImage('svg')}>
                  导出 SVG
                </button>
                <button
                  disabled={!!layout?.error}
                  className="primary"
                  onClick={() => void exportImage('png')}
                >
                  导出 PNG
                </button>
              </div>
            </fieldset>
          </div>
        </details>
      </div>
      <div className="draft-line">
        <span role="status" aria-label="画布保存状态" title={`自动保存在此浏览器：${draft.status}`}>
          {draft.status}
        </span>
      </div>
      {message && (
        <p className="file-message" aria-live="polite">
          {message}
        </p>
      )}
      {error && !open && (
        <p className="error file-error" role="alert">
          {error}
        </p>
      )}
      {draft.error && (
        <p className="error file-error" role="alert">
          {draft.error}
          {onRetry && (
            <button {...transientLock(disabled)} onClick={onRetry}>
              重试保存
            </button>
          )}
          {onRecover && (
            <button {...transientLock(disabled)} onClick={onRecover}>
              下载本地数据备份
            </button>
          )}
        </p>
      )}
    </section>
  )
}
