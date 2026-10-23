import { useReducer } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { createArcFixture } from '../../../test/fixtures'
import { ContourCanvas, type DrawingTool } from '../ContourCanvas'
import { createHistory, historyReducer, type EditorHistory } from '../history'
import { arrowChain, projectArrowPosition } from '../scene/arrowGeometry'
import { resolvedScene } from '../scene/sceneObjects'

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

function editor(tool: DrawingTool = 'select') {
  let current: EditorHistory
  function Editor() {
    const [history, dispatch] = useReducer(historyReducer, undefined, () =>
      createHistory(createArcFixture()),
    )
    current = history
    return (
      <ContourCanvas
        state={history.present}
        dispatch={dispatch}
        gestureOwner={history.gesture?.owner ?? null}
        tool={tool}
        onArcPoint={() => {}}
      />
    )
  }
  render(<Editor />)
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
  return { svg, history: () => current! }
}

it('grabs the shaft without jumping, projects only onto its own line and commits one undo step', () => {
  const { svg, history } = editor()
  const before = history().present
  fireEvent.pointerDown(screen.getByTestId('arrow-hit-edge-a'), {
    button: 0,
    clientX: 395,
    clientY: 300,
  })
  fireEvent.pointerMove(svg, { clientX: 399, clientY: 300 })
  expect(history().present.segments[0].arrowPosition).toBeCloseTo(0.525)
  fireEvent.pointerMove(svg, { clientX: 455, clientY: 220 })
  expect(history().present.segments[0].arrowPosition).toBeCloseTo(0.875)
  expect(history().present.segments[1]).toBe(before.segments[1])
  expect(history().past).toHaveLength(0)
  fireEvent.pointerUp(svg)
  expect(history().past).toHaveLength(1)
  expect(history().gesture).toBeNull()
  expect(historyReducer(history(), { type: 'undo' }).present.segments).toEqual(before.segments)
})

it('moves a curved arrow along the arc and Escape cancels without moving labels or points', () => {
  const { svg, history } = editor()
  const before = history().present
  fireEvent.pointerDown(screen.getByTestId('arrow-hit-edge-b'), {
    button: 0,
    clientX: 400,
    clientY: 220,
  })
  fireEvent.pointerMove(svg, { clientX: 400 + 40 * Math.SQRT2, clientY: 300 - 40 * Math.SQRT2 })
  expect(history().present.segments[1].arrowPosition).toBeCloseTo(0.25)
  expect(history().present.vertices).toBe(before.vertices)
  expect(history().present.segments[1].label).toBe(before.segments[1].label)
  fireEvent.keyDown(svg, { key: 'Escape' })
  fireEvent.pointerUp(svg)
  expect(history().present.segments).toEqual(before.segments)
  expect(history().past).toHaveLength(0)
})

it('keeps Ctrl multi-selection instead of starting an arrow drag', () => {
  const { history } = editor()
  fireEvent.pointerDown(screen.getByTestId('arrow-hit-edge-a'), {
    button: 0,
    ctrlKey: true,
    clientX: 400,
    clientY: 300,
  })
  expect(history().gesture).toBeNull()
  expect(history().present.selection.kind).toBe('multiple')
})

it('does not expose arrow hit targets outside the select tool', () => {
  editor('line')
  expect(screen.queryByTestId('arrow-hit-edge-a')).toBeNull()
})

it('projects elliptical arcs using screen distance, retaining the arc parameter', () => {
  const state = createArcFixture(),
    scene = resolvedScene(state)
  const chain = arrowChain(scene, 'edge-b')
  const position = projectArrowPosition(
    chain,
    scene.points,
    { re: Math.SQRT2 + 0.02, im: Math.SQRT2 + 0.32 },
    { a: 80, b: 0, c: 0, d: -20 },
  )
  // This displacement is along the ellipse's screen normal: (1/80, 1/20).
  expect(position).toBeCloseTo(0.25, 10)
})
