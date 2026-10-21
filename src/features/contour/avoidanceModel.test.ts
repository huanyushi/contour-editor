import { describe, expect, it, vi } from 'vitest'
import { createAvoidanceFixture } from '../../test/avoidanceFixtures'
import { parseProject, serializeProject } from '../project/project'
import { projectSceneError } from '../project/validation'
import { defaultLabel } from './appearance'
import { reconcileAvoidanceDependencies, type AvoidanceAction } from './avoidanceModel'
import { createHistory, historyReducer } from './history'
import { contourReducer, type ContourAction, type ContourState } from './model'
import { resolveScene } from './resolvedScene'
import { findPoint, findSegment, sceneSegments } from './sceneObjects'

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze)
    Object.freeze(value)
  }
  return value
}

function reduce(state: ContourState, action: AvoidanceAction | ContourAction) {
  return contourReducer(state, action)
}

function twoBindings(): ContourState {
  const state = createAvoidanceFixture()
  return {
    ...state,
    markers: [
      { ...state.markers[0], re: -2 },
      { ...state.markers[0], id: 'other', re: 2 },
    ],
    avoidances: [state.avoidances[0], { ...state.avoidances[0], id: 'avoid-2', markerId: 'other' }],
  }
}

describe('avoidance source actions', () => {
  it('sets mathematical kind on source points without inferring a binding', () => {
    const source = createAvoidanceFixture()
    const before = freeze({
      ...source,
      avoidances: [],
      markers: [{ ...source.markers[0], mathematicalKind: undefined }],
    })
    const after = reduce(before, { type: 'mathematicalKind', id: 'pole', value: 'branch' })
    expect(after.markers[0].mathematicalKind).toBe('branch')
    expect(after.segments).toBe(before.segments)
    expect(after.avoidances).toBe(before.avoidances)
    const vertex = reduce(before, { type: 'mathematicalKind', id: 'a', value: 'pole' })
    expect(vertex.vertices[0].mathematicalKind).toBe('pole')
    expect(vertex.avoidances).toBe(before.avoidances)
    expect(reduce(before, { type: 'mathematicalKind', id: 'missing', value: 'pole' })).toBe(before)
    const formula = contourReducer(before, { type: 'addFormula', id: 'f', point: { re: 1, im: 1 } })
    expect(reduce(formula, { type: 'mathematicalKind', id: 'f', value: 'pole' })).toBe(formula)
  })

  it('preserves bindings across nonordinary types and explicitly rejects ordinary or corrupt kinds', () => {
    const before = freeze(createAvoidanceFixture())
    for (const value of ['isolated', 'branch', 'pole'] as const) {
      const after = reduce(before, { type: 'mathematicalKind', id: 'pole', value })
      expect(after.markers[0].mathematicalKind).toBe(value)
      expect(after.avoidances).toBe(before.avoidances)
    }
    for (const value of ['ordinary', 'invalid', undefined]) {
      const after = reduce(before, {
        type: 'mathematicalKind',
        id: 'pole',
        value,
      } as AvoidanceAction)
      expect(after.markers).toBe(before.markers)
      expect(after.avoidances).toBe(before.avoidances)
      expect(after.error).not.toBe('')
    }
  })

  it('creates one immutable binding and reuses duplicate marker/target pairs without history', () => {
    const fixture = createAvoidanceFixture()
    const before = freeze({ ...fixture, avoidances: [] })
    let history = historyReducer(createHistory(before), {
      type: 'addAvoidance',
      avoidance: fixture.avoidances[0],
    })
    expect(history.present.error).toBe('')
    expect(history.present.avoidances).toEqual(fixture.avoidances)
    expect(history.past).toHaveLength(1)
    history = historyReducer(history, {
      type: 'addAvoidance',
      avoidance: { ...fixture.avoidances[0], id: 'duplicate', radius: 0.8 },
    })
    expect(history.present.avoidances).toHaveLength(1)
    expect(history.present.avoidances[0].radius).toBe(0.5)
    expect(history.present.selection).toEqual({ kind: 'segment', id: 'avoid:avoid-1:arc' })
    expect(history.past).toHaveLength(1)
    expect(before.avoidances).toEqual([])
  })

  it('updates parameters and part overrides without mutating source appearance', () => {
    const before = freeze(createAvoidanceFixture())
    let after = reduce(before, {
      type: 'updateAvoidance',
      id: 'avoid-1',
      patch: { radius: 0.75, side: 'right', openingRatio: 0.7 },
    })
    after = reduce(after, {
      type: 'avoidanceStyle',
      id: 'avoid-1',
      part: 'entry',
      patch: { color: '#123456', width: 3 },
    })
    after = reduce(after, {
      type: 'avoidanceStyle',
      id: 'avoid-1',
      part: 'entry',
      patch: { dash: 'dotted' },
    })
    after = reduce(after, {
      type: 'avoidanceLabel',
      id: 'avoid-1',
      part: 'exit',
      label: defaultLabel('E'),
    })
    expect(after.error).toBe('')
    expect(after.avoidances[0]).toMatchObject({
      radius: 0.75,
      side: 'right',
      openingRatio: 0.7,
      partStyles: { entry: { color: '#123456', width: 3, dash: 'dotted' } },
      partLabels: { exit: defaultLabel('E') },
    })
    expect(after.segments).toBe(before.segments)
    expect(before.avoidances[0].partStyles).toBeUndefined()
    expect(parseProject(serializeProject(after)).avoidances).toEqual(after.avoidances)
  })

  it.each([
    {
      type: 'addAvoidance',
      avoidance: { ...createAvoidanceFixture().avoidances[0], markerId: 'missing' },
    },
    {
      type: 'addAvoidance',
      avoidance: { ...createAvoidanceFixture().avoidances[0], targetSegmentId: 'missing' },
    },
  ] as AvoidanceAction[])(
    'rejects invalid new references instead of cleaning them away: $avoidance',
    (action) => {
      const fixture = createAvoidanceFixture()
      const before = freeze({ ...fixture, avoidances: [] })
      const after = reduce(before, action)
      expect(after.avoidances).toBe(before.avoidances)
      expect(after.error).not.toBe('')
    },
  )

  it('removes only the requested binding and clears its stale generated selection', () => {
    const source = twoBindings()
    const before = freeze({
      ...source,
      selection: { kind: 'segment' as const, id: 'avoid:avoid-1:arc' },
      selectedSegmentId: 'avoid:avoid-1:arc',
    })
    const after = reduce(before, { type: 'removeAvoidance', id: 'avoid-1' })
    expect(after.avoidances.map((a) => a.id)).toEqual(['avoid-2'])
    expect(after.markers).toBe(before.markers)
    expect(after.segments).toBe(before.segments)
    expect(after.selection).toEqual({ kind: 'none' })
    expect(after.selectedSegmentId).not.toBe('avoid:avoid-1:arc')
    expect(projectSceneError(after)).toBe('')
  })

  it('cleans removed binding gaps from mixed selection while preserving surviving items', () => {
    const source = twoBindings()
    const before = freeze({
      ...source,
      selection: {
        kind: 'multiple' as const,
        items: [
          { kind: 'segment' as const, id: 'gap:edge-a:before:avoid-1' },
          { kind: 'segment' as const, id: 'avoid:avoid-2:arc', part: 'label' as const },
          { kind: 'marker' as const, id: 'pole' },
        ],
      },
      selectedSegmentId: 'gap:edge-a:before:avoid-1',
    })
    const after = reduce(before, { type: 'removeAvoidance', id: 'avoid-1' })
    expect(after.selection).toEqual({
      kind: 'multiple',
      items: [
        { kind: 'segment', id: 'avoid:avoid-2:arc', part: 'label' },
        { kind: 'marker', id: 'pole' },
      ],
    })
    expect(after.selectedSegmentId).toBe('')
  })

  it.each(['ordinary', undefined] as const)(
    'rejects binding an ordinary/default marker (%s) without promoting its type',
    (mathematicalKind) => {
      const source = createAvoidanceFixture()
      const before = freeze({
        ...source,
        markers: [{ ...source.markers[0], mathematicalKind }],
        avoidances: [],
      })
      const after = reduce(before, { type: 'addAvoidance', avoidance: source.avoidances[0] })
      expect(after.error).toMatch(/非普通/)
      expect(after.avoidances).toBe(before.avoidances)
      expect(after.markers).toBe(before.markers)
      expect(after.selection).toBe(before.selection)
    },
  )

  it.each(['move', 'moveThrough', 'setArc'] as const)(
    'never edits derived IDs through %s',
    (type) => {
      const before = freeze(createAvoidanceFixture())
      for (const id of [
        'avoid:avoid-1:arc',
        'avoid:avoid-1:entry-base',
        'gap:edge-a:before:avoid-1',
      ]) {
        const action =
          type === 'setArc'
            ? { type, id, through: { re: 0, im: 2 } }
            : { type, id, point: { re: 0, im: 2 } }
        const after = reduce(before, action)
        expect(after.vertices).toBe(before.vertices)
        expect(after.segments).toBe(before.segments)
        expect(after.connections).toBe(before.connections)
        expect(after.avoidances).toBe(before.avoidances)
      }
    },
  )

  it('rejects source arc conversion while bound and permits it after cancellation', () => {
    const before = freeze(createAvoidanceFixture())
    const rejected = reduce(before, { type: 'setArc', id: 'edge-a', through: { re: 0, im: 1 } })
    expect(rejected.segments).toBe(before.segments)
    expect(rejected.error).toMatch(/取消.*绕行/)
    const removed = reduce(before, { type: 'removeAvoidance', id: 'avoid-1' })
    expect(
      reduce(removed, { type: 'setArc', id: 'edge-a', through: { re: 0, im: 1 } }).segments[0].kind,
    ).toBe('arc')
  })
})

describe('avoidance dependency lifecycle', () => {
  it.each([-1, 1])(
    'remembers the effective off-line side at h=%s when returning to the source',
    (im) => {
      const before = freeze(createAvoidanceFixture())
      const moved = reduce(before, {
        type: 'moveObject',
        kind: 'marker',
        id: 'pole',
        point: { re: 0, im },
      })
      expect(moved.error).toBe('')
      expect(moved.avoidances[0].side).toBe(im < 0 ? 'right' : 'left')
      const returned = reduce(moved, {
        type: 'moveObject',
        kind: 'marker',
        id: 'pole',
        point: { re: 0, im: 0 },
      })
      expect(returned.avoidances[0].side).toBe(im < 0 ? 'right' : 'left')
      const result = resolveScene(returned)
      expect(result.ok).toBe(true)
      if (result.ok)
        expect(result.scene.contourSegments.find((s) => s.kind === 'arc')).toMatchObject({
          through: { re: 0, im: im < 0 ? -0.5 : 0.5 },
        })
    },
  )

  it('updates side from changed source endpoints and from snapshot-based selection translation', () => {
    const before = freeze(createAvoidanceFixture())
    const moved = reduce(before, { type: 'move', id: 'a', point: { re: -4, im: 1 } })
    expect(moved.error).toBe('')
    expect(moved.avoidances[0].side).toBe('right')
    const selected = reduce(before, { type: 'selectMany', items: [{ kind: 'marker', id: 'pole' }] })
    const translated = reduce(selected, {
      type: 'translateSelection',
      from: selected,
      delta: { re: 0, im: -1 },
    })
    expect(translated.error).toBe('')
    expect(translated.avoidances[0].side).toBe('right')
  })

  it('rejects a conflicting pole move without leaving marker and arc out of sync', () => {
    const before = freeze(createAvoidanceFixture())
    const after = reduce(before, {
      type: 'moveObject',
      kind: 'marker',
      id: 'pole',
      point: { re: 0, im: 2.8 },
    })
    expect(after.markers).toBe(before.markers)
    expect(after.avoidances).toBe(before.avoidances)
    expect(after.error).not.toBe('')
  })

  it.each([
    { type: 'removeObject', kind: 'marker', id: 'pole' },
    { type: 'deleteSegment', id: 'edge-a' },
    { type: 'delete' },
    { type: 'deleteSelection' },
  ] as ContourAction[])('cleans dependencies for destructive source action $type', (action) => {
    const source = createAvoidanceFixture()
    const before = freeze({ ...source, selectedId: 'a', selection: { kind: 'contour' as const } })
    const after = reduce(before, action)
    expect(after.error).toBe('')
    expect(after.avoidances).toEqual([])
    if (action.type === 'removeObject') expect(after.segments).toBe(before.segments)
    else expect(after.markers).toBe(before.markers)
    expect(parseProject(serializeProject(after)).avoidances).toEqual([])
  })

  it('deletes all bindings of one marker while retaining other markers and bindings', () => {
    const source = twoBindings()
    // A second, hidden source avoids overlapping two rendered circles at one marker.
    source.segments = [source.segments[3], ...source.segments.slice(0, 3)]
    source.closed = false
    source.avoidances.push({
      ...source.avoidances[0],
      id: 'second-target',
      targetSegmentId: 'edge-c',
    })
    const before = freeze(source)
    expect(projectSceneError(before)).toBe('')
    const after = reduce(before, { type: 'removeObject', kind: 'marker', id: 'pole' })
    expect(after.error).toBe('')
    expect(after.avoidances.map((a) => a.id)).toEqual(['avoid-2'])
    expect(after.segments).toBe(before.segments)
  })

  it('cleans bindings to incident connections during batch endpoint deletion in one history step', () => {
    const source = createAvoidanceFixture()
    const before = freeze({
      ...source,
      segments: source.segments.slice(1, 3),
      closed: false,
      connections: [source.segments[0]],
      selection: {
        kind: 'multiple' as const,
        items: [
          { kind: 'vertex' as const, id: 'a' },
          { kind: 'vertex' as const, id: 'b' },
        ],
      },
    })
    const history = historyReducer(createHistory(before), { type: 'deleteSelection' })
    expect(history.present.error).toBe('')
    expect(history.present.connections).toEqual([])
    expect(history.present.avoidances).toEqual([])
    expect(history.present.markers).toBe(before.markers)
    expect(history.past).toHaveLength(1)
    expect(historyReducer(history, { type: 'undo' }).present.avoidances).toEqual(before.avoidances)
  })

  it('keeps hidden retained closing edge bindings across open, materialize and close', () => {
    const source = createAvoidanceFixture()
    source.markers[0] = { ...source.markers[0], re: -4, im: 1.5 }
    source.avoidances[0].targetSegmentId = 'edge-d'
    const before = freeze(source)
    expect(projectSceneError(before)).toBe('')
    const open = reduce(before, { type: 'toggleClosed' })
    expect(open.avoidances).toBe(before.avoidances)
    const materialized = reduce(open, { type: 'connectPoints', startId: 'a', endId: 'd' })
    expect(materialized.avoidances).toBe(before.avoidances)
    expect(materialized.connections.map((s) => s.id)).toEqual(['edge-d'])
    const closed = reduce(materialized, { type: 'toggleClosed' })
    expect(closed.error).toBe('')
    expect(closed.avoidances).toEqual(before.avoidances)
    expect(closed.connections).toEqual([])
    expect(resolveScene(closed)).toEqual(resolveScene(before))
  })

  it('cleans an actually discarded retained edge when cutting an already-open contour', () => {
    const source = createAvoidanceFixture()
    source.markers[0] = { ...source.markers[0], re: -4, im: 1.5 }
    source.avoidances[0].targetSegmentId = 'edge-d'
    source.closed = false
    const before = freeze(source)
    for (const action of [
      { type: 'deleteSegment', id: 'edge-b' },
      { type: 'delete' },
    ] as ContourAction[]) {
      const state = { ...before, selectedId: 'b' }
      const after = reduce(state, action)
      expect(after.error).toBe('')
      expect(after.segments.some((s) => s.id === 'edge-d')).toBe(false)
      expect(after.avoidances).toEqual([])
      expect(after.closed).toBe(false)
    }
  })

  it('reverses side and entry/exit overrides twice without reversing independent connections', () => {
    const source = createAvoidanceFixture()
    source.connections = [{ id: 'separate', kind: 'line', startId: 'a', endId: 'd' }]
    // Remove the retained duplicate before making the separate connection.
    source.segments = source.segments.slice(0, 3)
    source.closed = false
    source.avoidances[0].partStyles = { entry: { color: '#123456' }, arc: { width: 4 } }
    source.avoidances[0].partLabels = { exit: defaultLabel('X') }
    const before = freeze(source)
    const reversed = reduce(before, { type: 'reverse' })
    expect(reversed.error).toBe('')
    expect(reversed.avoidances[0]).toMatchObject({
      side: 'right',
      partStyles: { exit: { color: '#123456' }, arc: { width: 4 } },
      partLabels: { entry: defaultLabel('X') },
    })
    expect(reversed.avoidances[0].partStyles).not.toHaveProperty('entry')
    expect(reversed.connections).toBe(before.connections)
    const restored = reduce(reversed, { type: 'reverse' })
    expect(restored.avoidances).toEqual(before.avoidances)
    expect(resolveScene(restored)).toEqual(resolveScene(before))
  })

  it('makes reversal involutive even for an imported off-line binding with a different saved on-line preference', () => {
    const source = createAvoidanceFixture()
    source.markers[0].im = -1
    const before = freeze(source)
    expect(projectSceneError(before)).toBe('')
    const reversed = reduce(before, { type: 'reverse' })
    expect(reversed.avoidances[0].side).toBe('right')
    const restored = reduce(reversed, { type: 'reverse' })
    expect(restored.avoidances).toEqual(before.avoidances)
    expect(resolveScene(restored)).toEqual(resolveScene(before))
  })

  it('reverses only contour bindings while preserving independent connection bindings', () => {
    const source = createAvoidanceFixture()
    source.markers.push(
      { ...source.markers[0], id: 'p', re: -3, im: -3 },
      { ...source.markers[0], id: 'q', re: 3, im: -3 },
      { ...source.markers[0], id: 'second-pole', im: -3 },
    )
    source.connections.push({ id: 'independent', kind: 'line', startId: 'p', endId: 'q' })
    source.avoidances.push({
      ...source.avoidances[0],
      id: 'independent-avoidance',
      markerId: 'second-pole',
      targetSegmentId: 'independent',
      partStyles: { entry: { width: 3 } },
      partLabels: { exit: defaultLabel('X') },
    })
    const before = freeze(source)
    expect(projectSceneError(before)).toBe('')
    const after = reduce(before, { type: 'reverse' })
    expect(after.error).toBe('')
    expect(after.avoidances[0].side).toBe('right')
    expect(after.avoidances[1]).toBe(before.avoidances[1])
    expect(after.connections).toBe(before.connections)
  })

  it('only reconciles real source deletions, never invalid references or document replacements', () => {
    const before = freeze(createAvoidanceFixture())
    const dangling = { ...before.avoidances[0], id: 'dangling', markerId: 'missing' }
    const candidate = freeze({
      ...before,
      segments: before.segments.slice(1),
      avoidances: [...before.avoidances, dangling],
      closed: false,
    })
    const reconciled = reconcileAvoidanceDependencies(before, candidate, {
      type: 'deleteSegment',
      id: 'edge-a',
    })
    // The real target deletion removes both declarations. An unrelated invalid
    // reference to another target must still reach the final rejection boundary.
    expect(reconciled.avoidances).toEqual([])
    const unrelated = freeze({
      ...candidate,
      avoidances: [before.avoidances[0], { ...dangling, targetSegmentId: 'edge-b' }],
    })
    expect(
      reconcileAvoidanceDependencies(before, unrelated, { type: 'deleteSegment', id: 'edge-a' })
        .avoidances,
    ).toEqual([{ ...dangling, targetSegmentId: 'edge-b' }])
    for (const action of [
      { type: 'loadProject', state: candidate },
      { type: 'mathematicalKind', id: 'pole', value: 'ordinary' },
      { type: 'addAvoidance', avoidance: dangling },
    ] as ContourAction[]) {
      expect(reconcileAvoidanceDependencies(before, candidate, action)).toBe(candidate)
    }
  })

  it.each([false, true])(
    'transfers a bound connection into the closing edge (reversed=%s)',
    (reversed) => {
      const source = createAvoidanceFixture()
      const target = source.segments[0]
      source.segments = source.segments.slice(1)
      source.connections = [{ ...target, ...(reversed ? { startId: 'b', endId: 'a' } : {}) }]
      source.closed = false
      source.avoidances[0].partStyles = { entry: { width: 3 } }
      source.avoidances[0].partLabels = { exit: defaultLabel('X') }
      const before = freeze(source)
      const after = reduce(before, { type: 'toggleClosed' })
      expect(after.error).toBe('')
      expect(after.closed).toBe(true)
      expect(after.connections).toEqual([])
      expect(after.avoidances).toHaveLength(1)
      expect(after.avoidances[0].side).toBe(reversed ? 'right' : 'left')
      expect(after.avoidances[0].partStyles).toEqual(
        reversed ? { exit: { width: 3 } } : { entry: { width: 3 } },
      )
      expect(after.avoidances[0].partLabels).toEqual(
        reversed ? { entry: defaultLabel('X') } : { exit: defaultLabel('X') },
      )
      expect(sceneSegments(after).filter((s) => s.id === target.id)).toHaveLength(1)
      expect(findSegment(after, 'avoid:avoid-1:arc')).toBeUndefined()
      expect(findPoint(after, 'avoid:avoid-1:entry-base')).toBeUndefined()
      expect(parseProject(serializeProject(after)).avoidances).toEqual(after.avoidances)
    },
  )
})

describe('binding IDs participate in source allocation', () => {
  it.each(['add', 'addMarker', 'addFormula'] as const)(
    'reserves binding IDs for direct %s actions',
    (type) => {
      const before = freeze(createAvoidanceFixture())
      const after = reduce(
        before,
        type === 'add'
          ? { type, vertex: { id: 'avoid-1', re: -5, im: 2 } }
          : { type, id: 'avoid-1', point: { re: -5, im: 2 } },
      )
      expect(after.vertices).toBe(before.vertices)
      expect(after.markers).toBe(before.markers)
      expect(after.formulas).toBe(before.formulas)
      expect(after.avoidances).toBe(before.avoidances)
    },
  )

  it('adds a source point to a reopened document whose binding ID is v-1', async () => {
    const { createVertex } = await import('./createVertex')
    const source = createAvoidanceFixture()
    source.avoidances[0].id = 'v-1'
    const before = freeze(parseProject(serializeProject(source)))
    const after = reduce(before, { type: 'add', vertex: createVertex({ re: -5, im: 2 }, before) })
    expect(after.error).toBe('')
    expect(after.vertices).toHaveLength(5)
    expect(parseProject(serializeProject(after)).avoidances[0].id).toBe('v-1')
  })

  it('allocates a new connection around an imported binding ID', () => {
    const source = createAvoidanceFixture()
    source.avoidances[0].id = 'connection-0'
    const before = freeze(parseProject(serializeProject(source)))
    const after = reduce(before, { type: 'connectPoints', startId: 'a', endId: 'c' })
    expect(after.error).toBe('')
    expect(after.connections).toHaveLength(1)
    expect(after.connections[0].id).not.toBe('connection-0')
    expect(() => parseProject(serializeProject(after))).not.toThrow()
  })

  it('allocates source vertices and their edges around binding IDs and saves/reopens', async () => {
    vi.resetModules()
    const { createVertex } = await import('./createVertex')
    const source = createAvoidanceFixture()
    source.avoidances[0].id = 'vertex-0'
    const before = freeze(parseProject(serializeProject(source)))
    const vertex = createVertex({ re: -5, im: 2 }, before)
    expect(vertex.id).not.toBe('vertex-0')
    const after = reduce(before, { type: 'add', vertex })
    expect(after.error).toBe('')
    expect(after.vertices).toHaveLength(5)
    expect(() => parseProject(serializeProject(after))).not.toThrow()
    const edgeCollision = {
      ...source,
      avoidances: [{ ...source.avoidances[0], id: 'edge-vertex-0' }],
    }
    vi.resetModules()
    const allocator = await import('./createVertex')
    expect(allocator.createVertex({ re: -5, im: 2 }, edgeCollision).id).not.toBe('vertex-0')
  })
})
