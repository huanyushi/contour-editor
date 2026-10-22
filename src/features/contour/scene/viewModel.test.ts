import { describe, expect, it } from 'vitest'
import { createHistory, historyReducer } from '../history'
import { createInitialState } from '../model'
import { createArcFixture } from '../../../test/fixtures'
import { buildContourGeometry } from './pathGeometry'
import { defaultAxes, defaultViewport } from '../../../lib/viewport'
import { parseProject, serializeProject } from '../../project/project'
import { canProjectScene, fitScene } from './sceneView'
import { toSvg } from '../../../lib/geometry'
import { createAvoidanceFixture } from '../../../test/avoidanceFixtures'
import { defaultLabel } from '../appearance'

describe('resolved scene views', () => {
  it('fits the off-line circle top at (0, 1.5), beyond the source points', () => {
    const state = createAvoidanceFixture()
    state.closed = false
    state.vertices = [
      { id: 'a', re: -0.75, im: 0 },
      { id: 'b', re: 0.75, im: 0 },
    ]
    state.segments = [state.segments[0]]
    state.markers[0].im = 1
    const fit = fitScene(state)!
    expect(fit).not.toBeNull()
    const top = toSvg({ re: 0, im: 1.5 }, fit)
    expect(top.y).toBeGreaterThanOrEqual(83)
    expect(top.y).toBeLessThan(300)
    expect(toSvg({ re: -0.75, im: 0 }, fit).y).toBeLessThanOrEqual(517)
  })

  it('preserves mathematical center and radius under unequal projection scales', () => {
    const state = createAvoidanceFixture()
    state.markers[0].im = 1
    state.viewport = { ...state.viewport, scaleX: 80, scaleY: 20, locked: false }
    const arc = buildContourGeometry(state).segments.find((part) => part.segment.kind === 'arc')!
    expect(arc.arc!.center.re).toBeCloseTo(0)
    expect(arc.arc!.center.im).toBeCloseTo(1)
    expect(arc.arc!.radius).toBeCloseTo(0.5)
    const radii = arc.command.split(' ').slice(1, 3).map(Number)
    expect(radii[0]).toBeCloseTo(40)
    expect(radii[1]).toBeCloseTo(10)
    expect(arc.arrow!.point.x).toBeCloseTo(400)
    expect(arc.arrow!.point.y).toBeCloseTo(270)
    expect(arc.arrow!.tangent.x).toBeCloseTo(1)
    expect(fitScene(state)!.scaleY / fitScene(state)!.scaleX).toBeCloseTo(0.25)
  })

  it('rejects an overflowing derived arc even when every source point projects finitely', () => {
    const state = createAvoidanceFixture()
    state.closed = false
    state.vertices = [
      { id: 'a', re: -1e306, im: 0 },
      { id: 'b', re: 1e306, im: 0 },
    ]
    state.segments = [state.segments[0]]
    state.markers[0].im = 1e306
    state.avoidances[0].radius = 0.5e306
    const view = { ...state.viewport, scaleY: 120, locked: false }
    expect(
      [...state.vertices, ...state.markers].every((p) =>
        Object.values(toSvg(p, view)).every(Number.isFinite),
      ),
    ).toBe(true)
    expect(canProjectScene(state, view)).toBe(false)
  })

  it('still validates a retained source arc while its closing edge is hidden', () => {
    const state = createArcFixture()
    state.closed = false
    state.segments[1] = { ...state.segments[1], kind: 'arc', through: { re: 0, im: 0 } }
    expect(canProjectScene(state, state.viewport)).toBe(false)
  })

  it('fits inherited source-label offsets from the retained-piece anchor', () => {
    const state = createAvoidanceFixture()
    state.closed = false
    state.vertices = [
      { id: 'a', re: -0.75, im: 0 },
      { id: 'b', re: 0.75, im: 0 },
    ]
    state.segments = [{ ...state.segments[0], label: { ...defaultLabel('C'), dy: -200 } }]
    state.markers[0].im = 1
    const view = fitScene(state)!
    expect(view).not.toBeNull()
    const anchor = toSvg({ re: -0.5, im: 0 }, view)
    expect(anchor.y - 200).toBeGreaterThanOrEqual(83)
    expect(toSvg({ re: 0, im: 0 }, view).y).toBeLessThanOrEqual(517)
  })
})

describe('view integration', () => {
  it('restores a safe view if undoing extreme coordinates would overflow the current zoom', () => {
    let history = historyReducer(createHistory(), {
      type: 'move',
      id: 'a',
      point: { re: 3e306, im: 0 },
    })
    history = historyReducer(history, { type: 'move', id: 'a', point: { re: 1, im: 0 } })
    history = historyReducer(history, {
      type: 'viewport',
      value: { ...defaultViewport(), scaleX: 4000, scaleY: 4000 },
    })
    history = historyReducer(history, { type: 'undo' })
    expect(history.present.vertices[0].re).toBe(3e306)
    expect(canProjectScene(history.present, history.present.viewport)).toBe(true)
  })
  it('projects a mathematical circle to an ellipse with correct screen tangents', () => {
    const state = {
      ...createArcFixture(),
      viewport: { ...defaultViewport(), scaleX: 80, scaleY: 20, locked: false },
    }
    const geometry = buildContourGeometry(state)
    expect(geometry.path).toBe('M 240 300 L 560 300 A 160 40 0 0 0 240 300 Z')
    expect(geometry.segments[1].arrow?.point.y).toBeCloseTo(260)
    expect(geometry.segments[1].arrow?.tangent.x).toBeCloseTo(-1)
  })
  it('normalizes the projected tangent on a non-axis-aligned elliptical arc', () => {
    const state = {
      ...createArcFixture(),
      viewport: { ...defaultViewport(), scaleX: 80, scaleY: 20, locked: false },
    }
    state.vertices = [
      { id: 'a', re: 0, im: 2 },
      { id: 'b', re: 2, im: 0 },
    ]
    state.segments[1] = {
      id: 'edge-b',
      kind: 'arc',
      startId: 'b',
      endId: 'a',
      through: { re: Math.SQRT2, im: Math.SQRT2 },
    }
    const arrow = buildContourGeometry(state).segments[1].arrow!
    expect(arrow.tangent.x).toBeCloseTo(-4 / Math.sqrt(17))
    expect(arrow.tangent.y).toBeCloseTo(-1 / Math.sqrt(17))
  })
  it('does not record view changes and preserves them across undo', () => {
    let history = historyReducer(createHistory(), {
      type: 'move',
      id: 'a',
      point: { re: 1, im: 1 },
    })
    const viewport = { ...defaultViewport(), centerRe: 2, scaleX: 80, scaleY: 80 }
    history = historyReducer(history, { type: 'viewport', value: viewport })
    history = historyReducer(history, {
      type: 'axes',
      patch: { visible: false, arrow: 'triangle' },
    })
    expect(history.past).toHaveLength(1)
    history = historyReducer(history, { type: 'undo' })
    expect(history.present.viewport).toEqual(viewport)
    expect(history.present.axes.visible).toBe(false)
  })
  it('reads legacy projects and round-trips new view settings', () => {
    const legacy = JSON.parse(serializeProject(createInitialState())) as {
      document: { view: Record<string, unknown> }
    }
    delete legacy.document.view.viewport
    delete legacy.document.view.axes
    const state = parseProject(JSON.stringify(legacy))
    expect(state.viewport).toEqual(defaultViewport())
    expect(state.axes).toEqual(defaultAxes())
    const modified = {
      ...state,
      viewport: { ...state.viewport, centerIm: 5 },
      axes: { ...state.axes, arrow: 'none' as const },
    }
    const loaded = parseProject(serializeProject(modified))
    expect(loaded.viewport).toEqual(modified.viewport)
    expect(loaded.axes).toEqual(modified.axes)
  })
  it('fits arc extrema and offscreen objects into the viewport', () => {
    const state = createArcFixture()
    state.vertices = [
      { id: 'a', re: 98, im: 0 },
      { id: 'b', re: 102, im: 0 },
    ]
    state.segments[1] = { ...state.segments[1], kind: 'arc', through: { re: 100, im: 2 } }
    const fit = fitScene(state)
    expect(fit).not.toBeNull()
    const top = toSvg({ re: 100, im: 2 }, fit!)
    expect(top.x).toBeGreaterThan(20)
    expect(top.x).toBeLessThan(780)
    expect(top.y).toBeGreaterThanOrEqual(20)
    expect(top.y).toBeLessThan(580)
  })
})
