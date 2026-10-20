import { useEffect, useRef, useState } from 'react'
import { Download, FolderOpen, Save } from 'lucide-react'
import type { ContourState } from '../contour/model'
import { MAX_PROJECT_BYTES, parseProject, serializeProject } from './project'
import { downloadBlob } from './download'
import { defaultExportOptions, renderPng, type ExportOptions } from './export'
import { renderExport } from './renderExport'
import { renderMath } from '../../lib/math'

interface Props {
  state: ContourState
  disabled: boolean
  onLoad: (state: ContourState, name: string) => void
  onReadingChange: (reading: boolean) => void
  draft: { status: string; error: string; clear: () => void }
}

export function ProjectControls({ state, disabled, onLoad, onReadingChange, draft }: Props) {
  const input = useRef<HTMLInputElement>(null)
  const [working, setWorking] = useState<'reading' | 'exporting' | null>(null)
  const [open, setOpen] = useState(false)
  const [options, setOptions] = useState(defaultExportOptions)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    if (!message || working !== null) return
    const timeout = setTimeout(() => setMessage(''), 4500)
    return () => clearTimeout(timeout)
  }, [message, working])
  const locked = disabled || working !== null
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
        'contour-project.json',
      )
      setMessage('项目文件已生成。')
    } catch (problem) {
      fail(problem)
    }
  }

  async function openProject(file: File) {
    if (locked) return
    setError('')
    setMessage('正在读取项目…')
    setWorking('reading')
    onReadingChange(true)
    try {
      if (file.size > MAX_PROJECT_BYTES) throw new Error('项目文件不能超过 2 MB。')
      const loaded = parseProject(await file.text())
      onLoad(loaded, file.name.replace(/\.json$/i, ''))
      setMessage(`已打开 ${file.name}`)
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
      downloadBlob(blob, `contour.${format}`)
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
        <button aria-label="保存项目" title="保存项目" disabled={locked} onClick={saveProject}>
          <Save className="ui-icon" aria-hidden="true" />
        </button>
        <button
          aria-label="打开项目"
          title="打开项目"
          disabled={locked}
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
          disabled={locked}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0]
            event.currentTarget.value = ''
            if (file) void openProject(file)
          }}
        />
        <details
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
            title="导出 SVG / PNG"
            aria-expanded={open}
            aria-disabled={locked}
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
            <fieldset disabled={locked}>
              <legend>独立导出区域 · 800 × 600</legend>
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
                导出坐标轴
              </label>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={options.grid}
                  onChange={(event) => update({ grid: event.target.checked })}
                />
                导出网格
              </label>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={options.endpoints}
                  onChange={(event) => update({ endpoints: event.target.checked })}
                />
                导出围道端点标记
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
                  <option value="1">1× · 800×600</option>
                  <option value="2">2× · 1600×1200</option>
                  <option value="3">3× · 2400×1800</option>
                </select>
              </label>
              <p className="muted small">
                按当前视图中心和比例导出 800×600 区域，范围与全屏画布可能不同。
              </p>
              <div className="export-actions">
                <button onClick={() => void exportImage('svg')}>导出 SVG</button>
                <button className="primary" onClick={() => void exportImage('png')}>
                  导出 PNG
                </button>
              </div>
            </fieldset>
          </div>
        </details>
      </div>
      <div className="draft-line">
        <span role="status" aria-label="本地草稿状态" title={`自动保存在此浏览器：${draft.status}`}>
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
        </p>
      )}
    </section>
  )
}
