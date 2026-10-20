import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { RangeField } from './StyleInputs'

function RangeEditor({ initial = 0, wheelStep }: { initial?: number; wheelStep?: number }) {
  const [value, setValue] = useState(initial)
  const [edits, setEdits] = useState(0)
  const [bubbled, setBubbled] = useState(0)
  return (
    <div onWheel={() => setBubbled((count) => count + 1)}>
      <RangeField
        label="偏移"
        name="标签偏移"
        value={value}
        min={-200}
        max={200}
        step={1}
        wheelStep={wheelStep}
        onChange={(next) => {
          setValue(next)
          setEdits((count) => count + 1)
        }}
      />
      <output aria-label="应用次数">{edits}</output>
      <output aria-label="冒泡次数">{bubbled}</output>
    </div>
  )
}

function wheel(options: WheelEventInit) {
  const event = new WheelEvent('wheel', {
    bubbles: true,
    cancelable: true,
    ...options,
    deltaY: Number.isFinite(options.deltaY) ? options.deltaY : 0,
  })
  // WebIDL rejects nonfinite constructor arguments; exercise the defensive guard directly.
  if (options.deltaY !== undefined && !Number.isFinite(options.deltaY))
    Object.defineProperty(event, 'deltaY', { value: options.deltaY })
  fireEvent(screen.getByRole('slider', { name: '标签偏移' }), event)
  return event
}

describe('RangeField opt-in wheel editing', () => {
  it('applies one step per event regardless of wheel magnitude or delta mode and consumes it', () => {
    render(<RangeEditor wheelStep={1} />)
    expect(wheel({ deltaY: -120 }).defaultPrevented).toBe(true)
    expect(screen.getByRole('slider')).toHaveValue('1')
    expect(wheel({ deltaY: -0.1, deltaMode: 1 }).defaultPrevented).toBe(true)
    expect(screen.getByRole('slider')).toHaveValue('2')
    expect(wheel({ deltaY: 900, deltaMode: 2 }).defaultPrevented).toBe(true)
    expect(screen.getByRole('slider')).toHaveValue('1')
    expect(screen.getByLabelText('应用次数')).toHaveTextContent('3')
    expect(screen.getByLabelText('冒泡次数')).toHaveTextContent('0')
  })

  it.each([
    { initial: 199, deltaY: -120, bound: '200' },
    { initial: -199, deltaY: 120, bound: '-200' },
  ])('clamps at $bound without applying duplicate boundary edits', ({ initial, deltaY, bound }) => {
    render(<RangeEditor initial={initial} wheelStep={3} />)
    wheel({ deltaY })
    expect(screen.getByRole('slider')).toHaveValue(bound)
    expect(wheel({ deltaY }).defaultPrevented).toBe(true)
    expect(screen.getByRole('slider')).toHaveValue(bound)
    expect(screen.getByLabelText('应用次数')).toHaveTextContent('1')
    expect(screen.getByLabelText('冒泡次数')).toHaveTextContent('0')
  })

  it.each([
    { deltaY: 120, ctrlKey: true },
    { deltaY: 120, metaKey: true },
    { deltaY: 120, altKey: true },
    { deltaY: 0, deltaX: 120 },
    { deltaY: Number.NaN },
    { deltaY: Number.POSITIVE_INFINITY },
    { deltaY: Number.NEGATIVE_INFINITY },
  ])('leaves modified, zero or nonfinite wheel events alone: %j', (options) => {
    render(<RangeEditor wheelStep={1} />)
    expect(wheel(options).defaultPrevented).toBe(false)
    expect(screen.getByRole('slider')).toHaveValue('0')
    expect(screen.getByLabelText('应用次数')).toHaveTextContent('0')
    expect(screen.getByLabelText('冒泡次数')).toHaveTextContent('1')
  })

  it('keeps ordinary ranges scrollable and removes the listener when wheel editing is disabled', () => {
    const { rerender } = render(<RangeEditor />)
    expect(wheel({ deltaY: -120 }).defaultPrevented).toBe(false)
    expect(screen.getByRole('slider')).toHaveValue('0')
    rerender(<RangeEditor wheelStep={1} />)
    wheel({ deltaY: -120 })
    expect(screen.getByRole('slider')).toHaveValue('1')
    rerender(<RangeEditor />)
    expect(wheel({ deltaY: -120 }).defaultPrevented).toBe(false)
    expect(screen.getByRole('slider')).toHaveValue('1')
    expect(screen.getByLabelText('应用次数')).toHaveTextContent('1')
    expect(screen.getByLabelText('冒泡次数')).toHaveTextContent('2')
  })
})
