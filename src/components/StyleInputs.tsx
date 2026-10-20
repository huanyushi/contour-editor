import { useEffect, useId, useRef, useState } from 'react'
import './ColorField.css'

interface RangeFieldProps {
  label: string
  name?: string
  value: number
  min: number
  max: number
  step?: number
  wheelStep?: number
  valueLabel?: string
  onChange: (value: number) => void
}

export function RangeField({
  label,
  name = label,
  value,
  min,
  max,
  step,
  wheelStep,
  valueLabel = `${value} px`,
  onChange,
}: RangeFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const input = inputRef.current
    if (!input || wheelStep === undefined || !Number.isFinite(wheelStep) || wheelStep <= 0) return
    const onWheel = (event: WheelEvent) => {
      if (
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        !Number.isFinite(event.deltaY) ||
        event.deltaY === 0
      )
        return
      event.preventDefault()
      event.stopPropagation()
      const next = Math.min(max, Math.max(min, value - Math.sign(event.deltaY) * wheelStep))
      if (next !== value) onChange(next)
    }
    input.addEventListener('wheel', onWheel, { passive: false })
    return () => input.removeEventListener('wheel', onWheel)
  }, [min, max, value, wheelStep, onChange])

  return (
    <label className="range-field">
      {label}{' '}
      <span className="range-value" aria-hidden="true">
        {valueLabel}
      </span>
      <input
        ref={inputRef}
        aria-label={name}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
    </label>
  )
}

const colorPresets = [
  { name: '深色', value: '#263238' },
  { name: '红色', value: '#cc3344' },
  { name: '橙色', value: '#d97706' },
  { name: '金色', value: '#ca8a04' },
  { name: '青绿色', value: '#237b6d' },
  { name: '蓝色', value: '#2563eb' },
  { name: '紫色', value: '#7c3aed' },
  { name: '灰色', value: '#66777c' },
]

export function ColorField({
  label,
  name = label,
  value,
  onChange,
}: {
  label: string
  name?: string
  value: string | undefined
  onChange: (value: string) => void
}) {
  const [customOpen, setCustomOpen] = useState(false)
  const id = useId()
  const color = value?.toLowerCase()
  const customColor = color !== undefined && !colorPresets.some((preset) => preset.value === color)

  return (
    <div className="color-field">
      <div className="color-field-heading">
        <span>{label}</span>
        <span className="color-field-status" id={`${id}-status`} aria-live="polite">
          {color === undefined ? (
            '颜色不一'
          ) : customColor ? (
            <>
              <span
                className="color-field-preview"
                style={{ backgroundColor: color }}
                aria-hidden="true"
              />
              自定义 {color}
            </>
          ) : null}
        </span>
      </div>
      <div
        className="color-field-presets"
        role="group"
        aria-label={`${name}预设颜色`}
        aria-describedby={`${id}-status`}
      >
        {colorPresets.map((preset) => (
          <button
            key={preset.value}
            type="button"
            className="color-field-swatch"
            aria-label={`${name}：${preset.name}`}
            aria-pressed={color === preset.value}
            title={preset.name}
            onClick={() => onChange(preset.value)}
          >
            <span style={{ backgroundColor: preset.value }} aria-hidden="true" />
          </button>
        ))}
      </div>
      <button
        type="button"
        className="color-field-more"
        aria-label={`自定义${name}`}
        aria-expanded={customOpen}
        aria-controls={`${id}-custom`}
        onClick={() => setCustomOpen((open) => !open)}
      >
        更多…
      </button>
      {customOpen && (
        <div className="color-field-custom" id={`${id}-custom`}>
          <label htmlFor={`${id}-input`}>自定义颜色</label>
          <input
            id={`${id}-input`}
            aria-label={name}
            aria-describedby={`${id}-status`}
            type="color"
            value={color ?? '#263238'}
            onChange={(event) => onChange(event.currentTarget.value)}
          />
        </div>
      )}
    </div>
  )
}
