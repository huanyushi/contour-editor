import { fireEvent, render, screen } from '@testing-library/react'
import { useReducer } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createConnectedFixture } from '../../test/connectedAvoidanceFixtures'
import { ContourCanvas } from './ContourCanvas'
import { createHistory, historyReducer, type EditorHistory } from './history'
import { buildContourGeometry } from './pathGeometry'

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

it('dragging either child arc controls one shared radius and Escape restores the whole gesture', () => {
  const initial = createConnectedFixture({ clearanceRadius: 0.1 })
  initial.viewport = { ...initial.viewport, scaleX: 200, scaleY: 200 }
  let current: EditorHistory
  function Editor() {
    const [history, dispatch] = useReducer(historyReducer, initial, createHistory)
    current = history
    return (
      <ContourCanvas
        state={history.present}
        dispatch={dispatch}
        gestureOwner={history.gesture?.owner ?? null}
        tool="select"
        onArcPoint={() => {}}
      />
    )
  }
  const { container } = render(<Editor />)
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
  const handles = () => [
    ...container.querySelectorAll('[data-testid^="avoidance-radius-clearance-"]'),
  ]
  expect(handles()).toHaveLength(4)
  for (const index of [0, 3]) {
    const handle = handles()[index]
    const [x, y] = handle
      .getAttribute('transform')!
      .match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi)!
      .map(Number)
    fireEvent.pointerDown(handle, { button: 0, clientX: x, clientY: y })
    fireEvent.pointerMove(svg, { clientX: 500 + 1.5 * (x - 500), clientY: 300 + 1.5 * (y - 300) })
    expect(current!.present.avoidances[1].radius).toBeCloseTo(0.15, 10)
    expect(current!.past).toHaveLength(0)
    const arcs = buildContourGeometry(current!.present).segments.filter((s) =>
      s.segment.id.startsWith('avoid:clearance:'),
    )
    expect(arcs).toHaveLength(2)
    for (const arc of arcs) expect(arc.arc!.radius).toBeCloseTo(0.15, 10)
    fireEvent.keyDown(svg, { key: 'Escape' })
    fireEvent.pointerUp(svg)
    expect(current!.present.avoidances).toEqual(initial.avoidances)
    expect(current!.past).toHaveLength(0)
  }
})

it('places a parent bank arrow once and gives the separately editable child its own inherited arrow', () => {
  const state = createConnectedFixture({ clearanceRadius: 0.1 })
  state.appearance.stroke.arrows = false
  state.viewport.scaleX = 200
  state.viewport.scaleY = 200
  state.avoidances[0].partStyles = { entry: { arrows: true } }
  const geometry = buildContourGeometry(state)
  const paintedArrows = geometry.segments.filter((s) => s.arrow && s.segment.style?.arrows)
  expect(paintedArrows.filter((s) => s.segment.id.startsWith('avoid:parent:entry'))).toHaveLength(1)
  expect(paintedArrows.filter((s) => s.segment.id === 'avoid:clearance:bank-entry')).toHaveLength(1)
  expect(paintedArrows).toHaveLength(2)
})
