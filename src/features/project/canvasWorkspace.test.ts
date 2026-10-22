import { describe, expect, it } from 'vitest'
import { createInitialState } from '../contour/model'
import { parseProject, serializeProject } from './project'
import {
  canvasWorkspaceReducer as reduce,
  committedState,
  createBlankCanvasState,
  createCanvasEntry,
  type CanvasWorkspace,
} from './canvasWorkspace'

const initial = (): CanvasWorkspace => ({
  canvases: [createCanvasEntry('a', 'A', createInitialState())],
  activeId: 'a',
})

describe('independent canvases', () => {
  it('creates a truly empty new canvas without changing the default rectangle', () => {
    const blank = createBlankCanvasState()
    for (const key of [
      'vertices',
      'segments',
      'connections',
      'markers',
      'formulas',
      'avoidances',
    ] as const)
      expect(blank[key]).toHaveLength(0)
    expect(blank.closed).toBe(false)
    expect(parseProject(serializeProject(blank)).vertices).toHaveLength(0)
    expect(initial().canvases[0].history.present.vertices).toHaveLength(4)
  })

  it('retains independent undo and redo histories and ignores stale editor actions', () => {
    let ws = initial()
    ws = reduce(ws, { type: 'edit', id: 'a', action: { type: 'reverse' } })
    ws = reduce(ws, { type: 'add', entry: createCanvasEntry('b', 'B', createBlankCanvasState()) })
    ws = reduce(ws, { type: 'edit', id: 'b', action: { type: 'undo' } })
    expect(ws.canvases[1].history.present.vertices).toHaveLength(0)
    const unchanged = ws
    ws = reduce(ws, { type: 'edit', id: 'a', action: { type: 'reverse' } })
    expect(ws).toBe(unchanged)
    ws = reduce(ws, { type: 'activate', id: 'a' })
    ws = reduce(ws, { type: 'edit', id: 'a', action: { type: 'undo' } })
    expect(ws.canvases[0].history.future).toHaveLength(1)
    ws = reduce(ws, { type: 'rename', id: 'a', name: 'renamed' })
    expect(ws.canvases[0].history.future).toHaveLength(1)
    ws = reduce(ws, { type: 'activate', id: 'b' })
    ws = reduce(ws, { type: 'activate', id: 'a' })
    ws = reduce(ws, { type: 'edit', id: 'a', action: { type: 'redo' } })
    expect(ws.canvases[0].history.past).toHaveLength(1)
  })

  it('cancels unfinished gestures and clears selections on activation', () => {
    let ws = initial()
    ws = reduce(ws, { type: 'edit', id: 'a', action: { type: 'beginGesture', owner: 'canvas' } })
    ws = reduce(ws, {
      type: 'edit',
      id: 'a',
      action: { type: 'move', id: 'a', point: { re: -3, im: 1 } },
    })
    expect(committedState(ws.canvases[0].history).vertices[0].re).toBe(-4)
    ws = reduce(ws, { type: 'add', entry: createCanvasEntry('b', 'B', createBlankCanvasState()) })
    expect(ws.canvases[0].history.gesture).toBeNull()
    expect(ws.canvases[0].history.present.vertices[0].re).toBe(-4)
    ws = reduce(ws, { type: 'activate', id: 'a' })
    expect(ws.canvases[0].history.present.selection.kind).toBe('none')
  })

  it('caps additions at ten and always keeps a canvas after deletion', () => {
    let ws = initial()
    for (let i = 1; i < 11; i++)
      ws = reduce(ws, {
        type: 'add',
        entry: createCanvasEntry(String(i), `C${i}`, createBlankCanvasState()),
      })
    expect(ws.canvases).toHaveLength(10)
    ws = reduce(ws, { type: 'remove', id: ws.activeId })
    expect(ws.canvases.some((c) => c.id === ws.activeId)).toBe(true)
    ws = initial()
    expect(reduce(ws, { type: 'remove', id: 'a' })).toBe(ws)
    ws = reduce(ws, {
      type: 'remove',
      id: 'a',
      replacement: createCanvasEntry('new', '', createBlankCanvasState()),
    })
    expect(ws.canvases).toHaveLength(1)
    expect(ws.canvases[0].name).toBe('Untitled')
    expect(ws.canvases[0].history.present.vertices).toHaveLength(0)
  })

  it('creates an independent copy with an empty history', () => {
    let ws = initial()
    ws = reduce(ws, { type: 'edit', id: 'a', action: { type: 'reverse' } })
    const source = ws.canvases[0]
    const copy = createCanvasEntry(
      'copy',
      'A 副本',
      parseProject(serializeProject(source.history.present)),
    )
    ws = reduce(ws, { type: 'add', entry: copy })
    ws = reduce(ws, {
      type: 'edit',
      id: 'copy',
      action: { type: 'move', id: 'a', point: { re: -2, im: 0 } },
    })
    expect(ws.canvases[0].history.present.vertices[0].re).toBe(-4)
    expect(copy.history.past).toHaveLength(0)
  })
})
