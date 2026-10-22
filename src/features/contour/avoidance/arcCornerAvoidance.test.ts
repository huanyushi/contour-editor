import { describe, expect, it } from 'vitest'
import { arcThrough } from '../../../lib/arc'
import { parseProject, serializeProject } from '../../project/project'
import { defaultLabel, defaultPointStyle } from '../appearance'
import { contourReducer, createInitialState, type ContourState } from '../model'
import { resolveScene } from '../scene/resolvedScene'
import { validateAvoidances } from './avoidanceValidation'
import { constructAvoidance } from './avoidanceConstruction'
import { createHistory, historyReducer } from '../history'
import { translationSources } from './avoidanceSelection'
import { segmentOrigin } from '../scene/sceneObjects'
import { buildContourGeometry } from '../scene/pathGeometry'
import { isLegacyAvoidance, type LegacyAvoidance } from './avoidanceTypes'

function arcFixture(): ContourState & { avoidances: LegacyAvoidance[] } {
  return {
    ...createInitialState(),
    closed: false,
    vertices: [
      { id: 'a', re: -3, im: 0 },
      { id: 'b', re: 3, im: 0 },
    ],
    segments: [{ id: 'upper', kind: 'arc', startId: 'a', endId: 'b', through: { re: 0, im: 3 } }],
    markers: [
      {
        id: 'pole',
        re: 0,
        im: 3,
        mathematicalKind: 'pole',
        label: defaultLabel('p'),
        pointStyle: defaultPointStyle(),
      },
    ],
    avoidances: [
      {
        id: 'cut',
        markerId: 'pole',
        targetSegmentId: 'upper',
        radius: 0.5,
        side: 'right',
        openingRatio: 0.5,
      },
    ],
  }
}

function cornerFixture(): ContourState & { avoidances: LegacyAvoidance[] } {
  const state = createInitialState()
  return {
    ...state,
    vertices: [
      { id: 'a', re: 0, im: 2 },
      { id: 'b', re: 0, im: 0, mathematicalKind: 'pole' },
      { id: 'c', re: 3, im: 0 },
      { id: 'd', re: 3, im: 2 },
    ],
    avoidances: [
      {
        id: 'corner',
        markerId: 'b',
        targetSegmentId: 'edge-a',
        exitSegmentId: 'edge-b',
        radius: 0.5,
        side: 'left',
        openingRatio: 0.5,
      },
    ],
  }
}

describe('source arc and shared corner integration', () => {
  it('cuts a radius-3 source arc at true circle intersections and retains real source arcs', () => {
    const state = arcFixture()
    const result = validateAvoidances(state)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const chain = result.scene.chains.get('upper')!
    expect(chain.map((s) => s.kind)).toEqual(['arc', 'arc', 'arc'])
    const detour = chain[1]
    for (const id of [detour.startId, detour.endId]) {
      const p = result.scene.points.get(id)!
      expect(Math.hypot(p.re, p.im)).toBeCloseTo(3, 12)
      expect(Math.hypot(p.re, p.im - 3)).toBeCloseTo(0.5, 12)
      expect(p.im).toBeCloseTo(71 / 24, 12)
    }
    for (const s of [chain[0], chain[2]]) {
      if (s.kind !== 'arc') throw new Error('source fragment lost its circle')
      const fit = arcThrough(
        result.scene.points.get(s.startId)!,
        result.scene.points.get(s.endId)!,
        s.through,
      )
      expect(fit.ok).toBe(true)
      if (fit.ok) {
        expect(fit.arc.radius).toBeCloseTo(3, 12)
        expect(fit.arc.sweep).toBeLessThan(0)
      }
    }
    expect(state.vertices).toHaveLength(2)
    expect(state.segments).toHaveLength(1)
    expect(contourReducer(state, { type: 'removeAvoidance', id: 'cut' }).segments).toBe(
      state.segments,
    )
  })

  it.each(['left', 'right'] as const)(
    'stitches the %s corner arc into a closed path without visiting the old corner',
    (side) => {
      const state = cornerFixture()
      state.avoidances[0].side = side
      const result = validateAvoidances(state)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      const segments = result.scene.contourSegments
      expect(segments).toHaveLength(5)
      for (let i = 0; i < segments.length; i++)
        expect(segments[i].endId).toBe(segments[(i + 1) % segments.length].startId)
      expect(segments.some((s) => s.startId === 'b' || s.endId === 'b')).toBe(false)
      const incoming = result.scene.chains.get('edge-a')!
      const outgoing = result.scene.chains.get('edge-b')!
      expect(incoming.at(-1)!.endId).toBe(outgoing[0].startId)
      const s = incoming.at(-1)!
      if (s.kind !== 'arc') throw new Error('missing corner arc')
      const fit = arcThrough(
        result.scene.points.get(s.startId)!,
        result.scene.points.get(s.endId)!,
        s.through,
      )
      expect(fit.ok).toBe(true)
      if (fit.ok)
        expect(Math.abs(fit.arc.sweep)).toBeCloseTo(
          side === 'left' ? Math.PI / 2 : (3 * Math.PI) / 2,
        )
      const restored = contourReducer(state, { type: 'removeAvoidance', id: 'corner' })
      expect(restored.error).toBe('')
      expect(restored.vertices).toBe(state.vertices)
      expect(resolveScene(restored).ok).toBe(true)
    },
  )

  it('round trips a semantic source vertex and both corner references as v3', () => {
    const state = cornerFixture()
    const text = serializeProject(state)
    expect(JSON.parse(text).version).toBe(3)
    const loaded = parseProject(text)
    expect(loaded.vertices[1].mathematicalKind).toBe('pole')
    expect(loaded.avoidances[0].exitSegmentId).toBe('edge-b')
    expect(validateAvoidances(loaded).ok).toBe(true)
    const semanticOnly = { ...state, avoidances: [] }
    expect(JSON.parse(serializeProject(semanticOnly)).version).toBe(3)
  })

  it('uses the same mathematical-kind action for vertices without duplicating points or binding', () => {
    let state: ContourState = cornerFixture()
    state.avoidances = []
    state.vertices[1].mathematicalKind = 'ordinary'
    state = contourReducer(state, { type: 'mathematicalKind', id: 'b', value: 'branch' })
    expect(state.error).toBe('')
    expect(state.vertices[1].mathematicalKind).toBe('branch')
    expect(state.markers).toHaveLength(0)
    expect(state.avoidances).toHaveLength(0)
    const reused = contourReducer(state, {
      type: 'addMarker',
      id: 'duplicate',
      point: { re: 0, im: 0 },
    })
    expect(reused.selection).toEqual({ kind: 'vertex', id: 'b' })
    expect(reused.markers).toHaveLength(0)
  })

  it('reverses corner dependencies, branch, and entry/exit appearance atomically', () => {
    const state = cornerFixture()
    state.avoidances[0].partStyles = { entry: { color: '#ff0000' }, exit: { width: 3 } }
    state.avoidances[0].partLabels = { entry: defaultLabel('in'), exit: defaultLabel('out') }
    const reversed = contourReducer(state, { type: 'reverse' })
    expect(reversed.error).toBe('')
    expect(reversed.avoidances[0]).toMatchObject({
      targetSegmentId: 'edge-b',
      exitSegmentId: 'edge-a',
      side: 'right',
      partStyles: { entry: { width: 3 }, exit: { color: '#ff0000' } },
      partLabels: { entry: { tex: 'out' }, exit: { tex: 'in' } },
    })
    expect(validateAvoidances(reversed).ok).toBe(true)
    expect(contourReducer(reversed, { type: 'reverse' }).avoidances).toEqual(state.avoidances)
  })

  it.each(['edge-a', 'edge-b', 'vertex'] as const)(
    'cleans a corner binding when deleting dependency %s',
    (id) => {
      const state = cornerFixture()
      state.selectedId = 'b'
      state.selection = { kind: 'segment', id: 'avoid:corner:arc' }
      const next = contourReducer(
        state,
        id === 'vertex' ? { type: 'delete' } : { type: 'deleteSegment', id },
      )
      expect(next.error).toBe('')
      expect(next.avoidances).toHaveLength(0)
      expect(next.selection).toEqual({ kind: 'none' })
    },
  )

  it('collects both corner sources once and does not recursively move the whole graph', () => {
    const state = cornerFixture()
    const sources = translationSources(state, [
      { kind: 'segment', id: 'avoid:corner:arc' },
      { kind: 'vertex', id: 'b' },
    ])
    expect([...sources.pointIds].sort()).toEqual(['a', 'b', 'c'])
    expect([...sources.segmentIds].sort()).toEqual(['edge-a', 'edge-b'])
    state.selection = { kind: 'segment', id: 'avoid:corner:arc' }
    const moved = contourReducer(state, {
      type: 'translateSelection',
      from: state,
      delta: { re: 1, im: 1 },
    })
    expect(moved.error).toBe('')
    expect(moved.vertices.map((p) => [p.re, p.im])).toEqual([
      [1, 3],
      [1, 1],
      [4, 1],
      [3, 2],
    ])
  })

  it('groups radius edits and shared translations into one history step and cancels exactly', () => {
    const state = cornerFixture()
    state.selection = { kind: 'segment', id: 'avoid:corner:arc' }
    let h = historyReducer(createHistory(state), { type: 'beginGesture', owner: 'canvas' })
    h = historyReducer(h, { type: 'translateSelection', from: state, delta: { re: 0.2, im: 0.2 } })
    h = historyReducer(h, { type: 'translateSelection', from: state, delta: { re: 0.4, im: 0.4 } })
    expect(h.present.error).toBe('')
    expect(h.present.vertices[2]).toMatchObject({ re: 3.4, im: 0.4 })
    expect(h.past).toHaveLength(0)
    const canceled = historyReducer(h, { type: 'cancelGesture', owner: 'canvas' })
    expect(canceled.present).toEqual(state)
    h = historyReducer(h, { type: 'endGesture', owner: 'canvas' })
    expect(h.past).toHaveLength(1)
    expect(historyReducer(h, { type: 'undo' }).present.vertices).toEqual(state.vertices)
    let radius = historyReducer(createHistory(state), { type: 'beginGesture' })
    radius = historyReducer(radius, {
      type: 'updateAvoidance',
      id: 'corner',
      patch: { radius: 0.6 },
    })
    radius = historyReducer(radius, {
      type: 'updateAvoidance',
      id: 'corner',
      patch: { radius: 0.7 },
    })
    expect(radius.present.avoidances[0].radius).toBe(0.7)
    expect(historyReducer(radius, { type: 'cancelGesture' }).present).toEqual(state)
    expect(historyReducer(radius, { type: 'endGesture' }).past).toHaveLength(1)
  })

  it.each(['incoming', 'outgoing'] as const)(
    'does not trim the visible neighbor when the %s source is hidden',
    (which) => {
      const state = cornerFixture()
      const closing = which === 'incoming' ? 'edge-a' : 'edge-b'
      state.segments = [
        ...state.segments.filter((s) => s.id !== closing),
        state.segments.find((s) => s.id === closing)!,
      ]
      state.closed = false
      const result = validateAvoidances(state)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.scene.contourSegments).toHaveLength(3)
      expect(result.scene.contourSegments.every((s) => s.origin.kind === 'source')).toBe(true)
      expect(result.scene.points.size).toBe(4)
      expect(segmentOrigin(state, 'avoid:corner:arc')).toMatchObject({
        kind: 'avoidance',
        sourceSegmentId: 'edge-a',
      })
    },
  )

  it.each(['incoming', 'outgoing'] as const)(
    'rejects regular binding contact with the corner occupancy on the %s source',
    (which) => {
      const state = cornerFixture()
      state.markers.push({
        id: 'other',
        re: which === 'incoming' ? 0 : 0.75,
        im: which === 'incoming' ? 0.75 : 0,
        mathematicalKind: 'pole',
        label: defaultLabel('q'),
        pointStyle: defaultPointStyle(),
      })
      const next = contourReducer(state, {
        type: 'addAvoidance',
        avoidance: {
          id: 'other-cut',
          markerId: 'other',
          targetSegmentId: which === 'incoming' ? 'edge-a' : 'edge-b',
          radius: 0.25,
          side: 'left',
          openingRatio: 0.5,
        },
      })
      expect(next.error).toMatch(/重叠|接近/)
      expect(next.avoidances).toBe(state.avoidances)
      expect(next.vertices).toBe(state.vertices)
    },
  )

  it('combines a true incoming source arc, a corner, and another binding on that arc', () => {
    const state = cornerFixture()
    state.segments[0] = { ...state.segments[0], kind: 'arc', through: { re: -1, im: 1 } }
    state.markers.push({
      id: 'other',
      re: -1,
      im: 1,
      mathematicalKind: 'pole',
      label: defaultLabel('q'),
      pointStyle: defaultPointStyle(),
    })
    state.avoidances.push({
      id: 'other-cut',
      markerId: 'other',
      targetSegmentId: 'edge-a',
      radius: 0.15,
      side: 'left',
      openingRatio: 0.5,
    })
    const result = validateAvoidances(state)
    expect(result.ok, result.ok ? '' : result.error).toBe(true)
    if (!result.ok) return
    expect(result.scene.chains.get('edge-a')!.map((s) => s.kind)).toEqual([
      'arc',
      'arc',
      'arc',
      'arc',
    ])
    expect(result.scene.chains.get('edge-b')![0].startId).toBe('avoid:corner:exit-point')
  })

  it('exposes actual trim intervals separately from conservative legacy line occupancy', () => {
    const state = arcFixture()
    state.segments[0] = { id: 'upper', kind: 'line', startId: 'a', endId: 'b' }
    state.markers[0].im = 1
    const result = constructAvoidance(state, state.avoidances[0])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.mode).toBe('line')
    expect(result.value.trims[0]).toMatchObject({ startT: 11 / 24, endT: 13 / 24 })
    expect(result.value.occupancy[0]).toMatchObject({ startT: 5 / 12, endT: 7 / 12 })
    const corner = cornerFixture()
    const c = constructAvoidance(corner, corner.avoidances[0])
    expect(c.ok).toBe(true)
    if (!c.ok) return
    expect(c.value.defaultSide).toBe('left')
    expect(c.value.trims).toEqual([
      { sourceSegmentId: 'edge-a', startT: 0.75, endT: 1 },
      { sourceSegmentId: 'edge-b', startT: 0, endT: 1 / 6 },
    ])
  })

  it.each([null, 42, 'missing', 'edge-a', 'edge-c'])(
    'strictly rejects malformed or invalid secondary reference %s',
    (exitSegmentId) => {
      const file = JSON.parse(serializeProject(cornerFixture()))
      file.document.avoidances[0].exitSegmentId = exitSegmentId
      expect(() => parseProject(JSON.stringify(file))).toThrow()
    },
  )

  it('rejects invalid vertex types and semantic data in legacy files, while plain v1/v2 remain readable', () => {
    const file = JSON.parse(serializeProject(cornerFixture()))
    file.document.vertices[1].mathematicalKind = 'invalid'
    expect(() => parseProject(JSON.stringify(file))).toThrow(/数学类型/)
    for (const version of [1, 2]) {
      const legacy = JSON.parse(serializeProject(createInitialState()))
      legacy.version = version
      expect(parseProject(JSON.stringify(legacy)).avoidances).toEqual([])
      legacy.document.vertices[0].mathematicalKind = 'pole'
      expect(() => parseProject(JSON.stringify(legacy))).toThrow(/版本 3/)
    }
  })

  it('keeps the authoritative detour radius through scene projection at translated coordinates', () => {
    const state = arcFixture()
    state.vertices = state.vertices.map((p) => ({ ...p, re: p.re + 1e6, im: p.im - 1e6 }))
    state.markers = state.markers.map((p) => ({ ...p, re: p.re + 1e6, im: p.im - 1e6 }))
    state.segments[0] = { ...state.segments[0], kind: 'arc', through: { re: 1e6, im: 3 - 1e6 } }
    state.avoidances[0].radius = 0.3
    const geometry = buildContourGeometry(state)
    const detour = geometry.segments.find((s) => s.segment.id === 'avoid:cut:arc')!
    expect(detour.arc!.radius).toBe(0.3)
    expect(detour.arc!.center).toEqual({ re: 1e6, im: 3 - 1e6 })
  })

  it('preserves source/part styles, logical label and arrow anchors and a single closed fill path', () => {
    const state = cornerFixture()
    state.segments[0].label = defaultLabel('incoming')
    state.segments[0].style = { color: '#123456', arrows: true }
    state.segments[1].label = defaultLabel('outgoing')
    state.avoidances[0].partLabels = { arc: defaultLabel('detour') }
    state.avoidances[0].partStyles = { arc: { color: '#abcdef' } }
    const geometry = buildContourGeometry(state)
    expect(geometry.path.match(/M /g)).toHaveLength(1)
    expect(geometry.path.endsWith(' Z')).toBe(true)
    expect(geometry.segments.filter((s) => s.arrow)).toHaveLength(5)
    expect(
      geometry.segments.find((s) => s.segment.id === 'avoid:corner:arc')!.segment.style!.color,
    ).toBe('#abcdef')
    expect(geometry.labels.map((l) => l.value.tex)).toEqual(['detour', 'incoming', 'outgoing'])
    // Outgoing label belongs only to the retained horizontal segment x=.5..3.
    const outgoing = geometry.labels.find((l) => l.value.tex === 'outgoing')!
    expect(outgoing.point.x).toBeCloseTo(470)
    expect(outgoing.point.y).toBeCloseTo(300)
  })

  it.each(['arc', 'corner'] as const)(
    'reuses duplicate %s bindings but rejects a different invalid secondary ref atomically',
    (mode) => {
      const state = mode === 'arc' ? arcFixture() : cornerFixture()
      const h = historyReducer(createHistory(state), {
        type: 'addAvoidance',
        avoidance: { ...state.avoidances[0], id: 'duplicate', radius: 0.7 },
      })
      expect(h.present.avoidances).toBe(state.avoidances)
      expect(h.past).toHaveLength(0)
      const rejected = contourReducer(state, {
        type: 'addAvoidance',
        avoidance: { ...state.avoidances[0], id: 'bad', exitSegmentId: 'missing' },
      })
      expect(rejected.error).not.toBe('')
      expect(rejected.avoidances).toBe(state.avoidances)
    },
  )

  it('reverses a single source arc without changing its visible detour branch', () => {
    const state = arcFixture()
    const before = constructAvoidance(state, state.avoidances[0])
    const reversed = contourReducer(state, { type: 'reverse' })
    expect(reversed.error).toBe('')
    expect(reversed.avoidances[0].side).toBe('left')
    if (!isLegacyAvoidance(reversed.avoidances[0])) throw new Error('Expected legacy fixture')
    const after = constructAvoidance(reversed, reversed.avoidances[0])
    if (!before.ok || !after.ok) throw new Error('invalid arc construction')
    expect(after.value.geometry.entry).toEqual(before.value.geometry.exit)
    expect(after.value.geometry.exit).toEqual(before.value.geometry.entry)
    expect(after.value.geometry.arc.sweep).toBeCloseTo(-before.value.geometry.arc.sweep)
    expect(validateAvoidances(reversed).ok).toBe(true)
  })

  it('accepts two separated source-arc bindings and rejects their touching parameter occupancy', () => {
    const state = arcFixture()
    state.markers.push({ ...state.markers[0], id: 'other', re: 1.5, im: Math.sqrt(6.75) })
    const other = { ...state.avoidances[0], id: 'other-cut', markerId: 'other', radius: 0.2 }
    state.avoidances.push(other)
    expect(validateAvoidances(state).ok).toBe(true)
    state.markers[1] = { ...state.markers[1], re: 0.1, im: Math.sqrt(8.99) }
    const result = validateAvoidances(state)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/范围重叠|接近/)
  })

  it('rejects invalid radius edits and incorrect shared-ID corner declarations without changing document/history', () => {
    const state = cornerFixture()
    const h = historyReducer(createHistory(state), {
      type: 'updateAvoidance',
      id: 'corner',
      patch: { radius: 3 },
    })
    expect(h.present.error).toContain('corner')
    expect(h.present.avoidances).toBe(state.avoidances)
    expect(h.past).toHaveLength(0)
    state.vertices.push({ id: 'same-coordinates', re: 0, im: 0 })
    state.segments[1] = { ...state.segments[1], startId: 'same-coordinates' }
    state.closed = false
    const result = resolveScene(state)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/共享顶点|进入源段/)
  })

  it('rejects invalid mathematical point types at the runtime boundary as strictly as the file reader', () => {
    const state = cornerFixture()
    const next = contourReducer(state, {
      type: 'mathematicalKind',
      id: 'b',
      value: null,
    } as unknown as Parameters<typeof contourReducer>[1])
    expect(next.error).toMatch(/数学类型/)
    expect(next.vertices).toBe(state.vertices)
  })

  it('stitches two corner bindings that share a retained source segment', () => {
    const state = cornerFixture()
    state.vertices[2].mathematicalKind = 'branch'
    state.avoidances.push({
      ...state.avoidances[0],
      id: 'second-corner',
      markerId: 'c',
      targetSegmentId: 'edge-b',
      exitSegmentId: 'edge-c',
    })
    const result = validateAvoidances(state)
    expect(result.ok, result.ok ? '' : result.error).toBe(true)
    if (!result.ok) return
    expect(result.scene.chains.get('edge-b')!.map((s) => s.id)).toEqual([
      'gap:edge-b:before:second-corner',
      'avoid:second-corner:arc',
    ])
    for (const s of result.scene.contourSegments)
      expect(result.scene.contourSegments.some((next) => next.startId === s.endId)).toBe(true)
    expect(result.scene.contourSegments.some((s) => ['b', 'c'].includes(s.startId))).toBe(false)
  })

  it('retains an outgoing source arc, including its directed interval and through point on translation', () => {
    const state = cornerFixture()
    state.vertices[2] = { id: 'c', re: 2, im: 0 }
    state.segments[1] = { ...state.segments[1], kind: 'arc', through: { re: 1, im: -1 } }
    state.selection = { kind: 'segment', id: 'avoid:corner:arc' }
    const moved = contourReducer(state, {
      type: 'translateSelection',
      from: state,
      delta: { re: 0.2, im: 0.2 },
    })
    expect(moved.error).toBe('')
    expect(moved.segments[1]).toMatchObject({ through: { re: 1.2, im: -0.8 } })
    const result = validateAvoidances(moved)
    expect(result.ok, result.ok ? '' : result.error).toBe(true)
    if (!result.ok) return
    const retained = result.scene.chains.get('edge-b')![0]
    expect(retained.startId).toBe('avoid:corner:exit-point')
    if (retained.kind !== 'arc') throw new Error('lost outgoing source arc')
    const fit = arcThrough(
      result.scene.points.get(retained.startId)!,
      result.scene.points.get(retained.endId)!,
      retained.through,
    )
    expect(fit.ok).toBe(true)
    if (fit.ok) {
      expect(fit.arc.radius).toBeCloseTo(1, 12)
      expect(fit.arc.center.re).toBeCloseTo(1.2, 12)
      expect(fit.arc.center.im).toBeCloseTo(0.2, 12)
      expect(fit.arc.sweep).toBeGreaterThan(0)
    }
  })

  it('expands a single-source independent arc while retaining source-only queries and origins', () => {
    const state = arcFixture()
    state.connections = state.segments
    state.segments = []
    const result = validateAvoidances(state)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.scene.contourSegments).toEqual([])
    expect(result.scene.connectionSegments.map((s) => s.kind)).toEqual(['arc', 'arc', 'arc'])
    expect(result.scene.connectionSegments.every((s) => s.origin.collection === 'connection')).toBe(
      true,
    )
    expect(state.connections).toHaveLength(1)
    expect(parseProject(serializeProject(state)).connections).toEqual(state.connections)
  })

  it('keeps a regular binding on a visible source when its later corner binding is hidden', () => {
    const state = cornerFixture()
    state.closed = false
    state.segments = [state.segments[0], state.segments[2], state.segments[3], state.segments[1]]
    state.markers.push({
      id: 'other',
      re: 0,
      im: 1.3,
      mathematicalKind: 'pole',
      label: defaultLabel('q'),
      pointStyle: defaultPointStyle(),
    })
    state.avoidances.push({
      id: 'regular',
      markerId: 'other',
      targetSegmentId: 'edge-a',
      radius: 0.15,
      side: 'left',
      openingRatio: 0.5,
    })
    const result = validateAvoidances(state)
    expect(result.ok, result.ok ? '' : result.error).toBe(true)
    if (!result.ok) return
    const chain = result.scene.chains.get('edge-a')!
    expect(chain.map((s) => s.id)).toEqual([
      'gap:edge-a:before:regular',
      'avoid:regular:arc',
      'gap:edge-a:after:regular',
    ])
    expect(chain.at(-1)!.endId).toBe('b')
    for (const segment of chain)
      expect(result.scene.origins.get(segment.id)).toEqual(segment.origin)
    expect(result.scene.origins.get('avoid:corner:arc')).toMatchObject({
      kind: 'avoidance',
      avoidanceId: 'corner',
    })
  })

  it('returns a contextual numerical error when source-arc joints cannot be represented', () => {
    const state = arcFixture()
    state.vertices = state.vertices.map((p) => ({ ...p, re: p.re + 1e12, im: p.im - 1e12 }))
    state.markers = state.markers.map((p) => ({ ...p, re: p.re + 1e12, im: p.im - 1e12 }))
    state.segments[0] = { ...state.segments[0], kind: 'arc', through: { re: 1e12, im: 3 - 1e12 } }
    state.avoidances[0].radius = 1e-6
    const construction = constructAvoidance(state, state.avoidances[0])
    expect(construction.ok).toBe(false)
    if (!construction.ok) {
      expect(construction.error).toContain('cut')
      expect(construction.error).toContain('upper')
      expect(construction.error).toMatch(/精度|表示|数值/)
    }
    expect(resolveScene(state)).toEqual(construction)
  })

  it('reports the short-arc default without overriding an explicitly requested side', () => {
    const state = arcFixture()
    state.avoidances[0].side = 'left'
    const result = constructAvoidance(state, state.avoidances[0])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.defaultSide).toBe('right')
    expect(Math.abs(result.value.geometry.arc.sweep)).toBeGreaterThan(Math.PI)
    expect(result.value.geometry.arc.center).toEqual({ re: 0, im: 3 })
    expect(result.value.geometry.arc.radius).toBe(0.5)
  })
})
