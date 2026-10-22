import { fireEvent, render, screen } from '@testing-library/react'
import { useReducer } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  createConnectedFixture,
  createRectangleConnectedFixture,
} from '../../../test/connectedAvoidanceFixtures'
import { ContourCanvas } from '../ContourCanvas'
import { createHistory, historyReducer, type EditorHistory } from '../history'
import { resolvedScene } from '../scene/sceneObjects'
import { serializeSvg, defaultExportOptions } from '../../project/export'
import type { ContourState } from '../model'

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

function editor(initial: ContourState) {
  let current: EditorHistory
  function Editor() {
    const [history, dispatch] = useReducer(historyReducer, initial, createHistory)
    current = history
    return (
      <>
        <button onClick={() => dispatch({ type: 'undo' })}>Undo</button>
        <ContourCanvas
          state={history.present}
          dispatch={dispatch}
          gestureOwner={history.gesture?.owner ?? null}
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
  return { ...view, svg, current: () => current! }
}
function at(node: Element) {
  const [x, y] = node
    .getAttribute('transform')!
    .match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi)!
    .map(Number)
  return { x, y }
}

it.each(['entry', 'exit'] as const)(
  'dragging the rectangle %s port moves both contacts without grid snapping or resizing',
  (end) => {
    const initial = createRectangleConnectedFixture()
    initial.snap = true
    const view = editor(initial)
    const handle = screen.getByTestId(`avoidance-port-parent-${end}`)
    const p = at(handle)
    const re = 0.7 + (end === 'entry' ? -1 : 1) * 0.1 * Math.sqrt(1.49)
    fireEvent.pointerDown(handle, { button: 0, clientX: p.x, clientY: p.y })
    fireEvent.pointerMove(view.svg, {
      clientX: 400 + re * 80,
      clientY: p.y,
    })
    const state = view.current().present
    expect(state.error).toBe('')
    expect(state.avoidances[0]).toMatchObject({
      radius: 0.4,
      gap: 0.2,
      anchor: { kind: 'segment', segmentId: 'edge-a', t: expect.closeTo(0.675, 10) },
    })
    expect(state.vertices).toBe(initial.vertices)
    const scene = resolvedScene(state)
    expect(scene.points.get('avoid:parent:entry-base')!.re).toBeCloseTo(
      0.7 - 0.1 * Math.sqrt(1.49),
      9,
    )
    expect(scene.points.get('avoid:parent:exit-base')!.re).toBeCloseTo(
      0.7 + 0.1 * Math.sqrt(1.49),
      9,
    )
    fireEvent.pointerUp(view.svg)
    expect(view.current().past).toHaveLength(1)
    fireEvent.click(screen.getByText('Undo'))
    expect(view.current().present.avoidances).toEqual(initial.avoidances)
  },
)

it('drags the independent gap handle from its start snapshot under anisotropic projection and cancels with Escape', () => {
  const initial = createRectangleConnectedFixture()
  initial.viewport.scaleY = 40
  initial.viewport.locked = false
  const view = editor(initial)
  const handle = screen.getByTestId('avoidance-gap-parent')
  const p = at(handle)
  fireEvent.pointerDown(handle, { button: 0, clientX: p.x, clientY: p.y })
  for (const dx of [4, 8]) fireEvent.pointerMove(view.svg, { clientX: p.x + dx, clientY: p.y })
  expect(view.current().present.error).toBe('')
  expect(view.current().present.avoidances[0]).toMatchObject({
    radius: 0.4,
    gap: expect.closeTo(0.4, 10),
    anchor: { kind: 'segment', segmentId: 'edge-a', t: 0.5 },
  })
  fireEvent.pointerMove(view.svg, { clientX: p.x + 200, clientY: p.y })
  expect(view.current().present.avoidances[0]).toMatchObject({ gap: expect.closeTo(0.4, 10) })
  fireEvent.keyDown(view.svg, { key: 'Escape' })
  expect(view.current().present.avoidances).toEqual(initial.avoidances)
  expect(view.current().past).toHaveLength(0)
})

it('keeps tiny endpoints in place and the independent gap handle clear of actual points', () => {
  const initial = createRectangleConnectedFixture(0.02)
  const view = editor(initial)
  const source = screen.getByTestId('avoidance-port-parent-entry')
  const a = screen.getByTestId('avoidance-radius-parent-entry')
  const b = screen.getByTestId('avoidance-radius-parent-exit')
  expect(at(source)).toEqual({ x: 399.2, y: 300 })
  expect(Math.hypot(at(a).x - at(b).x, at(a).y - at(b).y)).toBeCloseTo(1.6, 9)
  expect(view.container.querySelectorAll('[data-avoidance-endpoint-leader]')).toHaveLength(0)
  expect(screen.queryByTestId('avoidance-port-parent-both')).toBeNull()
  const knob = at(screen.getByTestId('avoidance-gap-parent'))
  for (const endpoint of [source, a, b]) {
    const q = at(endpoint)
    expect(Math.hypot(knob.x - q.x, knob.y - q.y)).toBeGreaterThanOrEqual(28)
  }
})

it('omits new controls from export and hides them with endpoint handles off', () => {
  const view = editor(createRectangleConnectedFixture())
  expect(serializeSvg(view.svg as unknown as SVGSVGElement, defaultExportOptions())).not.toContain(
    '接入点',
  )
  view.unmount()
  const state = createRectangleConnectedFixture()
  state.handles = false
  const hidden = editor(state)
  expect(hidden.container.querySelectorAll('[data-avoidance-control]')).toHaveLength(0)
})

it('does not put an artificial merged handle on the real circular seam vertex', () => {
  const state = createConnectedFixture()
  state.viewport = { ...state.viewport, scaleX: 200, scaleY: 200 }
  editor(state)
  expect(screen.queryByTestId('avoidance-port-parent-both')).toBeNull()
})

it('routes an exactly coincident source grip to the real vertex unless the grip is selected', () => {
  const state = createRectangleConnectedFixture(0.4 / Math.sqrt(4.24))
  if (state.avoidances[0].kind !== 'corridor') throw new Error('fixture')
  state.avoidances[0].anchor = { kind: 'segment', segmentId: 'edge-a', t: 0.95 }
  const view = editor(state)
  const control = screen.getByTestId('avoidance-port-parent-exit')
  expect(at(control)).toEqual({ x: 560, y: 300 })
  fireEvent.pointerDown(control, { button: 0, clientX: 560, clientY: 300 })
  fireEvent.pointerUp(view.svg)
  expect(view.current().present.selection).toEqual({ kind: 'vertex', id: 'b' })
})

it('picks the nearest radius point rather than an overlapping source hit region', () => {
  const state = createRectangleConnectedFixture()
  state.avoidances[0].radius = 0.98
  const view = editor(state)
  const source = screen.getByTestId('avoidance-port-parent-entry')
  const p = at(screen.getByTestId('avoidance-radius-parent-entry'))
  fireEvent.pointerDown(source, { button: 0, clientX: p.x, clientY: p.y })
  fireEvent.pointerMove(view.svg, {
    clientX: 400 + ((p.x - 400) * 0.9) / 0.98,
    clientY: 220 + ((p.y - 220) * 0.9) / 0.98,
  })
  expect(view.current().present.avoidances[0]).toMatchObject({
    radius: expect.closeTo(0.9, 8),
    gap: 0.2,
  })
})

it('routes a hit near generated endpoints to the actual center marker when zoomed out', () => {
  const state = createRectangleConnectedFixture()
  state.vertices = state.vertices.map((p) => ({ ...p, re: p.re * 10 }))
  state.viewport = { ...state.viewport, scaleX: 5, scaleY: 5 }
  const view = editor(state)
  fireEvent.pointerDown(screen.getByTestId('avoidance-port-parent-entry'), {
    button: 0,
    clientX: 400,
    clientY: 295,
  })
  fireEvent.pointerUp(view.svg)
  expect(view.current().present.selection).toEqual({ kind: 'marker', id: 'center' })
})

it('keeps every spacing icon clear of ports belonging to later detours too', () => {
  const state = createRectangleConnectedFixture()
  state.avoidances[0].radius = 0.8
  state.markers.push({ ...state.markers[0], id: 'below', re: 0.5, im: -1.8 })
  state.avoidances.push({
    kind: 'corridor',
    id: 'second',
    markerId: 'below',
    radius: 0.1,
    gap: 0.04,
    anchor: { kind: 'segment', segmentId: 'edge-a', t: 0.625 },
  })
  const view = editor(state)
  const endpoints = [
    ...view.container.querySelectorAll('[data-avoidance-handle], [data-avoidance-control="port"]'),
  ].map(at)
  for (const icon of view.container.querySelectorAll('[data-avoidance-control="gap"]')) {
    const p = at(icon)
    for (const q of endpoints) expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeGreaterThanOrEqual(28)
  }
})

it('hides the independent gap icon together with a parent that depends on a hidden closing arc', () => {
  const state = createConnectedFixture()
  state.closed = false
  const view = editor(state)
  expect(resolvedScene(state).contourSegments.map((s) => s.id)).toEqual(['upper'])
  expect(
    view.container.querySelectorAll('[data-avoidance-handle], [data-avoidance-control]'),
  ).toHaveLength(0)
})

it('lets a corridor-bound singularity leave the boundary instead of permanently capturing the source path', () => {
  const state = createRectangleConnectedFixture()
  state.markers[0].im = 0
  state.avoidances = state.avoidances.map((a) =>
    a.kind === 'corridor' ? { ...a, alignment: { kind: 'normal' as const } } : a,
  )
  const view = editor(state)
  fireEvent.pointerDown(screen.getByTestId('marker-center'), {
    button: 0,
    clientX: 400,
    clientY: 300,
  })
  fireEvent.pointerMove(view.svg, { clientX: 400, clientY: 260 })
  fireEvent.pointerUp(view.svg)
  expect(view.current().present.error).toBe('')
  expect(view.current().present.markers[0].im).toBe(0.5)
  expect(view.current().past).toHaveLength(1)
})
