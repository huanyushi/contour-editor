import { useState } from 'react'
import type { AxesSettings } from '../../lib/viewport'
import { renderMath } from '../../lib/math'

type AxisLabels = Pick<AxesSettings, 'reLabel' | 'imLabel'>

export function AxesLabelForm({
  value,
  onApply,
}: {
  value: AxisLabels
  onApply: (labels: AxisLabels) => void
}) {
  const [draft, setDraft] = useState(value)
  const [committed, setCommitted] = useState(value)
  const [error, setError] = useState('')
  if (committed.reLabel !== value.reLabel || committed.imLabel !== value.imLabel) {
    setCommitted(value)
    setDraft(value)
    setError('')
  }
  return (
    <form
      className="property-group"
      onSubmit={(event) => {
        event.preventDefault()
        for (const tex of [draft.reLabel, draft.imLabel]) {
          const result = renderMath(tex)
          if (result.error) {
            setError(result.error)
            return
          }
        }
        setError('')
        onApply({ reLabel: draft.reLabel, imLabel: draft.imLabel })
      }}
    >
      <h3>坐标轴标签</h3>
      <div className="coordinate-fields">
        <label>
          实轴标签
          <input
            aria-label="实轴标签"
            value={draft.reLabel}
            maxLength={2000}
            spellCheck={false}
            onChange={(event) => setDraft({ ...draft, reLabel: event.target.value })}
          />
        </label>
        <label>
          虚轴标签
          <input
            aria-label="虚轴标签"
            value={draft.imLabel}
            maxLength={2000}
            spellCheck={false}
            onChange={(event) => setDraft({ ...draft, imLabel: event.target.value })}
          />
        </label>
      </div>
      <p className="muted small">支持 LaTeX，无需 $；留空可隐藏对应标签。</p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="primary full-width">
        应用轴标签
      </button>
    </form>
  )
}
