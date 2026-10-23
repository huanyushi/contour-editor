import { describe, expect, it } from 'vitest'
import { parseProject, serializeProject } from '../project/project'
import { projectSceneError } from '../project/validation'
import { MAX_MARKERS } from '../project/format'
import { defaultLabel, defaultPointStyle } from './appearance'
import { createHistory, historyReducer } from './history'
import { contourReducer, createInitialState, type ContourState } from './model'
import { buildContourGeometry } from './scene/pathGeometry'
import { resolvedScene } from './scene/sceneObjects'
import { avoidanceSourceIds } from './avoidance/avoidanceDependencies'

function openChain(): ContourState {
  return {
    ...createInitialState(),
    vertices: [
      { id: 'a', re: -3, im: 0 },
      { id: 'b', re: -1, im: 0 },
      { id: 'c', re: 1, im: 0 },
      { id: 'd', re: 1, im: 2 },
    ],
    segments: [
      { id: 'ab', kind: 'line', startId: 'a', endId: 'b' },
      { id: 'bc', kind: 'line', startId: 'b', endId: 'c' },
      { id: 'cd', kind: 'line', startId: 'c', endId: 'd' },
    ],
    selectedId: 'd',
    selection: { kind: 'vertex', id: 'd' },
    closed: false,
  }
}

describe('closing an open contour at an existing vertex', () => {
  it('closes at the first point without duplicating endpoints', () => {
    const before = openChain()
    const after = contourReducer(before, { type: 'closeAtVertex', id: 'a' })
    expect(after.error).toBe('')
    expect(after.closed).toBe(true)
    expect(after.vertices).toEqual(before.vertices)
    expect(after.segments.map((s) => [s.startId, s.endId])).toEqual([
      ['a', 'b'],
      ['b', 'c'],
      ['c', 'd'],
      ['d', 'a'],
    ])
    expect(after.connections).toEqual([])
    expect(buildContourGeometry(after).path).toMatch(/ Z$/)
  })

  it('fills only the suffix loop and preserves the prefix as an independent connection', () => {
    const before = openChain()
    before.vertices[0].pointStyle = { color: '#123456', radius: 6 }
    before.vertices[2].label = { ...defaultLabel('C'), dx: 30 }
    before.segments[0].style = { color: '#654321', width: 3 }
    before.segments[0].label = defaultLabel('tail')
    const after = contourReducer(before, { type: 'closeAtVertex', id: 'b' })
    expect(after.error).toBe('')
    expect(after.closed).toBe(true)
    expect(after.vertices.map((v) => v.id)).toEqual(['b', 'c', 'd'])
    expect(after.segments.map((s) => [s.startId, s.endId])).toEqual([
      ['b', 'c'],
      ['c', 'd'],
      ['d', 'b'],
    ])
    expect(after.connections).toEqual([before.segments[0]])
    expect(after.markers).toEqual([{ ...before.vertices[0], label: defaultLabel('z_{1}') }])
    expect(after.vertices.map((v) => v.label?.tex)).toEqual(['z_{2}', 'C', 'z_{4}'])
    expect(after.vertices[1].label).toEqual(before.vertices[2].label)
    expect(after.selection).toEqual({ kind: 'vertex', id: 'b' })
    expect(buildContourGeometry(after).path).toBe('M 360 300 L 440 300 L 440 220 L 360 300 Z')
    const parsed = parseProject(serializeProject(after))
    expect(parsed.vertices).toEqual(after.vertices)
    expect(parsed.connections).toEqual(after.connections)
    expect(parsed.markers).toEqual(after.markers)
    expect(JSON.parse(serializeProject(after)).version).toBe(2)
    expect(before.vertices.map((v) => v.label?.tex)).toEqual([undefined, undefined, 'C', undefined])
  })

  it('records closure and prefix conversion in one undoable step', () => {
    const before = openChain()
    let history = historyReducer(createHistory(before), { type: 'closeAtVertex', id: 'b' })
    const closed = history.present
    expect(closed.closed).toBe(true)
    expect(history.past).toHaveLength(1)
    history = historyReducer(history, { type: 'undo' })
    expect(history.present).toEqual(before)
    history = historyReducer(history, { type: 'redo' })
    expect(history.present).toEqual(closed)
  })

  it('uses stable IDs rather than array adjacency to find the suffix', () => {
    const before = openChain()
    before.vertices = [
      before.vertices[2],
      before.vertices[0],
      before.vertices[3],
      before.vertices[1],
    ]
    before.segments = [before.segments[2], before.segments[0], before.segments[1]]
    const after = contourReducer(before, { type: 'closeAtVertex', id: 'b' })
    expect(after.closed).toBe(true)
    expect(after.segments.map((s) => [s.startId, s.endId])).toEqual([
      ['b', 'c'],
      ['c', 'd'],
      ['d', 'b'],
    ])
    expect(after.vertices.find((v) => v.id === 'b')?.label?.tex).toBe('z_{4}')
    expect(after.markers.find((v) => v.id === 'a')?.label.tex).toBe('z_{2}')
    expect(() => parseProject(serializeProject(after))).not.toThrow()
  })

  it('restores the retained closing edge unchanged when clicking the original start', () => {
    const before = openChain()
    before.segments.push({
      id: 'da',
      kind: 'arc',
      startId: 'd',
      endId: 'a',
      through: { re: -2, im: 3 },
      label: defaultLabel('closing'),
      style: { color: '#ff0000' },
    })
    const after = contourReducer(before, { type: 'closeAtVertex', id: 'a' })
    expect(after.closed).toBe(true)
    expect(after.segments).toEqual(before.segments)
  })

  it('discards only the hidden closing edge when closing at a middle point', () => {
    const before = openChain()
    before.segments.push({ id: 'da', kind: 'line', startId: 'd', endId: 'a' })
    const after = contourReducer(before, { type: 'closeAtVertex', id: 'b' })
    expect(after.closed).toBe(true)
    expect(after.segments.some((s) => s.id === 'da')).toBe(false)
    expect(after.connections.map((s) => s.id)).toEqual(['ab'])
  })

  it('preserves an independent chord when restoring a retained closing arc', () => {
    const before = openChain()
    before.segments.push({
      id: 'da',
      kind: 'arc',
      startId: 'd',
      endId: 'a',
      through: { re: -2, im: 3 },
    })
    before.connections = [
      {
        id: 'chord',
        kind: 'line',
        startId: 'd',
        endId: 'a',
        label: defaultLabel('chord'),
      },
    ]
    expect(projectSceneError(before)).toBe('')
    const after = contourReducer(before, { type: 'closeAtVertex', id: 'a' })
    expect(after.error).toBe('')
    expect(after.closed).toBe(true)
    expect(after.segments).toEqual(before.segments)
    expect(after.connections).toEqual(before.connections)
    expect(parseProject(serializeProject(after)).connections).toEqual(before.connections)
  })

  it('reuses an existing closing connection, including reversed direction and bindings', () => {
    const before = openChain()
    before.connections = [
      {
        id: 'db',
        kind: 'line',
        startId: 'b',
        endId: 'd',
        style: { color: '#ff0000' },
        label: defaultLabel('closing'),
      },
    ]
    before.markers = [
      {
        id: 'pole',
        re: 0,
        im: 1,
        mathematicalKind: 'isolated',
        label: defaultLabel('p'),
        pointStyle: defaultPointStyle(),
      },
    ]
    before.avoidances = [
      {
        id: 'avoid',
        markerId: 'pole',
        targetSegmentId: 'db',
        radius: 0.2,
        side: 'left',
        openingRatio: 0.5,
      },
    ]
    before.connections[0].pieces = [
      {
        startAvoidanceId: null,
        endAvoidanceId: 'avoid',
        style: { color: '#123456' },
        label: defaultLabel('before'),
      },
    ]
    expect(projectSceneError(before)).toBe('')
    const after = contourReducer(before, { type: 'closeAtVertex', id: 'b' })
    expect(after.error).toBe('')
    expect(after.closed).toBe(true)
    expect(after.connections.map((s) => s.id)).toEqual(['ab'])
    expect(after.segments.at(-1)).toEqual({
      ...before.connections[0],
      startId: 'd',
      endId: 'b',
      pieces: [
        { ...before.connections[0].pieces[0], startAvoidanceId: 'avoid', endAvoidanceId: null },
      ],
    })
    expect(after.avoidances).toEqual([{ ...before.avoidances[0], side: 'right' }])
    expect(() => parseProject(serializeProject(after))).not.toThrow()
  })

  it('keeps a prefix arc and its avoidance linked after conversion to an independent connection', () => {
    const before = openChain()
    before.segments[0] = { ...before.segments[0], kind: 'arc', through: { re: -2, im: 1 } }
    before.markers = [
      {
        id: 'pole',
        re: -2,
        im: 1,
        mathematicalKind: 'isolated',
        label: defaultLabel('p'),
        pointStyle: defaultPointStyle(),
      },
    ]
    before.avoidances = [
      {
        id: 'avoid',
        markerId: 'pole',
        targetSegmentId: 'ab',
        radius: 0.2,
        side: 'left',
        openingRatio: 0.5,
      },
    ]
    expect(projectSceneError(before)).toBe('')
    const after = contourReducer(before, { type: 'closeAtVertex', id: 'b' })
    expect(after.error).toBe('')
    expect(after.closed).toBe(true)
    expect(after.connections).toEqual([before.segments[0]])
    expect(after.avoidances).toEqual(before.avoidances)
    expect(resolvedScene(after).connectionSegments.length).toBeGreaterThan(1)
    expect(() => parseProject(serializeProject(after))).not.toThrow()
  })

  it('keeps the original document when closure would remove a hidden source needed by an avoidance', () => {
    const before = openChain()
    before.segments.push({ id: 'da', kind: 'line', startId: 'd', endId: 'a' })
    before.markers = [
      {
        id: 'pole',
        re: -1,
        im: 1,
        mathematicalKind: 'isolated',
        label: defaultLabel('p'),
        pointStyle: defaultPointStyle(),
      },
    ]
    before.avoidances = [
      {
        id: 'avoid',
        markerId: 'pole',
        targetSegmentId: 'da',
        radius: 0.2,
        side: 'left',
        openingRatio: 0.5,
      },
    ]
    expect(projectSceneError(before)).toBe('')
    const after = contourReducer(before, { type: 'closeAtVertex', id: 'b' })
    expect(after.closed).toBe(false)
    expect(after.error).not.toBe('')
    expect(after.vertices).toBe(before.vertices)
    expect(after.segments).toBe(before.segments)
    expect(after.avoidances).toEqual(before.avoidances)
  })

  it('allows a two-point curved loop but not straight backtracking or a collinear suffix', () => {
    const before = openChain()
    const straight = contourReducer(before, { type: 'closeAtVertex', id: 'c' })
    expect(straight.closed).toBe(false)
    expect(straight.segments).toBe(before.segments)
    before.segments[2] = { ...before.segments[2], kind: 'arc', through: { re: 2, im: 1 } }
    const curved = contourReducer(before, { type: 'closeAtVertex', id: 'c' })
    expect(curved.closed).toBe(true)
    expect(curved.vertices.map((v) => v.id)).toEqual(['c', 'd'])
    const collinear = openChain()
    collinear.vertices[3] = { id: 'd', re: 2, im: 0 }
    expect(contourReducer(collinear, { type: 'closeAtVertex', id: 'b' }).closed).toBe(false)
  })

  it('does not change geometry for a last-point click, a missing point or an already closed contour', () => {
    const before = openChain()
    for (const id of ['d', 'missing']) {
      const after = contourReducer(before, { type: 'closeAtVertex', id })
      expect(after.vertices).toBe(before.vertices)
      expect(after.segments).toBe(before.segments)
      expect(after.closed).toBe(false)
    }
    const closed = createInitialState()
    const after = contourReducer(closed, { type: 'closeAtVertex', id: 'b' })
    expect(after.segments).toBe(closed.segments)
    expect(after.closed).toBe(true)
  })

  it('refuses disconnected chains without dropping any component', () => {
    const before = openChain()
    before.segments = before.segments.filter((s) => s.id !== 'ab')
    const after = contourReducer(before, { type: 'closeAtVertex', id: 'b' })
    expect(after.error).not.toBe('')
    expect(after.vertices).toBe(before.vertices)
    expect(after.segments).toBe(before.segments)
  })

  it('allocates a closing edge without colliding with an existing object ID', () => {
    const before = openChain()
    before.markers = [
      {
        id: 'edge-close',
        re: 5,
        im: 5,
        label: defaultLabel(),
        pointStyle: defaultPointStyle(),
      },
    ]
    const after = contourReducer(before, { type: 'closeAtVertex', id: 'b' })
    expect(after.closed).toBe(true)
    expect(after.segments.at(-1)?.id).not.toBe('edge-close')
    expect(() => parseProject(serializeProject(after))).not.toThrow()
  })

  it('keeps all tail segments and default labels when closing a reversed chain', () => {
    const source = openChain()
    source.vertices[0].im = -2
    const before = contourReducer(source, { type: 'reverse' })
    const after = contourReducer(before, { type: 'closeAtVertex', id: 'c' })
    expect(after.error).toBe('')
    expect(after.closed).toBe(true)
    expect(after.segments.map((s) => [s.startId, s.endId])).toEqual([
      ['c', 'b'],
      ['b', 'a'],
      ['a', 'c'],
    ])
    expect(after.connections.map((s) => [s.startId, s.endId])).toEqual([['d', 'c']])
    expect(after.vertices.map((v) => v.label?.tex)).toEqual(['z_{2}', 'z_{3}', 'z_{4}'])
    expect(after.markers[0].label.tex).toBe('z_{1}')
  })

  it('rejects prefix conversion atomically when the independent-point capacity is full', () => {
    const before = openChain()
    before.markers = Array.from({ length: MAX_MARKERS }, (_, i) => ({
      id: `marker-${i}`,
      re: i + 10,
      im: 10,
      label: defaultLabel(),
      pointStyle: defaultPointStyle(),
    }))
    expect(projectSceneError(before)).toBe('')
    const history = historyReducer(createHistory(before), { type: 'closeAtVertex', id: 'b' })
    expect(history.present.error).not.toBe('')
    expect(history.present.closed).toBe(false)
    expect(history.present.vertices).toBe(before.vertices)
    expect(history.present.connections).toBe(before.connections)
    expect(history.present.markers).toBe(before.markers)
    expect(history.past).toEqual([])
  })

  it('rejects closure that silently moves a cross-corner corridor to a new source edge', () => {
    const before = openChain()
    before.vertices = [
      { id: 'a', re: -3, im: 0 },
      { id: 'b', re: 0, im: 0 },
      { id: 'c', re: 3, im: 0 },
      { id: 'd', re: -3, im: 3 },
    ]
    before.markers = [
      {
        id: 'pole',
        re: 0,
        im: 1,
        mathematicalKind: 'isolated',
        label: defaultLabel('p'),
        pointStyle: defaultPointStyle(),
      },
    ]
    before.avoidances = [
      {
        id: 'avoid',
        kind: 'corridor',
        markerId: 'pole',
        radius: 0.1,
        gap: 0.04,
        anchor: { kind: 'vertex', vertexId: 'b', segmentId: 'bc' },
      },
    ]
    before.segments[0].pieces = [
      {
        startAvoidanceId: null,
        endAvoidanceId: 'avoid',
        style: { color: '#ff0000' },
        label: defaultLabel('tail'),
      },
    ]
    expect(projectSceneError(before)).toBe('')
    expect(avoidanceSourceIds(before, 'avoid')).toEqual(['ab', 'bc'])
    expect(resolvedScene(before).labels.some((l) => l.value.tex === 'tail')).toBe(true)
    const history = historyReducer(createHistory(before), { type: 'closeAtVertex', id: 'b' })
    const after = history.present
    expect(after.error).not.toBe('')
    expect(after.closed).toBe(false)
    expect(after.vertices).toBe(before.vertices)
    expect(after.segments).toBe(before.segments)
    expect(after.connections).toBe(before.connections)
    expect(after.avoidances).toBe(before.avoidances)
    expect(avoidanceSourceIds(after, 'avoid')).toEqual(['ab', 'bc'])
    expect(resolvedScene(after).labels.some((l) => l.value.tex === 'tail')).toBe(true)
    expect(history.past).toEqual([])
  })

  it('preserves a corridor entirely on a prefix segment without rejecting safe closure', () => {
    const before = openChain()
    before.markers = [
      {
        id: 'pole',
        re: -2,
        im: 1,
        mathematicalKind: 'isolated',
        label: defaultLabel('p'),
        pointStyle: defaultPointStyle(),
      },
    ]
    before.avoidances = [
      {
        id: 'avoid',
        kind: 'corridor',
        markerId: 'pole',
        radius: 0.1,
        gap: 0.04,
        anchor: { kind: 'segment', segmentId: 'ab', t: 0.5 },
      },
    ]
    before.segments[0].pieces = [
      {
        startAvoidanceId: null,
        endAvoidanceId: 'avoid',
        style: { color: '#ff0000' },
        label: defaultLabel('tail'),
      },
    ]
    expect(projectSceneError(before)).toBe('')
    const after = contourReducer(before, { type: 'closeAtVertex', id: 'b' })
    expect(after.error).toBe('')
    expect(after.closed).toBe(true)
    expect(avoidanceSourceIds(after, 'avoid')).toEqual(['ab'])
    expect(after.connections).toEqual([before.segments[0]])
    expect(resolvedScene(after).labels.find((l) => l.value.tex === 'tail')).toEqual(
      resolvedScene(before).labels.find((l) => l.value.tex === 'tail'),
    )
    expect(parseProject(serializeProject(after)).avoidances).toEqual(before.avoidances)
  })
})
