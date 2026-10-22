import { useId, useState } from 'react'

const decimal = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i
const format = (value: number) => Number(value.toPrecision(12)).toString()

/** A numeric draft never writes rounded, untouched props back into the document. */
export function AvoidanceNumberField({
  label,
  value,
  onCommit,
  signed = false,
}: {
  label: string
  value: number
  onCommit: (value: number) => void
  signed?: boolean
}) {
  const [accepted, setAccepted] = useState(value)
  const [text, setText] = useState(format(value))
  const [dirty, setDirty] = useState(false)
  const [invalid, setInvalid] = useState(false)
  const errorId = useId()
  if (accepted !== value) {
    setAccepted(value)
    setText(format(value))
    setDirty(false)
    setInvalid(false)
  }
  const commit = () => {
    if (!dirty) return
    const parsed = Number(text.trim())
    if (!decimal.test(text.trim()) || !Number.isFinite(parsed) || (!signed && parsed <= 0)) {
      setInvalid(true)
      return
    }
    setInvalid(false)
    setDirty(false)
    setText(format(value))
    onCommit(parsed)
  }
  return (
    <>
      <label className="field-row">
        {label}
        <input
          aria-label={label}
          inputMode="decimal"
          value={text}
          aria-invalid={invalid}
          aria-describedby={invalid ? errorId : undefined}
          onChange={(event) => {
            setText(event.target.value)
            setDirty(true)
          }}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
              event.preventDefault()
              commit()
            }
          }}
        />
      </label>
      {invalid && (
        <p id={errorId} className="error" role="alert">
          {signed ? '请输入有限角度。' : '请输入有限正数。'}
        </p>
      )}
    </>
  )
}
