import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import { Plus } from 'lucide-react'
import { customPaletteStore, MAX_CUSTOM_COLORS } from './customPalette'
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
  const [pickerColor, setPickerColor] = useState('#263238')
  const [savedTarget, setSavedTarget] = useState<string>()
  const addRef = useRef<HTMLButtonElement>(null)
  const returnToAdd = useRef(false)
  const pickerRef = useRef<HTMLInputElement>(null)
  const session = useRef<{ slot?: string; pending?: string; editing: boolean }>({ editing: false })
  const savedColors = useSyncExternalStore(
    customPaletteStore.subscribe,
    customPaletteStore.getSnapshot,
  )
  const id = useId()
  const color = value?.toLowerCase()
  const customColor = color !== undefined && !colorPresets.some((preset) => preset.value === color)

  const commitChoice = useCallback((next: string) => {
    session.current.slot = customPaletteStore.remember(next, session.current.slot)
    session.current.pending = undefined
    setSavedTarget(customPaletteStore.getSnapshot().includes(next) ? next : undefined)
  }, [])

  const finishPending = useCallback(() => {
    if (session.current.pending !== undefined) commitChoice(session.current.pending)
  }, [commitChoice])

  useEffect(() => {
    if (!customOpen) {
      if (returnToAdd.current) {
        addRef.current?.focus()
        returnToAdd.current = false
      }
      return
    }
    const input = pickerRef.current
    if (!input) return
    input.focus()
    // React may suppress a change with the same value as the preceding input event.
    const commit = () => commitChoice(input.value)
    input.addEventListener('change', commit)
    return () => input.removeEventListener('change', commit)
  }, [customOpen, commitChoice])

  useEffect(() => () => finishPending(), [finishPending])

  const openPicker = (saved?: string) => {
    finishPending()
    session.current = { slot: saved, editing: saved !== undefined }
    setSavedTarget(saved)
    setPickerColor(saved ?? color ?? '#263238')
    setCustomOpen(true)
    pickerRef.current?.focus()
  }

  const selectColor = (next: string) => {
    finishPending()
    setCustomOpen(false)
    onChange(next)
  }

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
            onClick={() => selectColor(preset.value)}
          >
            <span style={{ backgroundColor: preset.value }} aria-hidden="true" />
          </button>
        ))}
      </div>
      <div
        className="color-field-presets color-field-saved"
        role="group"
        aria-label={`${name}自定义颜色`}
      >
        {savedColors.map((saved) => (
          <button
            key={saved}
            type="button"
            className="color-field-swatch"
            aria-label={`${name}：自定义 ${saved}`}
            aria-pressed={color === saved}
            title={`${saved}：选色并编辑`}
            aria-expanded={customOpen && savedTarget === saved}
            aria-controls={`${id}-custom`}
            onClick={() => {
              openPicker(saved)
              onChange(saved)
            }}
          >
            <span style={{ backgroundColor: saved }} aria-hidden="true" />
          </button>
        ))}
        {savedColors.length < MAX_CUSTOM_COLORS && (
          <button
            ref={addRef}
            type="button"
            className="color-field-swatch color-field-add"
            aria-label={`自定义${name}`}
            title="添加自定义颜色"
            aria-expanded={customOpen}
            aria-controls={`${id}-custom`}
            onClick={() => {
              if (customOpen && !session.current.editing) {
                finishPending()
                setCustomOpen(false)
              } else {
                openPicker()
              }
            }}
          >
            <Plus size={20} strokeWidth={1.75} aria-hidden="true" />
          </button>
        )}
      </div>
      {customOpen && (
        <div className="color-field-custom" id={`${id}-custom`}>
          <label htmlFor={`${id}-input`}>自定义颜色</label>
          <input
            ref={pickerRef}
            id={`${id}-input`}
            aria-label={name}
            aria-describedby={`${id}-status`}
            type="color"
            value={pickerColor}
            onClick={() => {
              finishPending()
              if (!session.current.editing) session.current.slot = undefined
            }}
            onBlur={finishPending}
            onChange={(event) => {
              const next = event.currentTarget.value
              setPickerColor(next)
              session.current.pending = next
              onChange(next)
              if (event.nativeEvent.type === 'change') commitChoice(next)
            }}
          />
          {savedTarget !== undefined && savedColors.includes(savedTarget) && (
            <button
              type="button"
              aria-label={`删除自定义${name}`}
              title="仅从色板删除，不改变图形颜色"
              onClick={() => {
                finishPending()
                customPaletteStore.remove(session.current.slot ?? pickerColor)
                session.current = { editing: false }
                setSavedTarget(undefined)
                returnToAdd.current = true
                setCustomOpen(false)
              }}
            >
              删除
            </button>
          )}
        </div>
      )}
    </div>
  )
}
