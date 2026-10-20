import { describe, expect, it } from 'vitest'
import { createHistory, historyReducer } from './history'
import { createInitialState } from './model'
import { createArcFixture } from '../../test/fixtures'
import { buildContourGeometry } from './pathGeometry'
import { defaultAxes, defaultViewport } from '../../lib/viewport'
import { parseProject, serializeProject } from '../project/project'
import { canProjectScene, fitScene } from './sceneView'
import { toSvg } from '../../lib/geometry'

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
