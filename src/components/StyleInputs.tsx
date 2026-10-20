interface RangeFieldProps {
  label: string
  name?: string
  value: number
  min: number
  max: number
  step?: number
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
  valueLabel = `${value} px`,
  onChange,
}: RangeFieldProps) {
  return (
    <label className="range-field">
      {label}{' '}
      <span className="range-value" aria-hidden="true">
        {valueLabel}
      </span>
      <input
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

export function ColorField({
  label,
  name = label,
  value,
  onChange,
}: {
  label: string
  name?: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <label className="field-row">
      {label}
      <input
        aria-label={name}
        type="color"
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    </label>
  )
}
