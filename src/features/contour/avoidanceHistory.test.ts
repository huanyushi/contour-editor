import { describe, expect, it } from 'vitest'
import { createAvoidanceFixture } from '../../test/avoidanceFixtures'
import { MAX_PROJECT_BYTES } from '../project/format'
import { serializeProject } from '../project/project'
import { projectSceneError } from '../project/validation'
import { defaultLabel } from './appearance'
import { createHistory, historyReducer } from './history'
import { contourReducer } from './model'
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

  it('undoes and redoes an applied avoidance while preserving the current camera', () => {
    const source = createAvoidanceFixture()
    source.avoidances[0].partStyles = { arc: { color: '#123456' } }
    source.avoidances[0].partLabels = { arc: defaultLabel('C') }
    freeze(source)
    const original = freeze({ ...source, avoidances: [] })
    let history = historyReducer(createHistory(original), {
      type: 'addAvoidance',
      avoidance: source.avoidances[0],
    })
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
    let history = historyReducer(createHistory(source), {
      type: 'updateAvoidance',
      id: 'avoid-1',
      patch: { radius: 0.75 },
    })
    expect(history.past).toHaveLength(1)
    history = historyReducer(history, { type: 'undo' })
    expect(history.present.avoidances[0].radius).toBe(0.5)
    history = historyReducer(history, { type: 'redo' })
    expect(history.present.avoidances[0].radius).toBe(0.75)
    expect(source.avoidances[0].radius).toBe(0.5)
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
    const next = contourReducer(source, {
      type: 'addAvoidance',
      avoidance: { ...source.avoidances[0], id: 'invalid', targetSegmentId: 'missing' },
    })
    expect(next.avoidances).toBe(source.avoidances)
    expect(next.error).toMatch(/invalid.*missing/)
  })

  it('keeps oversized semantic candidates out of immutable history', () => {
    const fixture = createAvoidanceFixture()
    const source = { ...fixture, avoidances: [] }
    source.markers = Array.from({ length: 1000 }, (_, i) => ({
      ...fixture.markers[0],
      id: i === 0 ? 'pole' : `point-${i}`,
      label: defaultLabel('z'),
    }))
    let remaining =
      MAX_PROJECT_BYTES - 100 - new TextEncoder().encode(serializeProject(source)).length
    for (const marker of source.markers) {
      const padding = Math.min(1999, remaining)
      marker.label.tex = ' '.repeat(padding) + 'z'
      remaining -= padding
    }
    expect(remaining).toBe(0)
    expect(projectSceneError(source)).toBe('')
    freeze(source)
    const history = historyReducer(createHistory(source), {
      type: 'addAvoidance',
      avoidance: fixture.avoidances[0],
    })
    expect(history.present.markers).toBe(source.markers)
    expect(history.present.avoidances).toBe(source.avoidances)
    expect(history.present.error).toMatch(/2 MB/)
    expect(history.past).toEqual([])
    expect(history.future).toEqual([])
  })

  it('does not record an unchanged radius as a document edit', () => {
    const source = freeze(createAvoidanceFixture())
    const history = historyReducer(createHistory(source), {
      type: 'updateAvoidance',
      id: 'avoid-1',
      patch: { radius: source.avoidances[0].radius },
    })
    expect(history.past).toEqual([])
  })
})
