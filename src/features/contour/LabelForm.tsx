import { useState } from 'react'
import { MathText } from '../../components/MathText'
import { ColorField, RangeField } from '../../components/StyleInputs'
import { renderMath } from '../../lib/math'
import type { LabelSettings } from './appearance'

const LABEL_OFFSET_SLIDER_LIMIT = 100

export function LabelForm({
  value,
  onApply,
  formula = false,
}: {
  value: LabelSettings
  onApply: (label: LabelSettings) => void
  formula?: boolean
}) {
  const [tex, setTex] = useState(value.tex)
  const [committedTex, setCommittedTex] = useState(value.tex)
  const [error, setError] = useState('')
  if (committedTex !== value.tex) {
    setCommittedTex(value.tex)
    setTex(value.tex)
  }
  const draft = { ...value, tex }
  const change = (patch: Partial<LabelSettings>) => {
    if (patch.tex !== undefined) setTex(patch.tex)
    else if (
      !(Object.keys(patch) as (keyof LabelSettings)[]).every((key) => patch[key] === value[key])
    )
      onApply({ ...value, ...patch })
  }
  return (
    <form
      className="property-group"
      onSubmit={(event) => {
        event.preventDefault()
        const result = renderMath(draft.tex)
        if (result.error) {
          setError(result.error)
          return
        }
        setError('')
        onApply(draft)
      }}
    >
      <h3>{formula ? '公式内容' : '数学标签'}</h3>
      <label className="stack-field">
        {formula ? 'LaTeX 公式' : 'LaTeX 标签'}
        <textarea
          aria-label={formula ? 'LaTeX 公式' : 'LaTeX 标签'}
          rows={2}
          maxLength={2000}
          spellCheck={false}
          value={draft.tex}
          onChange={(e) => change({ tex: e.target.value })}
          aria-invalid={!!error}
        />
      </label>
      <p className="muted small">输入 LaTeX，无需 $。</p>
      <div className="formula-preview" aria-label="公式预览">
        <MathText tex={draft.tex} size={value.size} color={value.color} />
      </div>
      <RangeField
        label="字号"
        name="标签字号"
        value={draft.size}
        min={10}
        max={40}
        onChange={(size) => change({ size })}
      />
      <ColorField label="标签颜色" value={draft.color} onChange={(color) => change({ color })} />
      {!formula && (
        <>
          <RangeField
            label="水平偏移"
            name="标签水平偏移"
            value={draft.dx}
            min={Math.min(-LABEL_OFFSET_SLIDER_LIMIT, draft.dx)}
            max={Math.max(LABEL_OFFSET_SLIDER_LIMIT, draft.dx)}
            step={1}
            wheelStep={1}
            onChange={(dx) => change({ dx })}
          />
          <RangeField
            label="垂直偏移"
            name="标签垂直偏移"
            value={draft.dy}
            min={Math.min(-LABEL_OFFSET_SLIDER_LIMIT, draft.dy)}
            max={Math.max(LABEL_OFFSET_SLIDER_LIMIT, draft.dy)}
            step={1}
            wheelStep={1}
            onChange={(dy) => change({ dy })}
          />
          <label className="check-row">
            <input
              type="checkbox"
              checked={draft.visible}
              onChange={(e) => change({ visible: e.target.checked })}
            />
            显示标签
          </label>
          <button
            type="button"
            className="full-width secondary"
            onClick={() => change({ dx: 12, dy: -24 })}
          >
            重置标签位置
          </button>
        </>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button className="primary full-width" type="submit">
        {formula ? '应用公式' : '应用标签'}
      </button>
    </form>
  )
}
