import { useId, useState } from 'react'
import type { AvoidanceGeometry } from '../../lib/avoidanceGeometry'
import type { AvoidancePatch } from './avoidanceModel'
import type { Avoidance } from './avoidanceTypes'
import type { AvoidanceConstruction } from './avoidanceConstruction'

export interface AvoidanceFieldsProps {
  value: Avoidance
  geometry: AvoidanceGeometry | null
  mode?: AvoidanceConstruction['mode']
  error: string
  onChange: (patch: AvoidancePatch) => void
}

const number = (value: number) => Number(value.toFixed(6)).toString()
const decimal = /^[+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i

export function AvoidanceFields({
  value,
  geometry,
  mode = 'line',
  error,
  onChange,
}: AvoidanceFieldsProps) {
  const width = 2 * value.radius * value.openingRatio
  const [committed, setCommitted] = useState({ id: value.id, radius: value.radius, width })
  const [radiusText, setRadiusText] = useState(number(value.radius))
  const [widthText, setWidthText] = useState(number(width))
  const [dirty, setDirty] = useState({ radius: false, width: false })
  const [invalid, setInvalid] = useState({ radius: false, width: false })
  const helpId = useId()
  const errorId = useId()
  if (committed.id !== value.id || committed.radius !== value.radius || committed.width !== width) {
    setCommitted({ id: value.id, radius: value.radius, width })
    setWidthText(number(width))
    if (committed.id !== value.id || committed.radius !== value.radius) {
      setRadiusText(number(value.radius))
      setDirty({ radius: false, width: false })
      setInvalid({ radius: false, width: false })
    } else {
      setDirty({ ...dirty, width: false })
      setInvalid({ ...invalid, width: false })
    }
  }
  const commit = (field: 'radius' | 'width') => {
    // Never round an untouched source parameter back into the document.
    if (!dirty[field]) return
    const text = (field === 'radius' ? radiusText : widthText).trim()
    const parsed = Number(text)
    if (
      !decimal.test(text) ||
      !Number.isFinite(parsed) ||
      parsed <= 0 ||
      (field === 'width' && parsed > 2 * value.radius)
    ) {
      setInvalid({ ...invalid, [field]: true })
      return
    }
    setInvalid({ ...invalid, [field]: false })
    setDirty({ ...dirty, [field]: false })
    // Fall back to the accepted value if the parent rejects this proposal. An
    // accepted patch updates value and the prop synchronization above shows it.
    if (field === 'radius') setRadiusText(number(value.radius))
    else setWidthText(number(width))
    onChange(
      field === 'radius' ? { radius: parsed } : { openingRatio: parsed / (2 * value.radius) },
    )
  }
  return (
    <fieldset className="property-group">
      <legend>绕行参数</legend>
      <label className="field-row">
        半径
        <input
          aria-label="绕行半径"
          inputMode="decimal"
          value={radiusText}
          aria-invalid={invalid.radius}
          aria-describedby={`${helpId} ${errorId}`}
          onChange={(event) => {
            setRadiusText(event.target.value)
            setDirty({ ...dirty, radius: true })
          }}
          onBlur={() => commit('radius')}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
              event.preventDefault()
              commit('radius')
            }
          }}
        />
      </label>
      <p id={helpId} className="muted small">
        按 Enter 或移开焦点应用数值；半径须大于 0。
      </p>
      {mode !== 'line' || geometry?.onLine ? (
        <label className="field-row avoidance-select-field">
          绕行侧
          <select
            aria-label="绕行侧"
            value={value.side}
            onChange={(event) => {
              const side = event.target.value
              if (side === 'left' || side === 'right') onChange({ side })
            }}
          >
            <option value="left">沿路径方向左侧</option>
            <option value="right">沿路径方向右侧</option>
          </select>
        </label>
      ) : (
        geometry && (
          <>
            <p className="muted small">开口朝向原路径，离线侧向固定。</p>
            <label className="field-row">
              偏好开口宽度
              <input
                aria-label="偏好开口宽度"
                inputMode="decimal"
                value={widthText}
                aria-invalid={invalid.width}
                aria-describedby={errorId}
                onChange={(event) => {
                  setWidthText(event.target.value)
                  setDirty({ ...dirty, width: true })
                }}
                onBlur={() => commit('width')}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                    event.preventDefault()
                    commit('width')
                  }
                }}
              />
            </label>
            <p className="muted small">
              大于 0，不超过直径 {number(2 * value.radius)}；随半径等比变化。
            </p>
            {geometry.actualOpeningWidth > geometry.preferredOpeningWidth && (
              <p className="muted small">实际开口已按连接约束自动展开，保留偏好值。</p>
            )}
          </>
        )
      )}
      {geometry && (
        <p className="field-row">
          实际开口宽度{' '}
          <output aria-label="实际开口宽度">{number(geometry.actualOpeningWidth)}</output>
        </p>
      )}
      <div id={errorId}>
        {(invalid.radius || invalid.width || error) && (
          <p className="error" role="alert">
            {invalid.radius
              ? '半径请输入有限正数。'
              : invalid.width
                ? '偏好开口宽度须大于 0 且不超过直径。'
                : error}
          </p>
        )}
      </div>
    </fieldset>
  )
}
