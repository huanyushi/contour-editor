import { useReducer } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createAvoidanceFixture } from '../../../test/avoidanceFixtures'
import { ContourCanvas } from '../ContourCanvas'
import { createHistory, historyReducer, type EditorHistory } from '../history'
import type { ContourState } from '../model'
import { defaultExportOptions, serializeSvg } from '../../project/export'

beforeEach(() =>
  vi.stubGlobal(
    'PointerEvent',
    class extends MouseEvent {
      isPrimary = true
      pointerId = 1
    },
  ),
)
afterEach(() => vi.unstubAllGlobals())

function fixture(mode: string) {
  const state = createAvoidanceFixture()
  state.markers[0].label.visible = false
  if (mode === 'offline') state.markers[0].im = 1
  if (mode === 'arc') {
    state.vertices = [
      { id: 'a', re: -3, im: 0 },
      { id: 'b', re: 3, im: 0 },
    ]
    state.segments = [
      { id: 'edge-a', kind: 'arc', startId: 'a', endId: 'b', through: { re: 0, im: 3 } },
    ]
    state.closed = false
    state.markers[0].im = 3
  }
  if (mode === 'corner') {
    state.vertices[1].mathematicalKind = 'pole'
    state.avoidances[0] = { ...state.avoidances[0], markerId: 'b', exitSegmentId: 'edge-b' }
    state.markers = []
  }
  return state
}

function editor(initial: ContourState) {
  let history: EditorHistory
  function Editor() {
    const [value, dispatch] = useReducer(historyReducer, initial, createHistory)
    history = value
    return (
      <>
        <button onClick={() => dispatch({ type: 'undo' })}>Undo</button>
        <button onClick={() => dispatch({ type: 'redo' })}>Redo</button>
        <button onClick={() => dispatch({ type: 'toggleHandles' })}>Handles</button>
        <ContourCanvas
          state={value.present}
          dispatch={dispatch}
          gestureOwner={value.gesture?.owner ?? null}
          tool="select"
          onArcPoint={() => {}}
        />
      </>
    )
  }
  const view = render(<Editor />)
  const svg = screen.getByTestId('contour-canvas')
  Object.assign(svg, {
    getScreenCTM: () => ({ a: 1, b: 0, c: 0, d: 1, inverse: () => ({}) }),
    createSVGPoint: () => ({
      x: 0,
      y: 0,
      matrixTransform() {
        return { x: this.x, y: this.y }
      },
    }),
    setPointerCapture() {},
    hasPointerCapture: () => false,
  })
  return { ...view, svg, current: () => history! }
}

function handles(container: HTMLElement) {
  return [...container.querySelectorAll<SVGGElement>('[data-avoidance-handle]')]
}

function position(node: Element) {
  const [x, y] = node
    .getAttribute('transform')!
    .match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi)!
    .map(Number)
  return { re: (x - 400) / 40, im: (300 - y) / 40 }
}

it('shows exactly two derived radius handles, hides them with handles off and omits them from export', () => {
  const { container, svg } = editor(fixture('line'))
  expect(handles(container)).toHaveLength(2)
  expect(serializeSvg(svg as unknown as SVGSVGElement, defaultExportOptions())).not.toContain(
    '两端联动',
  )
  fireEvent.click(screen.getByText('Handles'))
  expect(handles(container)).toHaveLength(0)
})

it('keeps the real pole selectable inside overlapping small-radius hit areas', () => {
  const state = fixture('line')
  state.avoidances[0].radius = 0.2
  const { container, svg, current } = editor(state)
  fireEvent.pointerDown(handles(container)[0], { button: 0, clientX: 400, clientY: 300 })
  fireEvent.pointerUp(svg)
  expect(current().present.selection).toEqual({ kind: 'marker', id: 'pole' })
  expect(current().past).toHaveLength(0)
})

it('does not expose hidden bindings and supports keyboard inspection without creating history', () => {
  const hidden = fixture('line')
  hidden.markers[0] = { ...hidden.markers[0], re: -4, im: 1.5 }
  hidden.avoidances[0].targetSegmentId = 'edge-d'
  hidden.closed = false
  const view = editor(hidden)
  expect(handles(view.container)).toHaveLength(0)
  view.unmount()
  const visible = editor(fixture('line'))
  const handle = screen.getByRole('button', { name: '调整绕行 avoid-1 的入口半径' })
  fireEvent.keyDown(handle, { key: 'Enter' })
  expect(visible.current().present.selection).toEqual({ kind: 'segment', id: 'avoid:avoid-1:arc' })
  expect(visible.current().past).toHaveLength(0)
})

it.each(['line', 'offline', 'arc', 'corner'])(
  'dragging either %s endpoint changes only the shared radius, with one undo and Esc restoring both ends',
  (mode) => {
    const initial = fixture(mode)
    const center = mode === 'corner' ? initial.vertices[1] : initial.markers[0]
    const { container, svg, current } = editor(initial)
    for (const index of [0, 1]) {
      const handle = handles(container)[index]
      expect(handle).toBeDefined()
      const p = position(handle)
      const target = {
        re: center.re + 1.5 * (p.re - center.re),
        im: center.im + 1.5 * (p.im - center.im),
      }
      // Hit offset must not change the radius or jump when a drag starts.
      fireEvent.pointerDown(handle, {
        button: 0,
        clientX: 400 + p.re * 40 + 2,
        clientY: 300 - p.im * 40 - 1,
      })
      fireEvent.pointerMove(svg, {
        clientX: 400 + target.re * 40 + 2,
        clientY: 300 - target.im * 40 - 1,
      })
      expect(current().present.avoidances[0].radius).toBeCloseTo(0.75, 10)
      if (mode === 'offline')
        expect(current().present.avoidances[0]).toMatchObject({ kind: 'corridor', gap: 0.5 })
      else expect(current().present.avoidances[0].side).toBe(initial.avoidances[0].side)
      expect(current().present.vertices).toBe(initial.vertices)
      expect(current().present.markers).toBe(initial.markers)
      for (const endpoint of handles(container).map(position)) {
        expect(Math.hypot(endpoint.re - center.re, endpoint.im - center.im)).toBeCloseTo(0.75, 9)
        if (mode === 'arc') expect(Math.hypot(endpoint.re, endpoint.im)).toBeCloseTo(3, 9)
        if (mode === 'corner')
          expect(Math.min(Math.abs(endpoint.re - 4), Math.abs(endpoint.im))).toBeCloseTo(0, 9)
      }
      // Degenerate or source-consuming radii cannot change either endpoint.
      const valid = handles(container).map(position)
      fireEvent.pointerMove(svg, { clientX: 10000, clientY: 10000 })
      expect(handles(container).map(position)).toEqual(valid)
      expect(current().past).toHaveLength(0)
      fireEvent.pointerUp(svg)
      expect(current().past).toHaveLength(1)
      fireEvent.click(screen.getByText('Undo'))
      expect(current().present.avoidances).toEqual(initial.avoidances)
      fireEvent.click(screen.getByText('Redo'))
      expect(current().present.avoidances[0].radius).toBeCloseTo(0.75, 10)
      fireEvent.click(screen.getByText('Undo'))

      const fresh = handles(container)[index]
      fireEvent.pointerDown(fresh, {
        button: 0,
        clientX: 400 + p.re * 40,
        clientY: 300 - p.im * 40,
      })
      fireEvent.pointerMove(svg, { clientX: 400 + target.re * 40, clientY: 300 - target.im * 40 })
      fireEvent.keyDown(svg, { key: 'Escape' })
      expect(current().present.avoidances).toEqual(initial.avoidances)
      expect(current().past).toHaveLength(0)
      expect(current().gesture).toBeNull()
    }
  },
)
