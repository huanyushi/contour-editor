import { act, renderHook } from '@testing-library/react'
import { useReducer } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAvoidanceFixture, createHugeOrdinaryArcFixture } from '../../test/avoidanceFixtures'
import { MAX_PROJECT_BYTES, serializeProject } from '../project/format'
import { parseProject } from '../project/project'
import { projectSceneError } from '../project/validation'
import { defaultLabel, defaultPointStyle } from './appearance'
import { avoidanceDraftReducer } from './avoidanceDraft'
import { createHistory, historyReducer, type EditorAction } from './history'
import { contourReducer, type ContourState } from './model'
import { useAvoidanceDraft } from './useAvoidanceDraft'
import * as targets from './avoidanceTarget'

afterEach(() => vi.restoreAllMocks())

function sourceFixture() {
  const source = createAvoidanceFixture()
  source.avoidances = []
  return source
}

function delayedCornerFixture() {
  // Automatic fitting now repairs this default. Seed an intentionally invalid
  // initial candidate to retain the regression for deferred side initialization.
  const makeTarget = targets.makeAvoidanceTarget
  vi.spyOn(targets, 'makeAvoidanceTarget').mockImplementation((...args) => {
    const result = makeTarget(...args)
    if (result.ok && (result.value.kind === undefined || result.value.kind === 'local'))
      return { ok: true, value: { ...result.value, radius: 5, side: 'left' } }
    return result
  })
  const source = sourceFixture()
  // At this overview scale the preferred visible radius still exceeds the short edge.
  source.viewport = { ...source.viewport, scaleX: 4.8, scaleY: 4.8 }
  source.markers = []
  source.vertices = [
    { id: 'a', re: 0, im: 100 },
    { id: 'b', re: 0, im: 0, mathematicalKind: 'pole' },
    { id: 'c', re: -1, im: 0 },
    { id: 'd', re: -1, im: 100 },
  ]
  return source
}

describe('avoidance draft', () => {
  it.each([1e306, 3e306])(
    'returns a safe candidate and preview result after a real v2 roundtrip with ordinary arc magnitude %s',
    (magnitude) => {
      const text = serializeProject(createHugeOrdinaryArcFixture(magnitude))
      expect(JSON.parse(text).version).toBe(2)
      const imported = parseProject(text)
      const typed = contourReducer(imported, {
        type: 'mathematicalKind',
        id: 'pole',
        value: 'pole',
      })
      expect(typed.error).toBe('')
      const snapshot = serializeProject(typed)
      const candidate = contourReducer(typed, {
        type: 'addAvoidance',
        avoidance: createAvoidanceFixture().avoidances[0],
      })
      // The common frame cannot represent the .5-radius circle beside 1e306.
      // Conservatively reject it rather than inventing an intersection answer.
      expect(candidate.error).toMatch(/huge-arc.*数值|数值.*huge-arc/)
      expect(serializeProject(candidate)).toBe(snapshot)
      expect(candidate.selection).toEqual(typed.selection)

      const { result } = renderHook(() => {
        const [history, dispatch] = useReducer(historyReducer, typed, createHistory)
        return { history, workflow: useAvoidanceDraft(history.present, dispatch) }
      })
      act(() => result.current.workflow.start('pole'))
      act(() => result.current.workflow.pickTarget('edge-a'))
      act(() => result.current.workflow.patch({ radius: 0.5 }))
      expect(result.current.workflow.preview).toMatchObject({
        ok: false,
        error: expect.stringMatching(/huge-arc.*数值|数值.*huge-arc/),
      })
      act(() => result.current.workflow.apply())
      expect(result.current.history.present).toBe(typed)
      expect(result.current.history.past).toHaveLength(0)
      expect(result.current.workflow.draft.kind).toBe('configure')
      expect(serializeProject(typed)).toBe(snapshot)
    },
  )

  it.each([
    { target: 'edge-a', center: { re: 0, im: 0 }, radius: 0.4, length: 8 },
    { target: 'edge-d', center: { re: -4, im: 1.5 }, radius: 0.4, length: 3 },
  ])(
    'suggests radius $radius for source length $length, committing only on explicit apply',
    ({ target, center, radius }) => {
      const source = sourceFixture()
      source.markers[0] = { ...source.markers[0], ...center }
      const { result } = renderHook(() => {
        const [history, dispatch] = useReducer(historyReducer, source, createHistory)
        return { history, dispatch, workflow: useAvoidanceDraft(history.present, dispatch) }
      })
      act(() => result.current.workflow.start('pole'))
      act(() => result.current.workflow.pickTarget(target))
      expect(result.current.workflow.draft).toMatchObject({
        kind: 'configure',
        avoidance: { radius, side: 'left', openingRatio: 0.5 },
      })
      expect(result.current.workflow.preview?.ok).toBe(true)
      expect(result.current.history.present.avoidances).toEqual([])
      expect(result.current.history.past).toHaveLength(0)
      act(() => result.current.workflow.apply())
      expect(result.current.history.present.avoidances[0].radius).toBe(radius)
      expect(result.current.history.past).toHaveLength(1)
      act(() => result.current.dispatch({ type: 'undo' }))
      expect(result.current.history.present.avoidances).toEqual([])
      expect(result.current.history.past).toHaveLength(0)
    },
  )

  it('only patches configured drafts and preserves their identity', () => {
    const avoidance = createAvoidanceFixture().avoidances[0]
    const pick = avoidanceDraftReducer({ kind: 'idle' }, { type: 'start', markerId: 'pole' })
    expect(pick).toEqual({ kind: 'pickTarget', markerId: 'pole' })
    expect(avoidanceDraftReducer(pick, { type: 'patch', patch: { radius: 2 } })).toBe(pick)
    const configured = avoidanceDraftReducer(pick, { type: 'configure', avoidance })
    expect(avoidanceDraftReducer(configured, { type: 'patch', patch: { radius: 0.25 } })).toEqual({
      kind: 'configure',
      avoidance: { ...avoidance, radius: 0.25 },
    })
    expect(avoidance.radius).toBe(0.5)
    expect(avoidanceDraftReducer(configured, { type: 'cancel' })).toEqual({ kind: 'idle' })
  })

  it('keeps configured previews out of document actions and discards them on cancel', () => {
    const source = sourceFixture()
    const saved = serializeProject(source)
    const dispatch = vi.fn()
    const { result } = renderHook(() => useAvoidanceDraft(source, dispatch))
    act(() => result.current.start('pole'))
    act(() => result.current.pickTarget('edge-a'))
    act(() => result.current.patch({ radius: 0.25 }))
    expect(result.current.preview?.ok).toBe(true)
    expect(dispatch).not.toHaveBeenCalled()
    expect(serializeProject(source)).toBe(saved)
    act(() => result.current.cancel())
    expect(result.current.draft).toEqual({ kind: 'idle' })
    expect(result.current.preview).toBeNull()
    expect(dispatch).not.toHaveBeenCalled()
    expect(source.avoidances).toEqual([])
  })

  it('applies exactly one accepted document action and one undo step', () => {
    const source = sourceFixture()
    const actions: EditorAction[] = []
    const { result } = renderHook(() => {
      const [history, dispatch] = useReducer(historyReducer, source, createHistory)
      const workflow = useAvoidanceDraft(history.present, (action) => {
        actions.push(action)
        dispatch(action)
      })
      return { history, workflow, dispatch }
    })
    act(() => result.current.workflow.start('pole'))
    act(() => result.current.workflow.pickTarget('edge-a'))
    act(() => result.current.workflow.patch({ radius: 0.25, side: 'right' }))
    expect(actions).toEqual([])
    expect(result.current.history.present).toBe(source)
    expect(result.current.history.past).toEqual([])
    act(() => result.current.workflow.apply())
    expect(actions.map((a) => a.type)).toEqual(['addAvoidance'])
    expect(result.current.workflow.draft.kind).toBe('idle')
    expect(result.current.history.present.avoidances).toHaveLength(1)
    expect(result.current.history.present.avoidances[0]).toMatchObject({
      radius: 0.25,
      side: 'right',
    })
    expect(result.current.history.past).toHaveLength(1)
    act(() => result.current.dispatch({ type: 'undo' }))
    expect(result.current.history.present.avoidances).toEqual([])
    act(() => result.current.dispatch({ type: 'redo' }))
    expect(result.current.history.present.avoidances).toHaveLength(1)
  })

  it('keeps the binding ID stable and avoids IDs in every source collection', () => {
    const source = sourceFixture()
    source.vertices[0].id = 'avoidance-0'
    source.segments = source.segments.map((s) => ({
      ...s,
      startId: s.startId === 'a' ? 'avoidance-0' : s.startId,
      endId: s.endId === 'a' ? 'avoidance-0' : s.endId,
    }))
    source.markers.push({ ...source.markers[0], id: 'avoidance-1', re: 2 })
    source.formulas.push({
      id: 'avoidance-2',
      re: 0,
      im: 1,
      label: defaultLabel('f'),
      pointStyle: defaultPointStyle(),
    })
    source.connections.push({ id: 'avoidance-3', kind: 'line', startId: 'avoidance-0', endId: 'c' })
    source.segments[1] = { ...source.segments[1], id: 'avoidance-4' }
    source.avoidances.push({
      ...createAvoidanceFixture().avoidances[0],
      id: 'avoidance-5',
      markerId: 'avoidance-1',
      radius: 0.2,
    })
    const { result } = renderHook(() => useAvoidanceDraft(source, vi.fn()))
    act(() => result.current.start('pole'))
    act(() => result.current.pickTarget('edge-a'))
    expect(result.current.draft.kind).toBe('configure')
    if (result.current.draft.kind !== 'configure') throw new Error('missing draft')
    const id = result.current.draft.avoidance.id
    expect(id).toMatch(/^[a-zA-Z0-9_-]{1,80}$/)
    expect([
      'avoidance-0',
      'avoidance-1',
      'avoidance-2',
      'avoidance-3',
      'avoidance-4',
      'avoidance-5',
    ]).not.toContain(id)
    act(() => result.current.patch({ radius: 0.3 }))
    expect(result.current.draft).toMatchObject({ avoidance: { id } })
  })

  it('locates an existing binding from a rendered part without adding a document action', () => {
    const source = createAvoidanceFixture()
    const dispatch = vi.fn()
    const { result } = renderHook(() => useAvoidanceDraft(source, dispatch))
    act(() => result.current.start('pole'))
    act(() => result.current.pickTarget('avoid:avoid-1:arc'))
    expect(result.current.draft.kind).toBe('idle')
    expect(dispatch.mock.calls).toEqual([[{ type: 'selectSegment', id: 'avoid:avoid-1:arc' }]])
  })

  it('validates the whole candidate and refuses apply while preserving a repairable draft', () => {
    const source = sourceFixture()
    source.markers.push({ ...source.markers[0], id: 'other', re: 0.6 })
    source.avoidances.push({
      ...createAvoidanceFixture().avoidances[0],
      markerId: 'other',
      radius: 0.2,
    })
    const dispatch = vi.fn()
    const { result } = renderHook(() => useAvoidanceDraft(source, dispatch))
    act(() => result.current.start('pole'))
    act(() => result.current.pickTarget('edge-a'))
    act(() => result.current.patch({ radius: 0.6 }))
    expect(result.current.preview).toMatchObject({
      ok: false,
      error: expect.stringMatching(/重叠|接近/),
    })
    act(() => result.current.apply())
    expect(dispatch).not.toHaveBeenCalled()
    expect(result.current.draft.kind).toBe('configure')
    act(() => result.current.patch({ radius: 0.1 }))
    expect(result.current.preview?.ok).toBe(true)
    act(() => result.current.patch({ radius: NaN }))
    expect(result.current.preview?.ok).toBe(false)
  })

  it('ignores invalid markers, hidden lines, point IDs and nonexistent rendered IDs', () => {
    const source = sourceFixture()
    source.closed = false
    source.segments[1] = { ...source.segments[1], kind: 'arc', through: { re: 5, im: 2 } }
    const dispatch = vi.fn()
    const { result } = renderHook(() => useAvoidanceDraft(source, dispatch))
    act(() => result.current.start('a'))
    expect(result.current.draft.kind).toBe('idle')
    act(() => result.current.start('pole'))
    for (const id of ['edge-d', 'a', 'missing', 'avoid:missing:arc']) {
      act(() => result.current.pickTarget(id))
      expect(result.current.draft.kind).toBe('pickTarget')
    }
    expect(dispatch).not.toHaveBeenCalled()
    act(() => result.current.pickTarget('edge-a'))
    expect(result.current.preview?.ok).toBe(true)
  })

  it('accepts visible independent source lines but refuses marker endpoints and omitted rendered parts', () => {
    const source = createAvoidanceFixture()
    source.markers.push({ ...source.markers[0], id: 'end', im: -2 })
    source.connections = [
      source.segments[0],
      { id: 'endpoint-line', kind: 'line', startId: 'pole', endId: 'end' },
    ]
    source.segments = source.segments.slice(1)
    source.closed = false
    expect(projectSceneError(source)).toBe('')
    const dispatch = vi.fn()
    const { result } = renderHook(() => useAvoidanceDraft(source, dispatch))
    act(() => result.current.start('pole'))
    for (const id of ['endpoint-line', 'avoid:avoid-1:entry']) {
      act(() => result.current.pickTarget(id))
      expect(result.current.draft.kind).toBe('pickTarget')
    }
    act(() => result.current.pickTarget('gap:edge-a:before:avoid-1'))
    expect(result.current.draft.kind).toBe('idle')
    expect(dispatch.mock.calls).toEqual([[{ type: 'selectSegment', id: 'avoid:avoid-1:arc' }]])
  })

  it('rejects intersections with unrelated source connections in the full preview candidate', () => {
    const source = sourceFixture()
    source.markers[0].im = -2
    source.markers.push(
      ...[-1, 1].map((re, i) => ({
        ...source.markers[0],
        id: `cross-${i}`,
        re,
        im: -2.3,
        mathematicalKind: 'ordinary' as const,
      })),
    )
    source.connections.push({ id: 'crossing', kind: 'line', startId: 'cross-0', endId: 'cross-1' })
    const dispatch = vi.fn()
    const { result } = renderHook(() => useAvoidanceDraft(source, dispatch))
    act(() => result.current.start('pole'))
    act(() => result.current.pickTarget('edge-a'))
    expect(result.current.preview).toMatchObject({
      ok: false,
      error: expect.stringContaining('crossing'),
    })
    act(() => result.current.apply())
    expect(dispatch).not.toHaveBeenCalled()
    act(() => result.current.patch({ radius: 0.1 }))
    // Radius edits do not silently shrink the independently chosen bank spacing.
    expect(result.current.preview?.ok).toBe(false)
    act(() => result.current.patch({ gap: 0.06 }))
    expect(result.current.preview?.ok).toBe(true)
  })

  it('keeps a geometrically valid draft repairable when it would exceed the accepted file budget', () => {
    const source = sourceFixture()
    source.markers = Array.from({ length: 1000 }, (_, i) => ({
      ...source.markers[0],
      id: i === 0 ? 'pole' : `point-${i}`,
      label: defaultLabel('z'),
    }))
    let remaining =
      MAX_PROJECT_BYTES - 100 - new TextEncoder().encode(serializeProject(source)).byteLength
    for (const marker of source.markers) {
      const padding = Math.min(1999, remaining)
      marker.label.tex = ' '.repeat(padding) + 'z'
      remaining -= padding
    }
    expect(remaining).toBe(0)
    expect(projectSceneError(source)).toBe('')
    const dispatch = vi.fn()
    const { result } = renderHook(() => useAvoidanceDraft(source, dispatch))
    act(() => result.current.start('pole'))
    act(() => result.current.pickTarget('edge-a'))
    expect(result.current.preview).toMatchObject({
      ok: false,
      error: expect.stringContaining('2 MB'),
    })
    act(() => result.current.apply())
    expect(dispatch).not.toHaveBeenCalled()
    expect(result.current.draft.kind).toBe('configure')
  })

  it.each(['pickTarget', 'configure'])('cancels %s when its marker becomes ordinary', (phase) => {
    const source = sourceFixture()
    const { result, rerender } = renderHook(({ state }) => useAvoidanceDraft(state, vi.fn()), {
      initialProps: { state: source },
    })
    act(() => result.current.start('pole'))
    if (phase === 'configure') act(() => result.current.pickTarget('edge-a'))
    rerender({
      state: {
        ...source,
        markers: source.markers.map((m) => ({ ...m, mathematicalKind: 'ordinary' as const })),
      },
    })
    expect(result.current.draft.kind).toBe('idle')
    expect(result.current.preview).toBeNull()
  })

  it.each(['removed', 'hidden', 'outside'] as const)(
    'cancels when a configured source becomes %s',
    (change) => {
      const source = sourceFixture()
      if (change === 'hidden') source.markers[0].im = 2
      const { result, rerender } = renderHook(
        ({ state }: { state: ContourState }) => useAvoidanceDraft(state, vi.fn()),
        { initialProps: { state: source } },
      )
      act(() => result.current.start('pole'))
      act(() => result.current.pickTarget(change === 'hidden' ? 'edge-d' : 'edge-a'))
      expect(result.current.draft.kind).toBe('configure')
      const next = { ...source }
      if (change === 'removed') next.segments = source.segments.slice(1)
      if (change === 'hidden') next.closed = false
      if (change === 'outside') next.markers = source.markers.map((m) => ({ ...m, re: 10, im: 10 }))
      rerender({ state: next })
      expect(result.current.draft.kind).toBe('idle')
      expect(result.current.preview).toBeNull()
    },
  )

  it('accepts an arc independently of chord projection and keeps constructor errors editable', () => {
    const source = sourceFixture()
    source.segments[0] = { ...source.segments[0], kind: 'arc', through: { re: 0, im: 4 } }
    source.markers[0].re = -4
    source.markers[0].im = 4
    const { result } = renderHook(() => useAvoidanceDraft(source, vi.fn()))
    act(() => result.current.start('pole'))
    act(() => result.current.pickTarget('edge-a'))
    expect(result.current.draft.kind).toBe('configure')
    expect(result.current.preview).toMatchObject({
      ok: false,
      error: expect.stringMatching(/接入区间|源路径/),
    })
    act(() => result.current.patch({ radius: 3 }))
    expect(result.current.draft).toMatchObject({ kind: 'configure', avoidance: { radius: 3 } })
  })

  it('uses the constructor short side only at creation and finds the same corner from its outgoing edge', () => {
    const source = sourceFixture()
    source.markers = []
    source.vertices[1].mathematicalKind = 'pole'
    source.vertices[2].im = -3
    source.vertices[3].im = -3
    const { result } = renderHook(() => {
      const [history, dispatch] = useReducer(historyReducer, source, createHistory)
      return { history, workflow: useAvoidanceDraft(history.present, dispatch) }
    })
    act(() => result.current.workflow.start('b'))
    act(() => result.current.workflow.pickTarget('edge-b'))
    expect(result.current.workflow.draft).toMatchObject({
      kind: 'configure',
      avoidance: {
        markerId: 'b',
        targetSegmentId: 'edge-a',
        exitSegmentId: 'edge-b',
        side: 'right',
      },
    })
    act(() => result.current.workflow.patch({ side: 'left', radius: 0.5 }))
    expect(result.current.workflow.preview?.ok).toBe(true)
    act(() => result.current.workflow.apply())
    expect(result.current.history.present.avoidances[0].side).toBe('left')
    act(() => result.current.workflow.start('b'))
    act(() => result.current.workflow.pickTarget('edge-b'))
    expect(result.current.workflow.draft.kind).toBe('idle')
    expect(result.current.history.present.selection).toEqual({
      kind: 'segment',
      id: 'avoid:avoidance-0:arc',
    })
    expect(result.current.history.present.avoidances).toHaveLength(1)
    expect(result.current.history.past).toHaveLength(1)
  })

  it('requires both corner dependencies visible and retains a target-picking error without history', () => {
    const source = sourceFixture()
    source.vertices[0].mathematicalKind = 'pole'
    source.closed = false
    const { result } = renderHook(() => useAvoidanceDraft(source, vi.fn()))
    act(() => result.current.start('a'))
    act(() => result.current.pickTarget('edge-a'))
    expect(result.current.draft).toMatchObject({
      kind: 'pickTarget',
      markerId: 'a',
      error: expect.stringMatching(/可见进入.*可见离开/),
    })
    expect(result.current.preview).toBeNull()
  })

  it.each([undefined, 'left', 'right'] as const)(
    'initializes the first successful corner side after radius repair, preserving explicit %s',
    (chosenSide) => {
      const source = delayedCornerFixture()
      const { result } = renderHook(() => {
        const [history, dispatch] = useReducer(historyReducer, source, createHistory)
        return { history, workflow: useAvoidanceDraft(history.present, dispatch) }
      })
      act(() => result.current.workflow.start('b'))
      act(() => result.current.workflow.pickTarget('edge-b'))
      expect(result.current.workflow.draft).toMatchObject({
        kind: 'configure',
        avoidance: { radius: 5 },
      })
      expect(result.current.workflow.preview?.ok).toBe(false)
      if (chosenSide) act(() => result.current.workflow.patch({ side: chosenSide }))
      act(() => result.current.workflow.patch({ radius: 0.5 }))
      const expectedSide = chosenSide ?? 'right'
      expect(result.current.workflow.draft).toMatchObject({
        kind: 'configure',
        avoidance: { side: expectedSide },
      })
      const preview = result.current.workflow.preview
      expect(preview?.ok).toBe(true)
      if (!preview?.ok) throw new Error('missing repaired preview')
      const arc = preview.scene.contourSegments.find(
        (s) => s.id === 'avoid:avoidance-0:arc',
      )!.resolvedArc!
      expect(arc.sweep).toBeCloseTo(expectedSide === 'right' ? Math.PI / 2 : (-3 * Math.PI) / 2, 12)
      // A later parameter edit must not re-initialize the side.
      act(() => result.current.workflow.patch({ radius: 0.4 }))
      expect(result.current.workflow.draft).toMatchObject({ avoidance: { side: expectedSide } })
      act(() => result.current.workflow.apply())
      expect(result.current.history.present.avoidances[0]).toMatchObject({
        side: expectedSide,
        radius: 0.4,
      })
      expect(result.current.history.past).toHaveLength(1)
    },
  )

  it('resets deferred initialization on cancellation and restarting target selection', () => {
    const source = delayedCornerFixture()
    const { result } = renderHook(() => useAvoidanceDraft(source, vi.fn()))
    act(() => result.current.start('b'))
    act(() => result.current.pickTarget('edge-a'))
    act(() => result.current.patch({ side: 'left', radius: 0.5 }))
    expect(result.current.draft).toMatchObject({ avoidance: { side: 'left' } })
    act(() => result.current.cancel())
    expect(result.current.draft.kind).toBe('idle')
    for (const edge of ['edge-a', 'edge-b']) {
      act(() => result.current.start('b'))
      act(() => result.current.pickTarget(edge))
      expect(result.current.preview?.ok).toBe(false)
      act(() => result.current.patch({ radius: 0.5 }))
      expect(result.current.preview?.ok).toBe(true)
      expect(result.current.draft).toMatchObject({ avoidance: { side: 'right' } })
      act(() => result.current.patch({ side: 'left' }))
    }
  })

  it('initializes once when a source edit makes the pending geometry constructible', () => {
    const source = delayedCornerFixture()
    const { result, rerender } = renderHook(({ state }) => useAvoidanceDraft(state, vi.fn()), {
      initialProps: { state: source },
    })
    act(() => result.current.start('b'))
    act(() => result.current.pickTarget('edge-b'))
    expect(result.current.preview?.ok).toBe(false)
    rerender({
      state: {
        ...source,
        vertices: source.vertices.map((v) =>
          v.id === 'c' || v.id === 'd' ? { ...v, re: -10 } : v,
        ),
      },
    })
    expect(result.current.preview?.ok).toBe(true)
    expect(result.current.draft).toMatchObject({ avoidance: { radius: 5, side: 'right' } })
  })
})
