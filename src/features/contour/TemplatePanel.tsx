import { useMemo } from 'react'
import { LeftPanel } from '../../components/LeftPanel'
import { toSvg } from '../../lib/geometry'
import { buildContourGeometry } from './pathGeometry'
import { fitScene } from './sceneView'
import { contourTemplates, type ContourTemplate } from './templates'
import { transientLock } from '../../components/transientLock'

function TemplateThumbnail({ template }: { template: ContourTemplate }) {
  const preview = useMemo(() => {
    const state = template.create()
    // Fit the geometry alone. Labels stay available in the editable template,
    // but would overwhelm the small preview.
    state.vertices = state.vertices.map((vertex) => ({
      ...vertex,
      label: { ...vertex.label!, visible: false },
    }))
    state.segments = state.segments.map((segment) => ({ ...segment, label: undefined }))
    state.formulas = []
    state.markers = state.markers.map((object) => ({
      ...object,
      label: { ...object.label, visible: false },
    }))
    state.viewport = fitScene(state, { width: 480, height: 336 }) ?? state.viewport
    return { state, geometry: buildContourGeometry(state) }
  }, [template])
  return (
    <svg className="template-thumbnail" viewBox="160 132 480 336" aria-hidden="true">
      <path d={preview.geometry.path} fill="#66777c" fillOpacity="0.18" fillRule="nonzero" />
      {preview.geometry.segments.map(({ segment, path, arrow }) => (
        <g key={segment.id}>
          <path
            d={path}
            fill="none"
            stroke="currentColor"
            strokeWidth="5.5"
            strokeLinejoin="round"
          />
          {arrow && (
            <path
              d="M -12 -8 L 10 0 L -12 8 Z"
              fill="currentColor"
              transform={`translate(${arrow.point.x} ${arrow.point.y}) rotate(${(Math.atan2(arrow.tangent.y, arrow.tangent.x) * 180) / Math.PI})`}
            />
          )}
        </g>
      ))}
      {preview.state.markers.map((object) => {
        const p = toSvg(object, preview.state.viewport)
        return <circle key={object.id} cx={p.x} cy={p.y} r="7" fill="currentColor" />
      })}
    </svg>
  )
}

export function TemplatePanel({
  open,
  onClose,
  disabled,
  onLoad,
}: {
  open: boolean
  onClose: () => void
  disabled: boolean
  onLoad: (template: ContourTemplate) => void
}) {
  return (
    <LeftPanel
      id="template-panel"
      title="示例模板"
      className="template-panel"
      open={open}
      onClose={onClose}
    >
      {open && (
        <>
          <p className="template-intro">选择围道生成可编辑图形</p>
          <div className="template-grid">
            {contourTemplates.map((template) => (
              <button
                key={template.id}
                className="template-card"
                aria-label={`载入${template.name}`}
                title={template.description}
                {...transientLock(disabled)}
                onClick={() => onLoad(template)}
              >
                <TemplateThumbnail template={template} />
                <span>{template.name}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </LeftPanel>
  )
}
