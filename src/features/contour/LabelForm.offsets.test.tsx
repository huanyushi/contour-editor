import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { defaultLabel } from './appearance'
import { LabelForm } from './LabelForm'

function LabelEditor({ dx = 12, dy = -24 }: { dx?: number; dy?: number }) {
  const [label, setLabel] = useState({ ...defaultLabel('z'), dx, dy })
  const [edits, setEdits] = useState(0)
  return (
    <>
      <LabelForm
        value={label}
        onApply={(next) => {
          setLabel(next)
          setEdits((count) => count + 1)
        }}
      />
      <output aria-label="已应用偏移">{`${label.dx},${label.dy}`}</output>
      <output aria-label="应用次数">{edits}</output>
    </>
  )
}

describe('label offset slider bounds', () => {
  it('offers finite one-pixel ranges and applies wheel edits immediately only to offsets', () => {
    render(<LabelEditor />)
    const dx = screen.getByRole('slider', { name: '标签水平偏移' })
    const dy = screen.getByRole('slider', { name: '标签垂直偏移' })
    for (const slider of [dx, dy]) {
      expect(slider).toHaveAttribute('min', '-100')
      expect(slider).toHaveAttribute('max', '100')
      expect(slider).toHaveAttribute('step', '1')
    }
    fireEvent.wheel(dx, { deltaY: -120 })
    fireEvent.wheel(dy, { deltaY: 120 })
    expect(screen.getByLabelText('已应用偏移')).toHaveTextContent('13,-25')
    expect(screen.getByLabelText('应用次数')).toHaveTextContent('2')
    fireEvent.wheel(screen.getByRole('slider', { name: '标签字号' }), { deltaY: -120 })
    expect(screen.getByRole('slider', { name: '标签字号' })).toHaveValue('16')
    expect(screen.getByLabelText('应用次数')).toHaveTextContent('2')
  })

  it.each([
    { dx: 1500, dy: -2000, dxMin: '-100', dxMax: '1500', dyMin: '-2000', dyMax: '100' },
    { dx: -2000, dy: 1500, dxMin: '-2000', dxMax: '100', dyMin: '-100', dyMax: '1500' },
  ])('preserves restored offsets $dx,$dy and extends only their respective sides', (offsets) => {
    render(<LabelEditor dx={offsets.dx} dy={offsets.dy} />)
    const dx = screen.getByRole('slider', { name: '标签水平偏移' })
    const dy = screen.getByRole('slider', { name: '标签垂直偏移' })
    expect(dx).toHaveAttribute('min', offsets.dxMin)
    expect(dx).toHaveAttribute('max', offsets.dxMax)
    expect(dy).toHaveAttribute('min', offsets.dyMin)
    expect(dy).toHaveAttribute('max', offsets.dyMax)
    expect(dx).toHaveValue(String(offsets.dx))
    expect(dy).toHaveValue(String(offsets.dy))
    expect(screen.getByText(`${offsets.dx} px`)).toBeVisible()
    expect(screen.getByText(`${offsets.dy} px`)).toBeVisible()
    expect(screen.getByLabelText('应用次数')).toHaveTextContent('0')

    fireEvent.wheel(dx, { deltaY: -Math.sign(offsets.dx) * 120 })
    fireEvent.wheel(dy, { deltaY: -Math.sign(offsets.dy) * 120 })
    expect(screen.getByLabelText('应用次数')).toHaveTextContent('0')
    fireEvent.wheel(dx, { deltaY: Math.sign(offsets.dx) * 120 })
    fireEvent.wheel(dy, { deltaY: Math.sign(offsets.dy) * 120 })
    expect(screen.getByLabelText('已应用偏移')).toHaveTextContent(
      offsets.dx > 0 ? '1499,-1999' : '-1999,1499',
    )
    fireEvent.change(dx, { target: { value: '100' } })
    fireEvent.change(dy, { target: { value: '-100' } })
    expect(screen.getByLabelText('已应用偏移')).toHaveTextContent('100,-100')
    for (const slider of [dx, dy]) {
      expect(slider).toHaveAttribute('min', '-100')
      expect(slider).toHaveAttribute('max', '100')
    }
  })
})
