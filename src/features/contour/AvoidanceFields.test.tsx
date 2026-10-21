import { fireEvent, render, screen } from '@testing-library/react'
import { useReducer, useState } from 'react'
import { describe, expect, it } from 'vitest'
import { buildAvoidance } from '../../lib/avoidanceGeometry'
import type { Avoidance } from './avoidanceTypes'
import { AvoidanceFields } from './AvoidanceFields'
import { createAvoidanceFixture } from '../../test/avoidanceFixtures'
import { createHistory, historyReducer } from './history'
import { findPoint, findSegment } from './sceneObjects'
import { constructAvoidance } from './avoidanceConstruction'

function Fields({ im = 0.1, radius = 1 }: { im?: number; radius?: number }) {
  const [value, setValue] = useState<Avoidance>({
    id: 'avoid-1',
    markerId: 'pole',
    targetSegmentId: 'edge-a',
    radius,
    side: 'left',
    openingRatio: 0.5,
  })
  const result = buildAvoidance({
    start: { re: -4, im: 0 },
    end: { re: 4, im: 0 },
    center: { re: 0, im },
    ...value,
  })
  return (
    <>
      <AvoidanceFields
        value={value}
        geometry={result.ok ? result.geometry : null}
        error={result.ok ? '' : result.error}
        onChange={(patch) => setValue({ ...value, ...patch })}
      />
      <output aria-label="已应用参数">{JSON.stringify(value)}</output>
    </>
  )
}

function AcceptedFields() {
  const [history, dispatch] = useReducer(historyReducer, undefined, () =>
    createHistory(createAvoidanceFixture()),
  )
  const state = history.present
  const value = state.avoidances[0]
  const source = findSegment(state, value.targetSegmentId)!
  const result = buildAvoidance({
    start: findPoint(state, source.startId)!,
    end: findPoint(state, source.endId)!,
    center: findPoint(state, value.markerId)!,
    ...value,
  })
  return (
    <>
      <AvoidanceFields
        value={value}
        geometry={result.ok ? result.geometry : null}
        error={state.error}
        onChange={(patch) => dispatch({ type: 'updateAvoidance', id: value.id, patch })}
      />
      <output aria-label="已应用参数">{JSON.stringify(value)}</output>
      <output aria-label="历史步数">{history.past.length}</output>
      <button onClick={() => dispatch({ type: 'undo' })}>撤销参数</button>
    </>
  )
}

function CurveFields({ mode }: { mode: 'arc' | 'corner' }) {
  const [state, setState] = useState(() => {
    const source = createAvoidanceFixture()
    source.avoidances[0].radius = 8
    if (mode === 'corner') {
      source.markers = []
      source.vertices[1].mathematicalKind = 'pole'
      source.avoidances[0] = { ...source.avoidances[0], markerId: 'b', exitSegmentId: 'edge-b' }
    } else {
      source.segments[0] = { ...source.segments[0], kind: 'arc', through: { re: 0, im: 4 } }
      source.markers[0].im = 4
    }
    return source
  })
  const value = state.avoidances[0]
  const result = constructAvoidance(state, value)
  return (
    <AvoidanceFields
      mode={mode}
      value={value}
      geometry={result.ok ? result.value.geometry : null}
      error={result.ok ? '' : result.error}
      onChange={(patch) => setState({ ...state, avoidances: [{ ...value, ...patch }] })}
    />
  )
}

describe('avoidance parameter fields', () => {
  it.each(['arc', 'corner'] as const)(
    'keeps %s side editable through a constructor error and radius repair without neck preferences',
    (mode) => {
      render(<CurveFields mode={mode} />)
      expect(screen.getByRole('alert')).toHaveTextContent(/edge-a/)
      const side = screen.getByLabelText('绕行侧')
      fireEvent.change(side, { target: { value: 'right' } })
      expect(side).toHaveValue('right')
      expect(screen.queryByLabelText('偏好开口宽度')).not.toBeInTheDocument()
      const radius = screen.getByLabelText('绕行半径')
      fireEvent.change(radius, { target: { value: '0.5' } })
      fireEvent.keyDown(radius, { key: 'Enter' })
      fireEvent.blur(radius)
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(radius).toHaveValue('0.5')
      expect(side).toHaveValue('right')
      expect(Number(screen.getByLabelText('实际开口宽度').textContent)).toBeGreaterThan(0)
    },
  )

  it('separates the preferred width from the widened actual opening off line', () => {
    render(<Fields />)
    expect(screen.getByLabelText('偏好开口宽度')).toHaveValue('1')
    expect(screen.getByLabelText('实际开口宽度')).toHaveTextContent('1.989975')
    expect(screen.queryByLabelText('绕行侧')).not.toBeInTheDocument()
    expect(screen.getByText(/自动展开/)).toBeInTheDocument()
  })

  it('commits a complete numeric draft once and keeps invalid text out of applied parameters', () => {
    render(<Fields im={2} />)
    const radius = screen.getByLabelText('绕行半径')
    for (const text of ['', '-', '-1', 'Infinity', '1e']) {
      fireEvent.change(radius, { target: { value: text } })
      fireEvent.blur(radius)
      expect(screen.getByLabelText('已应用参数')).toHaveTextContent('"radius":1,')
      expect(radius).toHaveAttribute('aria-invalid', 'true')
    }
    fireEvent.change(radius, { target: { value: '1.25' } })
    fireEvent.keyDown(radius, { key: 'Enter' })
    expect(screen.getByLabelText('已应用参数')).toHaveTextContent('"radius":1.25,')
    expect(screen.getByLabelText('偏好开口宽度')).toHaveValue('1.25')
    const width = screen.getByLabelText('偏好开口宽度')
    fireEvent.change(width, { target: { value: '3' } })
    fireEvent.blur(width)
    expect(width).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText('已应用参数')).toHaveTextContent('"openingRatio":0.5')
    fireEvent.change(width, { target: { value: '2' } })
    fireEvent.blur(width)
    expect(screen.getByLabelText('已应用参数')).toHaveTextContent('"openingRatio":0.8')
  })

  it('offers path-relative sides only on line and preserves unedited source precision', () => {
    render(<Fields im={0} radius={1.123456789} />)
    expect(screen.queryByLabelText('偏好开口宽度')).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: '沿路径方向左侧' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('绕行侧'), { target: { value: 'right' } })
    fireEvent.blur(screen.getByLabelText('绕行半径'))
    expect(screen.getByLabelText('已应用参数')).toHaveTextContent('"radius":1.123456789')
    expect(screen.getByLabelText('已应用参数')).toHaveTextContent('"side":"right"')
  })

  it('keeps a radius error when another field is corrected', () => {
    render(<Fields im={2} />)
    const radius = screen.getByLabelText('绕行半径')
    const width = screen.getByLabelText('偏好开口宽度')
    fireEvent.change(radius, { target: { value: '-' } })
    fireEvent.blur(radius)
    fireEvent.change(width, { target: { value: '-' } })
    fireEvent.blur(width)
    fireEvent.change(width, { target: { value: '1.5' } })
    fireEvent.blur(width)
    expect(radius).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('alert')).toHaveTextContent(/半径/)
    expect(screen.getByLabelText('已应用参数')).toHaveTextContent('"radius":1,')
  })

  it.each(['Enter', 'blur'])(
    'restores accepted text after a rejected %s commit, even when a later side edit clears the error',
    (commit) => {
      render(<AcceptedFields />)
      const radius = screen.getByLabelText('绕行半径')
      fireEvent.change(radius, { target: { value: '4' } })
      if (commit === 'Enter') fireEvent.keyDown(radius, { key: 'Enter' })
      else fireEvent.blur(radius)
      expect(screen.getByRole('alert')).toHaveTextContent(/半径|端点/)
      expect(screen.getByLabelText('已应用参数')).toHaveTextContent('"radius":0.5,')
      expect(screen.getByLabelText('历史步数')).toHaveTextContent(/^0$/)
      expect(radius).toHaveValue('0.5')

      fireEvent.change(screen.getByLabelText('绕行侧'), { target: { value: 'right' } })
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(radius).toHaveValue('0.5')
      expect(radius).toHaveAttribute('aria-invalid', 'false')
      fireEvent.keyDown(radius, { key: 'Enter' })
      expect(screen.getByLabelText('历史步数')).toHaveTextContent(/^1$/)

      fireEvent.change(radius, { target: { value: '0.625' } })
      fireEvent.keyDown(radius, { key: 'Enter' })
      fireEvent.blur(radius)
      expect(radius).toHaveValue('0.625')
      expect(screen.getByLabelText('已应用参数')).toHaveTextContent('"radius":0.625,')
      expect(screen.getByLabelText('历史步数')).toHaveTextContent(/^2$/)
      fireEvent.click(screen.getByRole('button', { name: '撤销参数' }))
      expect(radius).toHaveValue('0.5')
      expect(screen.getByLabelText('已应用参数')).toHaveTextContent('"side":"right"')
      expect(screen.getByLabelText('历史步数')).toHaveTextContent(/^1$/)
    },
  )
})
