import { describe, expect, it } from 'vitest'
import { createHistory, historyReducer } from './history'
import { contourReducer, createInitialState } from './model'
import { buildContourGeometry } from './pathGeometry'
import { fitScene } from './sceneView'
import { parseProject, serializeProject } from '../project/project'

describe('single and multiple object operations', () => {
  it('toggles Ctrl-selected objects without recording selection in document history', () => {
    let history = createHistory()
    history = historyReducer(history, {
      type: 'toggleSelection',
      item: { kind: 'segment', id: 'edge-a' },
    })
    expect(history.present.selection).toEqual({
      kind: 'multiple',
      items: [
        { kind: 'vertex', id: 'a' },
        { kind: 'segment', id: 'edge-a' },
      ],
    })
    history = historyReducer(history, {
      type: 'toggleSelection',
      item: { kind: 'vertex', id: 'a' },
    })
    expect(history.present.selection).toEqual({ kind: 'segment', id: 'edge-a' })
    history = historyReducer(history, {
      type: 'toggleSelection',
      item: { kind: 'segment', id: 'edge-a' },
    })
    expect(history.present.selection).toEqual({ kind: 'none' })
    expect(history.past).toHaveLength(0)
  })

  it('deletes only the selected segment, keeps endpoints and renders every surviving edge without filling', () => {
    let state = contourReducer(createInitialState(), { type: 'selectSegment', id: 'edge-b' })
    state = contourReducer(state, { type: 'deleteSelection' })
    expect(state.vertices.map((v) => v.id)).toEqual(['a', 'b', 'c', 'd'])
    expect(state.segments.map((s) => s.id)).toEqual(['edge-a', 'edge-c', 'edge-d'])
    expect(state.closed).toBe(false)
    expect(state.selection).toEqual({ kind: 'none' })
    const geometry = buildContourGeometry(state)
    expect(geometry.segments).toHaveLength(3)
    expect(geometry.path).not.toContain('Z')
    expect(parseProject(serializeProject(state)).segments).toEqual(state.segments)
  })

  it('keeps separated path components separate instead of drawing an implicit connecting line', () => {
    let state = contourReducer(createInitialState(), {
      type: 'selectMany',
      items: [
        { kind: 'segment', id: 'edge-a' },
        { kind: 'segment', id: 'edge-c' },
      ],
    })
    state = contourReducer(state, { type: 'deleteSelection' })
    const geometry = buildContourGeometry(state)
    expect(geometry.segments.map((s) => s.segment.id)).toEqual(['edge-b', 'edge-d'])
    expect(geometry.path.match(/M /g)).toHaveLength(2)
    expect(geometry.path).not.toContain('Z')
    expect(parseProject(serializeProject(state)).vertices).toEqual(state.vertices)
  })

  it('deletes a vertex and its incident segments without changing unrelated geometry', () => {
    let state = contourReducer(createInitialState(), { type: 'select', id: 'b' })
    state = contourReducer(state, { type: 'deleteSelection' })
    expect(state.vertices.map((v) => v.id)).toEqual(['a', 'c', 'd'])
    expect(state.segments.map((s) => s.id)).toEqual(['edge-c', 'edge-d'])
    expect(state.closed).toBe(false)
  })

  it('deletes heterogeneous selected objects in one undoable operation', () => {
    let state = contourReducer(createInitialState(), {
      type: 'addMarker',
      id: 'pole',
      point: { re: 0, im: 1 },
    })
    state = contourReducer(state, { type: 'addFormula', id: 'f', point: { re: 1, im: 2 } })
    let history = createHistory(state)
    history = historyReducer(history, {
      type: 'selectMany',
      items: [
        { kind: 'vertex', id: 'a' },
        { kind: 'segment', id: 'edge-c' },
        { kind: 'marker', id: 'pole' },
        { kind: 'formula', id: 'f' },
      ],
    })
    const before = history.present
    history = historyReducer(history, { type: 'deleteSelection' })
    expect(history.present.vertices.map((v) => v.id)).toEqual(['b', 'c', 'd'])
    expect(history.present.segments.map((s) => s.id)).toEqual(['edge-b'])
    expect(history.present.markers).toHaveLength(0)
    expect(history.present.formulas).toHaveLength(0)
    expect(history.past).toHaveLength(1)
    expect(historyReducer(history, { type: 'undo' }).present).toEqual(before)
  })

  it('can erase all geometry, save and reload an empty project, then draw and close a new path', () => {
    let state = contourReducer(createInitialState(), {
      type: 'selectObject',
      selection: { kind: 'contour' },
    })
    state = contourReducer(state, { type: 'deleteSelection' })
    expect(state.vertices).toHaveLength(0)
    expect(state.segments).toHaveLength(0)
    expect(buildContourGeometry(state).path).toBe('')
    expect(fitScene(state)).toEqual(state.viewport)
    state = parseProject(serializeProject(state))
    for (const vertex of [
      { id: 'p', re: 0, im: 0 },
      { id: 'q', re: 2, im: 0 },
      { id: 'r', re: 1, im: 2 },
    ])
      state = contourReducer(state, { type: 'add', vertex })
    expect(buildContourGeometry(state).segments).toHaveLength(2)
    state = contourReducer(state, { type: 'toggleClosed' })
    expect(state.closed).toBe(true)
    expect(buildContourGeometry(state).segments).toHaveLength(3)
    expect(parseProject(serializeProject(state)).segments).toEqual(state.segments)
  })

  it('allows deleting the last endpoint and independently hides an attached label', () => {
    let state = contourReducer(createInitialState(), {
      type: 'selectObject',
      selection: { kind: 'contour' },
    })
    state = contourReducer(state, { type: 'deleteSelection' })
    state = contourReducer(state, { type: 'add', vertex: { id: 'only', re: 1, im: 1 } })
    expect(parseProject(serializeProject(state)).vertices).toHaveLength(1)
    state = contourReducer(state, { type: 'deleteSelection' })
    expect(state.vertices).toHaveLength(0)
    state = contourReducer(createInitialState(), {
      type: 'selectObject',
      selection: { kind: 'vertex', id: 'a', part: 'label' },
    })
    state = contourReducer(state, { type: 'deleteSelection' })
    expect(state.vertices).toHaveLength(4)
    expect(state.vertices[0].label?.visible).toBe(false)
  })

  it('applies mixed object colors and widths atomically while leaving unselected objects alone', () => {
    let state = contourReducer(createInitialState(), {
      type: 'addFormula',
      id: 'f',
      point: { re: 0, im: 1 },
    })
    state = contourReducer(state, {
      type: 'selectMany',
      items: [
        { kind: 'vertex', id: 'a' },
        { kind: 'segment', id: 'edge-b' },
        { kind: 'formula', id: 'f' },
      ],
    })
    let history = historyReducer(createHistory(state), {
      type: 'selectionStyle',
      patch: { color: '#2563eb', width: 4, radius: 6 },
    })
    expect(history.present.vertices[0].pointStyle).toMatchObject({ color: '#2563eb', radius: 6 })
    expect(history.present.vertices[1]).toEqual(state.vertices[1])
    expect(history.present.segments[1].style).toMatchObject({ color: '#2563eb', width: 4 })
    expect(history.present.formulas[0].label.color).toBe('#2563eb')
    expect(history.past).toHaveLength(1)
    history = historyReducer(history, { type: 'undo' })
    expect(history.present.vertices).toEqual(state.vertices)
    expect(history.present.segments).toEqual(state.segments)
    expect(history.present.formulas).toEqual(state.formulas)
  })

  it('discards retained closing edges when cutting an already-open path, without revealing them', () => {
    let state = contourReducer(createInitialState(), { type: 'toggleClosed' })
    state = contourReducer(state, { type: 'selectSegment', id: 'edge-b' })
    state = contourReducer(state, { type: 'deleteSelection' })
    expect(buildContourGeometry(state).segments.map((s) => s.segment.id)).toEqual([
      'edge-a',
      'edge-c',
    ])
    expect(state.segments.map((s) => s.id)).toEqual(['edge-a', 'edge-c'])
  })

  it('allocates new segment IDs without colliding with imported or newly added endpoint IDs', () => {
    let state = contourReducer(createInitialState(), {
      type: 'selectObject',
      selection: { kind: 'contour' },
    })
    state = contourReducer(state, { type: 'deleteSelection' })
    state = contourReducer(state, { type: 'add', vertex: { id: 'p', re: 0, im: 0 } })
    state = contourReducer(state, { type: 'add', vertex: { id: 'edge-p', re: 1, im: 0 } })
    expect(() => parseProject(serializeProject(state))).not.toThrow()
    const ids = [...state.vertices, ...state.segments].map((o) => o.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('rejects invalid bulk styles atomically and rejects branching project connections', () => {
    let state = contourReducer(createInitialState(), {
      type: 'selectMany',
      items: [
        { kind: 'vertex', id: 'a' },
        { kind: 'segment', id: 'edge-b' },
      ],
    })
    const invalid = contourReducer(state, {
      type: 'selectionStyle',
      patch: { color: '#2563eb', width: NaN },
    })
    expect(invalid.vertices).toBe(state.vertices)
    expect(invalid.segments).toBe(state.segments)
    expect(invalid.error).not.toBe('')
    state = {
      ...state,
      closed: false,
      segments: state.segments.map((s, i) => (i === 1 ? { ...s, startId: 'a' } : s)),
    }
    expect(() => parseProject(serializeProject(state))).toThrow(/连接/)
  })

  it('rejects a cyclic subcomponent with an isolated endpoint so visibility cannot change after deleting that endpoint', () => {
    const state = createInitialState()
    state.closed = false
    state.vertices = [...state.vertices, { id: 'isolated', re: 7, im: 4 }]
    expect(() => parseProject(serializeProject(state))).toThrow(/环路/)
  })

  it('explicit segment deletion removes the segment even when its label was selected', () => {
    let state = contourReducer(createInitialState(), {
      type: 'selectObject',
      selection: { kind: 'segment', id: 'edge-a', part: 'label' },
    })
    state = contourReducer(state, { type: 'deleteSegment', id: 'edge-a' })
    expect(state.vertices).toHaveLength(4)
    expect(state.segments.map((s) => s.id)).toEqual(['edge-b', 'edge-c', 'edge-d'])
  })
})
