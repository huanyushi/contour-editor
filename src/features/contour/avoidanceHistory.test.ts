import { describe, expect, it } from 'vitest'
import { createAvoidanceFixture } from '../../test/avoidanceFixtures'
import { validateProjectCapacity } from '../project/format'
import { parseProject, serializeProject } from '../project/project'
import { projectSceneError } from '../project/validation'
import { defaultLabel } from './appearance'
import { createHistory, historyReducer } from './history'
import { contourReducer, createInitialState, type ContourState } from './model'
import { resolveScene } from './resolvedScene'
import type { AvoidanceAction } from './avoidanceModel'

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze)
    Object.freeze(value)
  }
  return value
}

describe('avoidance history and candidate acceptance', () => {
  it('does not add history or discard redo after an entirely rejected owner gesture', () => {
    const source = freeze(createAvoidanceFixture())
    let history = historyReducer(createHistory(source), {
      type: 'updateAvoidance',
      id: 'avoid-1',
      patch: { radius: 0.75 },
    })
    history = historyReducer(history, { type: 'undo' })
    const past = history.past,
      future = history.future
    history = historyReducer(history, { type: 'beginGesture', owner: 'slider-pointer' })
    history = historyReducer(history, {
      type: 'updateAvoidance',
      id: 'avoid-1',
      patch: { radius: -1 },
    })
    expect(history.present.error).not.toBe('')
    history = historyReducer(history, { type: 'endGesture', owner: 'slider-pointer' })
    expect(history.present.avoidances).toBe(source.avoidances)
    expect(history.past).toBe(past)
    expect(history.future).toBe(future)
  })

  it('groups owner moves and side updates into one undo step while rejecting failed moves', () => {
    const source = freeze(createAvoidanceFixture())
    let history = historyReducer(createHistory(source), { type: 'beginGesture', owner: 'canvas' })
    for (const im of [-0.75, -1]) {
      history = historyReducer(history, {
        type: 'moveObject',
        kind: 'marker',
        id: 'pole',
        point: { re: 0, im },
      })
      expect(history.present.error).toBe('')
      expect(history.present.avoidances[0].side).toBe('right')
      expect(history.past).toHaveLength(0)
    }
    const valid = history.present
    history = historyReducer(history, {
      type: 'moveObject',
      kind: 'marker',
      id: 'pole',
      point: { re: 0, im: 2.8 },
    })
    expect(history.present.markers).toBe(valid.markers)
    expect(history.present.avoidances).toBe(valid.avoidances)
    expect(history.present.error).not.toBe('')
    expect(historyReducer(history, { type: 'endGesture', owner: 'slider-pointer' })).toBe(history)
    history = historyReducer(history, { type: 'endGesture', owner: 'canvas' })
    expect(history.past).toHaveLength(1)
    history = historyReducer(history, { type: 'undo' })
    expect(history.present.markers).toEqual(source.markers)
    expect(history.present.avoidances).toEqual(source.avoidances)
    history = historyReducer(history, { type: 'redo' })
    expect(history.present.markers[0].im).toBe(-1)
    expect(history.present.avoidances[0].side).toBe('right')
  })

  it('cancels only the owner gesture and restores initial source coordinates, side and history', () => {
    const source = freeze(createAvoidanceFixture())
    let history = historyReducer(createHistory(source), { type: 'beginGesture', owner: 'canvas' })
    history = historyReducer(history, {
      type: 'moveObject',
      kind: 'marker',
      id: 'pole',
      point: { re: 1, im: -1 },
    })
    expect(history.present.avoidances[0].side).toBe('right')
    expect(historyReducer(history, { type: 'cancelGesture', owner: 'generic' })).toBe(history)
    history = historyReducer(history, { type: 'cancelGesture', owner: 'canvas' })
    expect(history.present.markers).toBe(source.markers)
    expect(history.present.avoidances).toBe(source.avoidances)
    expect(history.past).toEqual([])
    expect(history.future).toEqual([])
    expect(history.gesture).toBeNull()
  })

  it.each([
    { type: 'updateAvoidance', id: 'avoid-1', patch: { radius: NaN } },
    { type: 'updateAvoidance', id: 'avoid-1', patch: { radius: 0 } },
    { type: 'updateAvoidance', id: 'avoid-1', patch: { openingRatio: Infinity } },
    { type: 'updateAvoidance', id: 'avoid-1', patch: { openingRatio: -0.1 } },
    { type: 'updateAvoidance', id: 'avoid-1', patch: { side: 'corrupt' } },
    { type: 'avoidanceStyle', id: 'avoid-1', part: 'arc', patch: { width: 999 } },
    { type: 'avoidanceStyle', id: 'avoid-1', part: 'corrupt', patch: { width: 3 } },
    { type: 'avoidanceLabel', id: 'avoid-1', part: 'arc', label: defaultLabel('\\unknownCommand') },
    {
      type: 'avoidanceLabel',
      id: 'avoid-1',
      part: 'arc',
      label: { ...defaultLabel('C'), dx: Infinity },
    },
  ] as AvoidanceAction[])(
    'rejects corrupted parameters/appearance atomically without losing redo: $type $patch',
    (action) => {
      const source = freeze(createAvoidanceFixture())
      let history = historyReducer(createHistory(source), {
        type: 'updateAvoidance',
        id: 'avoid-1',
        patch: { radius: 0.75 },
      })
      history = freeze(historyReducer(history, { type: 'undo' }))
      expect(history.future).toHaveLength(1)
      const saved = serializeProject(history.present)
      const after = historyReducer(history, action)
      expect(after.present.error).not.toBe('')
      expect(after.present.avoidances).toBe(history.present.avoidances)
      expect(after.present.markers).toBe(history.present.markers)
      expect(after.present.segments).toBe(history.present.segments)
      expect(after.past).toBe(history.past)
      expect(after.future).toBe(history.future)
      expect(serializeProject(after.present)).toBe(saved)
    },
  )

  it('undoes and redoes a source document replacement while preserving the current camera', () => {
    const original = freeze(createInitialState())
    const source = createAvoidanceFixture()
    source.avoidances[0].partStyles = { arc: { color: '#123456' } }
    source.avoidances[0].partLabels = { arc: defaultLabel('C') }
    freeze(source)
    let history = historyReducer(createHistory(original), { type: 'loadProject', state: source })
    expect(history.past).toHaveLength(1)
    history = historyReducer(history, {
      type: 'viewport',
      value: { ...source.viewport, centerRe: 2, scaleX: 60, scaleY: 60 },
    })
    const camera = history.present.viewport
    history = historyReducer(history, { type: 'undo' })
    expect(history.present.avoidances).toEqual([])
    expect(history.present.viewport).toBe(camera)
    history = historyReducer(history, { type: 'redo' })
    expect(history.present.avoidances).toEqual(source.avoidances)
    expect(history.present.markers[0].mathematicalKind).toBe('pole')
    expect(history.present.viewport).toBe(camera)
    expect(resolveScene(history.present)).toEqual(resolveScene(source))
    expect(source.vertices).toHaveLength(4)
    expect(source.avoidances[0].radius).toBe(0.5)
  })

  it('records radius-only declaration changes and restores immutable snapshots', () => {
    const source = freeze(createAvoidanceFixture())
    const changed = freeze({ ...source, avoidances: [{ ...source.avoidances[0], radius: 0.75 }] })
    let history = historyReducer(createHistory(source), { type: 'loadProject', state: changed })
    expect(history.past).toHaveLength(1)
    history = historyReducer(history, { type: 'undo' })
    expect(history.present.avoidances[0].radius).toBe(0.5)
    history = historyReducer(history, { type: 'redo' })
    expect(history.present.avoidances[0].radius).toBe(0.75)
    expect(source.avoidances[0].radius).toBe(0.5)
  })

  it.each<[string, (state: ContourState) => void, RegExp]>([
    [
      'out-of-range part width',
      (state) => {
        state.avoidances[0].partStyles = { arc: { width: 999 } }
      },
      /样式/,
    ],
    [
      'non-finite part label offset',
      (state) => {
        state.avoidances[0].partLabels = { arc: { ...defaultLabel('C'), dx: Infinity } }
      },
      /有限数值/,
    ],
    [
      'invalid part label TeX',
      (state) => {
        state.avoidances[0].partLabels = { arc: defaultLabel('\\unknownCommand') }
      },
      /公式/,
    ],
  ])(
    'rejects %s without replacing the document or either history stack',
    (_name, mutate, error) => {
      const source = freeze(createAvoidanceFixture())
      let history = historyReducer(createHistory(), { type: 'loadProject', state: source })
      history = historyReducer(history, {
        type: 'loadProject',
        state: { ...source, avoidances: [{ ...source.avoidances[0], radius: 0.75 }] },
      })
      const before = freeze(historyReducer(history, { type: 'undo' }))
      expect(before.past).toHaveLength(1)
      expect(before.future).toHaveLength(1)
      const saved = serializeProject(before.present)
      const candidate = {
        ...before.present,
        avoidances: [{ ...before.present.avoidances[0] }],
      }
      mutate(candidate)
      freeze(candidate)
      // These are valid TypeScript action values, but the real reader rejects them.
      expect(() => parseProject(serializeProject(candidate))).toThrow(error)
      const rejected = historyReducer(before, { type: 'loadProject', state: candidate })
      expect(rejected.present.error).toMatch(error)
      expect({ ...rejected.present, error: '' }).toEqual(before.present)
      expect(rejected.present.vertices).toBe(before.present.vertices)
      expect(rejected.present.markers).toBe(before.present.markers)
      expect(rejected.present.avoidances).toBe(before.present.avoidances)
      expect(rejected.past).toBe(before.past)
      expect(rejected.future).toBe(before.future)
      expect(serializeProject(before.present)).toBe(saved)
      expect(parseProject(saved).avoidances).toEqual(source.avoidances)
      expect(projectSceneError(candidate)).toMatch(error)
      expect(validateProjectCapacity(candidate)).toMatchObject({
        ok: false,
        error: expect.stringMatching(error),
      })
    },
  )

  it.each([
    [
      'dangling reference',
      (s: ContourState) => {
        s.avoidances[0].targetSegmentId = 'missing'
      },
      /missing/,
    ],
    [
      'ordinary marker',
      (s: ContourState) => {
        s.markers[0].mathematicalKind = 'ordinary'
      },
      /非普通/,
    ],
    [
      'invalid radius',
      (s: ContourState) => {
        s.avoidances[0].radius = 0
      },
      /半径/,
    ],
  ])('rejects a %s atomically without changing history', (_name, mutate, error) => {
    const source = freeze(createAvoidanceFixture())
    const invalid = structuredClone(source)
    mutate(invalid)
    const history = historyReducer(createHistory(source), { type: 'loadProject', state: invalid })
    expect(history.present.error).toMatch(error)
    expect({ ...history.present, error: '' }).toEqual(source)
    expect(history.present.vertices).toBe(source.vertices)
    expect(history.present.avoidances).toBe(source.avoidances)
    expect(history.past).toEqual([])
  })

  it('rejects an ordinary geometry edit invalidating a binding at the final boundary', () => {
    const source = freeze(createAvoidanceFixture())
    const next = contourReducer(source, {
      type: 'moveObject',
      kind: 'marker',
      id: 'pole',
      point: { re: 8, im: 0 },
    })
    expect(next.markers).toBe(source.markers)
    expect(next.avoidances).toBe(source.avoidances)
    expect(next.error).not.toBe('')
  })

  it('rejects a marker move whose generated arc crosses another source edge atomically', () => {
    const source = freeze(createAvoidanceFixture())
    const next = contourReducer(source, {
      type: 'moveObject',
      kind: 'marker',
      id: 'pole',
      point: { re: 0, im: 2.8 },
    })
    expect(next.markers).toBe(source.markers)
    expect(next.avoidances).toBe(source.avoidances)
    expect(next.error).toMatch(/相交|相切|重叠/)
  })

  it('rejects a declaration-only invalid change before any capacity or projected scene use', () => {
    const source = freeze(createAvoidanceFixture())
    const invalid = {
      ...source,
      avoidances: [{ ...source.avoidances[0], targetSegmentId: 'missing' }],
    }
    const next = contourReducer(source, { type: 'loadProject', state: invalid })
    expect(next.avoidances).toBe(source.avoidances)
    expect(next.error).toMatch(/avoid-1.*missing/)
  })

  it('keeps oversized semantic candidates out of immutable history', () => {
    const source = freeze(createAvoidanceFixture())
    const oversized = {
      ...source,
      markers: Array.from({ length: 1000 }, (_, i) => ({
        ...source.markers[0],
        id: i === 0 ? 'pole' : `point-${i}`,
        label: defaultLabel(' '.repeat(1999) + 'z'),
      })),
    }
    const history = historyReducer(createHistory(source), { type: 'loadProject', state: oversized })
    expect(history.present.markers).toBe(source.markers)
    expect(history.present.avoidances).toBe(source.avoidances)
    expect(history.present.error).toMatch(/2 MB/)
    expect(history.past).toEqual([])
    expect(history.future).toEqual([])
  })

  it('does not record reloaded equivalent declarations as a document edit', () => {
    const source = freeze(createAvoidanceFixture())
    const history = historyReducer(createHistory(source), {
      type: 'loadProject',
      state: structuredClone(source),
    })
    expect(history.past).toEqual([])
  })
})
