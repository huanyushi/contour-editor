import { describe, expect, it } from 'vitest'
import { canClose, contourReducer, createInitialState, type ContourState } from './model'
import { createHistory, historyReducer } from './history'
import { defaultLabel } from './appearance'
import { buildContourGeometry } from './pathGeometry'
import { itemAnchor, itemsWithinRect, selectionBounds } from './selectionGeometry'
import { translationAnchor } from './selectionTransform'
import { fitScene, canProjectScene } from './sceneView'
import { parseProject, serializeProject, type ProjectFile } from '../project/project'
import {
  findPoint,
  findSegment,
  scenePoints,
  sceneSegments,
  visibleSceneSegments,
} from './sceneObjects'
import { createVertex } from './createVertex'
import { itemColor } from './selectionModel'

function withMarkers(): ContourState {
  let state = contourReducer(createInitialState(), {
    type: 'addMarker',
    id: 'm',
    point: { re: 0, im: 0 },
  })
  state = contourReducer(state, {
    type: 'addMarker',
    id: 'n',
    point: { re: 2, im: 0 },
  })
  return state
}

function connect(state: ContourState, startId = 'm', endId = 'n') {
  return contourReducer(state, { type: 'connectPoints', startId, endId })
}

describe('independent connections', () => {
  it('creates chords and marker branches in one undo step without changing the contour', () => {
    const base = withMarkers()
    let history = historyReducer(createHistory(base), {
      type: 'connectPoints',
      startId: 'a',
      endId: 'c',
    })
    expect(history.present.connections).toHaveLength(1)
    expect(history.present.vertices).toBe(base.vertices)
    expect(history.present.markers).toBe(base.markers)
    expect(history.present.segments).toBe(base.segments)
    expect(history.present.closed).toBe(true)
    expect(history.present.selection).toEqual({
      kind: 'segment',
      id: history.present.connections[0].id,
    })
    expect(history.present.selectedSegmentId).toBe(history.present.connections[0].id)
    expect(history.present.selectionSource).toBe('click')
    expect(history.past).toHaveLength(1)
    expect(historyReducer(history, { type: 'undo' }).present.connections).toEqual([])
    history = historyReducer(history, { type: 'connectPoints', startId: 'a', endId: 'm' })
    history = historyReducer(history, { type: 'connectPoints', startId: 'a', endId: 'n' })
    expect(history.present.connections).toHaveLength(3)
    expect(parseProject(serializeProject(history.present)).connections).toEqual(
      history.present.connections,
    )
  })

  it('selects unordered duplicate visible lines without history', () => {
    const base = connect(withMarkers())
    let history = historyReducer(createHistory(base), {
      type: 'connectPoints',
      startId: 'n',
      endId: 'm',
    })
    expect(history.present.connections).toBe(base.connections)
    expect(history.present.selection).toEqual({ kind: 'segment', id: base.connections[0].id })
    expect(history.past).toHaveLength(0)
    history = historyReducer(createHistory(base), {
      type: 'connectPoints',
      startId: 'a',
      endId: 'd',
    })
    expect(history.present.selection).toEqual({ kind: 'segment', id: 'edge-d' })
    expect(history.present.connections).toBe(base.connections)
    expect(history.past).toHaveLength(0)
  })

  it('materializes a hidden retained closing line as the same visible connection in one undo step', () => {
    let base = connect(connect(connect(withMarkers()), 'a', 'c'), 'a', 'm')
    base = contourReducer(base, {
      type: 'stroke',
      id: 'edge-d',
      patch: { color: '#123456', width: 4, dash: 'dashed' },
    })
    base = contourReducer(base, {
      type: 'label',
      target: { kind: 'segment', id: 'edge-d' },
      label: defaultLabel('C'),
    })
    const filledPath = buildContourGeometry(base).path
    const open = contourReducer(base, { type: 'toggleClosed' })
    const retained = open.segments[3]
    const openPath = buildContourGeometry(open).path
    expect(visibleSceneSegments(open).some((s) => s.id === retained.id)).toBe(false)
    const history = historyReducer(createHistory(open), {
      type: 'connectPoints',
      startId: 'a',
      endId: 'd',
    })
    const state = history.present
    expect(state.segments.map((s) => s.id)).toEqual(['edge-a', 'edge-b', 'edge-c'])
    expect(state.connections).toEqual([...open.connections, retained])
    expect(state.connections.at(-1)).toBe(retained)
    expect(state.vertices).toBe(open.vertices)
    expect(state.markers).toBe(open.markers)
    expect(state.closed).toBe(false)
    expect(state.appearance.fill).toBe(open.appearance.fill)
    expect(buildContourGeometry(state).path).toBe(openPath)
    expect(buildContourGeometry(state).segments.map((g) => g.segment.id)).toContain('edge-d')
    expect(sceneSegments(state).filter((s) => s.id === 'edge-d')).toHaveLength(1)
    expect(state.selection).toEqual({ kind: 'segment', id: 'edge-d' })
    expect(state.selectedSegmentId).toBe('edge-d')
    expect(state.selectionSource).toBe('click')
    expect(history.past).toHaveLength(1)
    const restored = parseProject(serializeProject(state))
    expect(restored.segments).toEqual(state.segments)
    expect(restored.connections).toEqual(state.connections)
    expect(restored.closed).toBe(false)
    expect(buildContourGeometry(restored).path).toBe(openPath)
    const repeated = historyReducer(history, { type: 'connectPoints', startId: 'd', endId: 'a' })
    expect(repeated.present.connections).toBe(state.connections)
    expect(repeated.past).toHaveLength(1)
    expect(historyReducer(history, { type: 'undo' }).present).toEqual(open)
    const closed = contourReducer(state, { type: 'toggleClosed' })
    expect(closed.closed).toBe(true)
    expect(buildContourGeometry(closed).path).toBe(filledPath)
  })

  it('selects the visible line of a two-point retained reverse pair without materializing a duplicate', () => {
    const base = createInitialState()
    const state: ContourState = {
      ...base,
      vertices: base.vertices.slice(0, 2),
      segments: [base.segments[0], { id: 'reverse', kind: 'line', startId: 'b', endId: 'a' }],
      closed: false,
    }
    for (const [startId, endId] of [
      ['a', 'b'],
      ['b', 'a'],
    ]) {
      const history = historyReducer(createHistory(state), {
        type: 'connectPoints',
        startId,
        endId,
      })
      expect(history.present.selection).toEqual({ kind: 'segment', id: 'edge-a' })
      expect(history.present.selectedSegmentId).toBe('edge-a')
      expect(history.present.segments).toBe(state.segments)
      expect(history.present.connections).toBe(state.connections)
      expect(history.past).toHaveLength(0)
      expect(() => parseProject(serializeProject(history.present))).not.toThrow()
    }
  })

  it('rejects missing, self and equal-coordinate endpoints without document history', () => {
    const base = withMarkers()
    const state = { ...base, markers: [...base.markers, { ...base.markers[0], id: 'coincident' }] }
    for (const [startId, endId] of [
      ['m', 'm'],
      ['m', 'missing'],
      ['m', 'coincident'],
    ]) {
      const history = historyReducer(createHistory(state), {
        type: 'connectPoints',
        startId,
        endId,
      })
      expect(history.present.connections).toEqual([])
      expect(history.past).toHaveLength(0)
    }
  })

  it('reuses exact-position points and formulas without promotions or appearance changes', () => {
    const base = withMarkers()
    for (const type of ['addMarker', 'add'] as const) {
      for (const [point, kind] of [
        [base.vertices[0], 'vertex'],
        [base.markers[0], 'marker'],
      ] as const) {
        const action =
          type === 'add'
            ? { type, vertex: { id: 'unused', re: point.re, im: point.im } }
            : { type, id: 'unused', point }
        const history = historyReducer(createHistory(base), action)
        expect(history.present.selection).toEqual({ kind, id: point.id })
        expect(history.present.vertices).toBe(base.vertices)
        expect(history.present.markers).toBe(base.markers)
        expect(history.past).toHaveLength(0)
      }
    }
    const formula = contourReducer(base, {
      type: 'addFormula',
      id: 'f',
      point: { re: 1.123456789, im: 2 },
    })
    const reused = historyReducer(createHistory(formula), {
      type: 'addFormula',
      id: 'other',
      point: { re: 1.123456789, im: 2 },
    })
    expect(reused.present.selection).toEqual({ kind: 'formula', id: 'f' })
    expect(reused.past).toHaveLength(0)
    expect(
      contourReducer(base, { type: 'addMarker', id: 'precise', point: { re: 1e-12, im: 0 } })
        .markers,
    ).toHaveLength(3)
  })

  it('edits connection arcs atomically and permits a separate straight chord', () => {
    const base = connect(withMarkers())
    const id = base.connections[0].id
    const curved = contourReducer(base, { type: 'setArc', id, through: { re: 1, im: 1 } })
    expect(curved.connections[0]).toMatchObject({ kind: 'arc', through: { re: 1, im: 1 } })
    const invalid = contourReducer(curved, {
      type: 'moveObject',
      kind: 'marker',
      id: 'm',
      point: { re: 2, im: 0 },
    })
    expect(invalid.markers).toBe(curved.markers)
    expect(invalid.error).not.toBe('')
    const moved = contourReducer(curved, { type: 'moveThrough', id, point: { re: 1, im: 2 } })
    expect(moved.connections[0]).toMatchObject({ through: { re: 1, im: 2 } })
    const chord = connect(moved)
    expect(chord.connections.map((s) => s.kind)).toEqual(['arc', 'line'])
    const line = contourReducer(curved, { type: 'setLine', id })
    expect(line.connections[0]).toEqual({ id, kind: 'line', startId: 'm', endId: 'n' })
  })

  it('keeps globally occupied IDs out of point and connection creation', () => {
    const base = connect(withMarkers())
    const id = base.connections[0].id
    expect(contourReducer(base, { type: 'addMarker', id, point: { re: 9, im: 9 } }).markers).toBe(
      base.markers,
    )
    expect(
      contourReducer(base, { type: 'addFormula', id: 'a', point: { re: 9, im: 9 } }).formulas,
    ).toBe(base.formulas)
    expect(contourReducer(base, { type: 'add', vertex: { id, re: 9, im: 9 } }).vertices).toBe(
      base.vertices,
    )
    const next = connect(base, 'a', 'm')
    const ids = [
      ...next.vertices,
      ...next.segments,
      ...next.connections,
      ...next.markers,
      ...next.formulas,
    ].map((o) => o.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('reserves connection IDs and derived edge IDs when allocating new vertices', () => {
    const base = withMarkers()
    const state: ContourState = {
      ...base,
      connections: Array.from({ length: 100 }, (_, index) => ({
        id: index < 50 ? `vertex-${index}` : `edge-vertex-${index}`,
        kind: 'arc',
        startId: 'm',
        endId: 'n',
        through: { re: 1, im: 1 },
      })),
    }
    const vertex = createVertex({ re: 7, im: 8 }, state)
    expect(state.connections.some((s) => s.id === vertex.id || s.id === `edge-${vertex.id}`)).toBe(
      false,
    )
  })

  it('does not treat independent arcs as contour closure or ordered contour additions', () => {
    let state = withMarkers()
    state = {
      ...state,
      vertices: [],
      segments: [],
      closed: false,
      selectedId: '',
      selectedSegmentId: '',
    }
    state = connect(state)
    const id = state.connections[0].id
    state = contourReducer(state, { type: 'setArc', id, through: { re: 1, im: 1 } })
    expect(canClose(state)).toBe(false)
    expect(contourReducer(state, { type: 'toggleClosed' }).closed).toBe(false)
    expect(buildContourGeometry(state).path).toBe('')
    expect(buildContourGeometry(state).segments).toHaveLength(1)
    const added = contourReducer(state, {
      type: 'add',
      vertex: { id: 'first', re: 7.123456789, im: 8 },
    })
    expect(added.vertices).toEqual([{ id: 'first', re: 7.123456789, im: 8 }])
    expect(added.segments).toEqual([])
    expect(added.connections).toBe(state.connections)
    expect(parseProject(serializeProject(added)).connections).toEqual(state.connections)
  })

  it.each([
    ['d', 'a'],
    ['a', 'd'],
  ])(
    'reuses and orients an independent %s→%s line when explicitly closing a chain',
    (startId, endId) => {
      const original = connect(connect(connect(withMarkers()), 'a', 'c'), 'a', 'm')
      const base = contourReducer(original, { type: 'deleteSegment', id: 'edge-d' })
      let state = connect(base, startId, endId)
      const id = state.selectedSegmentId
      state = contourReducer(state, { type: 'stroke', id, patch: { color: '#abcdef', width: 3 } })
      state = contourReducer(state, {
        type: 'label',
        target: { kind: 'segment', id },
        label: defaultLabel('C'),
      })
      state = contourReducer(state, {
        type: 'selectMany',
        source: 'marquee',
        items: [
          { kind: 'segment', id, part: 'label' },
          { kind: 'marker', id: 'm' },
        ],
      })
      const connection = findSegment(state, id)!
      expect(canClose(state)).toBe(true)
      expect(state.closed).toBe(false)
      expect(buildContourGeometry(state).path).toBe(buildContourGeometry(base).path)
      const history = historyReducer(createHistory(state), { type: 'toggleClosed' })
      const closed = history.present
      expect(closed.closed).toBe(true)
      expect(closed.error).toBe('')
      expect(closed.segments.at(-1)).toEqual({ ...connection, startId: 'd', endId: 'a' })
      expect(closed.segments.at(-1)?.style).toBe(connection.style)
      expect(closed.segments.at(-1)?.label).toBe(connection.label)
      expect(closed.connections).toEqual(original.connections)
      expect(closed.vertices).toBe(state.vertices)
      expect(closed.markers).toBe(state.markers)
      expect(closed.selection).toBe(state.selection)
      expect(closed.selectionSource).toBe('marquee')
      expect(closed.selectedSegmentId).toBe(id)
      expect(sceneSegments(closed).filter((s) => s.id === id)).toHaveLength(1)
      expect(buildContourGeometry(closed).path).toBe(buildContourGeometry(original).path)
      expect(history.past).toHaveLength(1)
      const restored = parseProject(serializeProject(closed))
      expect(restored.segments).toEqual(closed.segments)
      expect(restored.connections).toEqual(original.connections)
      expect(restored.closed).toBe(true)
      expect(historyReducer(history, { type: 'undo' }).present).toEqual(state)
    },
  )

  it('rejects conversion to duplicate lines atomically in either collection', () => {
    let state = connect(withMarkers(), 'a', 'c')
    const id = state.connections[0].id
    state = contourReducer(state, { type: 'setArc', id, through: { re: 0, im: 5 } })
    state = connect(state, 'a', 'c')
    const converted = contourReducer(state, { type: 'setLine', id })
    expect(converted.connections).toBe(state.connections)
    expect(converted.error).not.toBe('')
    let contourArc = contourReducer(withMarkers(), {
      type: 'setArc',
      id: 'edge-a',
      through: { re: 0, im: 1 },
    })
    contourArc = connect(contourArc, 'a', 'b')
    expect(contourReducer(contourArc, { type: 'setLine', id: 'edge-a' }).segments).toBe(
      contourArc.segments,
    )
  })
})

describe('connection selection and geometry', () => {
  it('resolves complete and visible scene geometry without exposing formulas as endpoints', () => {
    let state = connect(withMarkers())
    state = contourReducer(state, { type: 'addFormula', id: 'f', point: { re: 0, im: 0 } })
    state = contourReducer(state, { type: 'toggleClosed' })
    expect(scenePoints(state).map((p) => p.id)).toEqual(['a', 'b', 'c', 'd', 'm', 'n'])
    expect(findPoint(state, 'm')).toBe(state.markers[0])
    expect(findPoint(state, 'a')).toBe(state.vertices[0])
    expect(findPoint(state, 'f')).toBeUndefined()
    expect(findSegment(state, state.connections[0].id)).toBe(state.connections[0])
    expect(findSegment(state, 'edge-d')).toBe(state.segments[3])
    expect(findSegment(state, 'missing')).toBeUndefined()
    expect(sceneSegments(state)).toHaveLength(5)
    expect(visibleSceneSegments(state).map((s) => s.id)).toEqual([
      'edge-a',
      'edge-b',
      'edge-c',
      state.connections[0].id,
    ])
    expect(connect(state, 'f', 'm').connections).toBe(state.connections)
  })

  it('renders connections individually without adding them to the contour fill path', () => {
    const base = withMarkers()
    const next = connect(connect(base), 'a', 'c')
    const geometry = buildContourGeometry(next)
    expect(geometry.path).toBe(buildContourGeometry(base).path)
    expect(geometry.segments).toHaveLength(6)
    expect(geometry.segments[4].path).toBe('M 400 300 L 480 300')
    const opened = contourReducer(next, { type: 'toggleClosed' })
    expect(buildContourGeometry(opened).segments).toHaveLength(5)
  })

  it('uses marker endpoints for connection anchors, marquee bounds and arc fitting', () => {
    const base = connect(withMarkers())
    const id = base.connections[0].id
    expect(itemAnchor(base, { kind: 'segment', id })).toEqual({ x: 440, y: 300 })
    expect(selectionBounds(base, [{ kind: 'segment', id }])).toMatchObject({
      left: 394,
      right: 486,
    })
    expect(itemsWithinRect(base, { left: 393, right: 487, top: 293, bottom: 307 })).toContainEqual({
      kind: 'segment',
      id,
    })
    const curved = contourReducer(base, { type: 'setArc', id, through: { re: 1, im: 20 } })
    expect(canProjectScene(curved, curved.viewport)).toBe(true)
    const fit = fitScene(curved)!
    expect(fit.centerIm).toBeGreaterThan(5)
    expect(fit.scaleX).toBeLessThan(25)
    expect(buildContourGeometry(curved).segments.at(-1)?.arc).toBeDefined()
  })

  it('applies stroke and label styles to selected connections in document history', () => {
    let state = connect(withMarkers())
    const id = state.connections[0].id
    state = contourReducer(state, {
      type: 'label',
      target: { kind: 'segment', id },
      label: defaultLabel('s'),
    })
    state = contourReducer(state, { type: 'selectMany', items: [{ kind: 'segment', id }] })
    expect(state.selection).toEqual({ kind: 'segment', id })
    let history = historyReducer(createHistory(state), {
      type: 'selectionStyle',
      patch: { color: '#123456', width: 4 },
    })
    expect(history.present.connections[0].style).toMatchObject({ color: '#123456', width: 4 })
    expect(itemColor(history.present, { kind: 'segment', id })).toBe('#123456')
    expect(history.past).toHaveLength(1)
    history = historyReducer(history, {
      type: 'selectObject',
      selection: { kind: 'segment', id, part: 'label' },
    })
    history = historyReducer(history, {
      type: 'selectionStyle',
      patch: { color: '#abcdef', labelSize: 30 },
    })
    expect(history.present.connections[0].label).toMatchObject({ color: '#abcdef', size: 30 })
  })

  it('rejects invalid connection labels so accepted appearance edits can be reloaded', () => {
    const state = connect(withMarkers())
    const id = state.connections[0].id
    const invalid = contourReducer(state, {
      type: 'label',
      target: { kind: 'segment', id },
      label: defaultLabel('\\frac{'),
    })
    expect(invalid.connections).toBe(state.connections)
    expect(invalid.error).not.toBe('')
    expect(() => parseProject(serializeProject(invalid))).not.toThrow()
  })

  it('translates shared marker and vertex endpoints once and keeps arc through points rigid', () => {
    let state = connect(connect(withMarkers()), 'a', 'm')
    const id = state.connections[0].id
    state = contourReducer(state, { type: 'setArc', id, through: { re: 1, im: 1 } })
    state = contourReducer(state, {
      type: 'selectMany',
      source: 'marquee',
      items: [
        { kind: 'segment', id },
        { kind: 'segment', id: state.connections[1].id },
        { kind: 'marker', id: 'm' },
      ],
    })
    expect(translationAnchor(state)).toMatchObject({ re: 0, im: 0 })
    const moved = contourReducer(state, {
      type: 'translateSelection',
      from: state,
      delta: { re: 1, im: 2 },
    })
    expect(moved.markers.map(({ re, im }) => ({ re, im }))).toEqual([
      { re: 1, im: 2 },
      { re: 3, im: 2 },
    ])
    expect(moved.vertices[0]).toMatchObject({ re: -3, im: 2 })
    expect(moved.connections[0]).toMatchObject({ through: { re: 2, im: 3 } })
    expect(moved.selectionSource).toBe('marquee')
    expect(parseProject(serializeProject(moved)).connections).toEqual(moved.connections)
  })

  it('deletes only independent edges and cleans incident connections for every point removal path', () => {
    const base = connect(connect(withMarkers()), 'a', 'm')
    const edgeOnly = contourReducer(base, { type: 'deleteSegment', id: base.connections[0].id })
    expect(edgeOnly.segments).toBe(base.segments)
    expect(edgeOnly.closed).toBe(true)
    expect(edgeOnly.connections).toHaveLength(1)
    const noMarker = contourReducer(base, { type: 'removeObject', kind: 'marker', id: 'm' })
    expect(noMarker.connections).toEqual([])
    expect(sceneSegments(noMarker).some((s) => s.id === noMarker.selectedSegmentId)).toBe(true)
    for (const item of [
      { kind: 'vertex', id: 'a' },
      { kind: 'marker', id: 'm' },
      { kind: 'contour' },
    ] as const) {
      const selected = contourReducer(base, { type: 'selectMany', items: [item] })
      const deleted = contourReducer(selected, { type: 'deleteSelection' })
      expect(deleted.connections).toHaveLength(item.kind === 'marker' ? 0 : 1)
      expect(() => parseProject(serializeProject(deleted))).not.toThrow()
    }
  })
})

describe('connection persistence', () => {
  it('writes v1 without connections, v2 with connections, and omits selection metadata', () => {
    const legacy = JSON.parse(serializeProject(createInitialState())) as ProjectFile
    expect(legacy.version).toBe(1)
    expect(legacy.document).not.toHaveProperty('connections')
    expect(parseProject(JSON.stringify(legacy)).connections).toEqual([])
    const state = connect(withMarkers())
    const project = JSON.parse(serializeProject(state)) as ProjectFile
    expect(project.version).toBe(2)
    expect(project.document.connections).toEqual(state.connections)
    expect(project.document).not.toHaveProperty('selection')
    expect(project.document).not.toHaveProperty('selectionSource')
    project.version = 1
    expect(() => parseProject(JSON.stringify(project))).toThrow(/2/)
  })

  it('validates connection endpoints, duplicate unordered lines, global IDs, arcs and styles', () => {
    const raw = serializeProject(connect(withMarkers()))
    const mutations: ((project: ProjectFile) => void)[] = [
      (p) => {
        p.document.connections![0].startId = 'missing'
      },
      (p) => {
        p.document.connections![0].endId = 'm'
      },
      (p) => {
        p.document.connections![0].id = 'a'
      },
      (p) => {
        p.document.connections!.push({ id: 'duplicate', kind: 'line', startId: 'n', endId: 'm' })
      },
      (p) => {
        p.document.connections!.push({ id: 'duplicate', kind: 'line', startId: 'b', endId: 'a' })
      },
      (p) => {
        p.document.connections![0] = {
          ...p.document.connections![0],
          kind: 'arc',
          through: { re: 1, im: 0 },
        }
      },
      (p) => {
        p.document.connections![0].style = { width: 20 }
      },
      (p) => {
        p.document.connections![0].label = defaultLabel('\\frac{')
      },
      (p) => {
        p.document.markers[1].re = 0
      },
      (p) => {
        p.document.segments.push({ id: 'branch', kind: 'line', startId: 'a', endId: 'c' })
      },
    ]
    for (const mutate of mutations) {
      const project = JSON.parse(raw) as ProjectFile
      mutate(project)
      expect(() => parseProject(JSON.stringify(project))).toThrow()
    }
  })

  it('accepts v2 without connections and still rejects branched contour topology', () => {
    const project = JSON.parse(serializeProject(createInitialState())) as ProjectFile
    project.version = 2
    expect(parseProject(JSON.stringify(project)).connections).toEqual([])
    project.document.segments[1].startId = 'a'
    expect(() => parseProject(JSON.stringify(project))).toThrow()
  })

  it('rejects a connection edit beyond the reader capacity atomically', () => {
    const base = withMarkers()
    const state: ContourState = {
      ...base,
      connections: Array.from({ length: 2000 }, (_, i) => ({
        id: `connection-${i}`,
        kind: 'arc',
        startId: 'm',
        endId: 'n',
        through: { re: 1, im: 1 },
      })),
    }
    expect(() => parseProject(serializeProject(state))).not.toThrow()
    const edited = connect(state, 'a', 'm')
    expect(edited.connections).toBe(state.connections)
    expect(edited.error).toContain('2000')
    const project = JSON.parse(serializeProject(state)) as ProjectFile
    project.document.connections!.push({ id: 'extra', kind: 'line', startId: 'a', endId: 'm' })
    expect(() => parseProject(JSON.stringify(project))).toThrow(/2000/)
  })
})
