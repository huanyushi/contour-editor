import { describe, expect, it } from 'vitest'
import { createAvoidanceFixture } from '../../test/avoidanceFixtures'
import { defaultLabel, type SelectionItem } from './appearance'
import { contourReducer, type ContourState } from './model'
import { createHistory, historyReducer } from './history'
import { translateSelection, translationAnchor } from './selectionTransform'
import { itemAnchor, itemsWithinRect, selectionBounds } from './selectionGeometry'
import { itemColor, itemLabel } from './selectionModel'
import { findPoint, findSegment, resolvedScene, scenePoints, segmentOrigin } from './sceneObjects'
import {
  selectedSegmentLabel,
  selectedSegmentStyle,
  translationSources,
} from './avoidanceSelection'

const arc: SelectionItem = { kind: 'segment', id: 'avoid:avoid-1:arc' }
const entry: SelectionItem = { kind: 'segment', id: 'avoid:avoid-1:entry' }
const gap: SelectionItem = { kind: 'segment', id: 'gap:edge-a:before:avoid-1' }
const source: SelectionItem = { kind: 'segment', id: 'edge-a' }
const label = (item: SelectionItem): SelectionItem => ({ ...item, part: 'label' }) as SelectionItem

function select(state: ContourState, items: SelectionItem[]): ContourState {
  return { ...state, selection: { kind: 'multiple', items }, selectionSource: 'marquee' }
}

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze)
    Object.freeze(value)
  }
  return value
}

function labelled(): ContourState {
  const state = createAvoidanceFixture()
  state.segments[0] = { ...state.segments[0], label: defaultLabel('S') }
  state.avoidances[0].partLabels = { arc: defaultLabel('A'), entry: defaultLabel('E') }
  state.avoidances[0].partStyles = { arc: { color: '#123456', width: 5 } }
  return state
}

describe('avoidance selection mapping', () => {
  it('retains hidden closing ownership for mixed part, gap and label selections and their edits', () => {
    const state = createAvoidanceFixture()
    state.markers[0] = { ...state.markers[0], re: -4, im: 1.5 }
    state.avoidances[0].targetSegmentId = 'edge-d'
    state.avoidances[0].partLabels = { arc: defaultLabel('A') }
    state.segments[3] = { ...state.segments[3], label: defaultLabel('S') }
    const closingGap: SelectionItem = { kind: 'segment', id: 'gap:edge-d:before:avoid-1' }
    const items = [
      arc,
      entry,
      closingGap,
      label(arc),
      label(closingGap),
      { kind: 'marker' as const, id: 'pole' },
    ]
    const selected = contourReducer(state, { type: 'selectMany', items })
    const opened = contourReducer(selected, { type: 'toggleClosed' })
    expect(opened.error).toBe('')
    expect(opened.selection).toEqual(selected.selection)
    for (const item of items) {
      if (item.kind !== 'segment') continue
      expect(segmentOrigin(opened, item.id)?.sourceSegmentId).toBe('edge-d')
      expect(contourReducer(opened, { type: 'selectMany', items: [item] }).selection).toEqual(item)
      expect(selectionBounds(opened, [item])).toBeNull()
    }
    const styled = contourReducer(opened, { type: 'selectionStyle', patch: { color: '#112233' } })
    expect(styled.error).toBe('')
    expect(styled.avoidances[0].partStyles?.arc?.color).toBe('#112233')
    expect(styled.avoidances[0].partStyles?.entry?.color).toBe('#112233')
    expect(styled.avoidances[0].partLabels?.arc?.color).toBe('#112233')
    expect(styled.segments[3].style?.color).toBe('#112233')
    expect(styled.segments[3].label?.color).toBe('#112233')
    expect(
      resolvedScene(styled).labels.some(
        (l) => l.target.id.includes('avoid-1') || l.target.id === 'edge-d',
      ),
    ).toBe(false)
    const closed = contourReducer(styled, { type: 'toggleClosed' })
    expect(closed.error).toBe('')
    expect(resolvedScene(closed).contourSegments.some((s) => s.id === arc.id)).toBe(true)
  })

  it('moves the source endpoints and pole once when arc and pole are both selected', () => {
    const from = freeze(select(createAvoidanceFixture(), [arc, { kind: 'marker', id: 'pole' }]))
    const candidate = translateSelection(from, { re: 1, im: 1 })
    expect(candidate.markers[0]).toMatchObject({ re: 1, im: 1 })
    expect(candidate.vertices[0]).toMatchObject({ re: -3, im: 1 })
    expect(candidate.vertices[1]).toMatchObject({ re: 5, im: 1 })
    const next = contourReducer(from, { type: 'translateSelection', from, delta: { re: 1, im: 1 } })
    expect(next.error).toBe('')
    expect(next.vertices).toEqual(candidate.vertices)
    expect(next.markers).toEqual(candidate.markers)
    expect(translationAnchor(from)).toMatchObject({ re: -4, im: 0 })
    expect(from.vertices[0].re).toBe(-4)
  })

  it('selects generated geometry and logically owned vanished connectors through every selection action', () => {
    const state = createAvoidanceFixture()
    for (const item of [arc, entry, gap, source]) {
      if (item.kind !== 'segment') continue
      expect(contourReducer(state, { type: 'selectSegment', id: item.id }).selection).toEqual(item)
      expect(contourReducer(state, { type: 'selectObject', selection: item }).selection).toEqual(
        item,
      )
      expect(contourReducer(state, { type: 'selectMany', items: [item] }).selection).toEqual(item)
      expect(
        contourReducer({ ...state, selection: { kind: 'none' } }, { type: 'toggleSelection', item })
          .selection,
      ).toEqual(item)
    }
    expect(selectionBounds(state, [entry])).toBeNull()
    expect(findSegment(state, 'avoid:avoid-1:arc')).toBeUndefined()
    expect(findPoint(state, 'avoid:avoid-1:entry-base')).toBeUndefined()
    expect(scenePoints(state).map((p) => p.id)).toEqual(['a', 'b', 'c', 'd', 'pole'])
  })

  it('uses actual major-arc extents for marquee and the whole resolved chain for source selection', () => {
    const state = createAvoidanceFixture()
    state.markers[0].im = 1
    state.avoidances[0].radius = 1
    expect(
      itemsWithinRect(state, { left: 340, right: 460, top: 240, bottom: 310 }),
    ).not.toContainEqual(arc)
    expect(itemsWithinRect(state, { left: 340, right: 460, top: 200, bottom: 310 })).toContainEqual(
      arc,
    )
    const bounds = selectionBounds(state, [source])!
    expect(bounds.left).toBeLessThanOrEqual(234)
    expect(bounds.right).toBeGreaterThanOrEqual(566)
    expect(bounds.top).toBeLessThan(220)
    expect(selectionBounds(state, [{ kind: 'contour' }])!.top).toBeLessThanOrEqual(bounds.top)
  })

  it('uses unified source and part label anchors, including independently selectable source labels', () => {
    const state = labelled()
    state.markers[0].re = -1
    state.markers[0].im = 1
    const scene = resolvedScene(state)
    for (const item of [source, arc]) {
      if (item.kind !== 'segment') continue
      const anchor = scene.labels.find((l) => l.target.id === item.id)!.anchor
      const expected = { x: 400 + anchor.re * 40, y: 300 - anchor.im * 40 }
      expect(itemAnchor(state, label(item))).toEqual(expected)
      expect(itemLabel(state, label(item))?.tex).toBe(item.id === 'edge-a' ? 'S' : 'A')
    }
    const anchor = itemAnchor(state, label(source))!
    expect(
      itemsWithinRect(state, {
        left: anchor.x + 11,
        right: anchor.x + 80,
        top: anchor.y - 25,
        bottom: anchor.y + 10,
      }),
    ).toContainEqual(label(source))
    expect(itemColor(state, arc)).toBe('#123456')
  })

  it.each([arc, entry])(
    'cancels the binding when deleting part geometry $id, retaining its source and pole',
    (item) => {
      const state = freeze(select(labelled(), [item]))
      const next = contourReducer(state, { type: 'deleteSelection' })
      expect(next.error).toBe('')
      expect(next.avoidances).toEqual([])
      expect(next.segments).toBe(state.segments)
      expect(next.markers).toBe(state.markers)
    },
  )

  it.each([source, gap])(
    'deletes source and dependent bindings for $id in one history step',
    (item) => {
      const state = freeze(select(labelled(), [item, label(arc), entry]))
      const history = historyReducer(createHistory(state), { type: 'deleteSelection' })
      expect(history.present.error).toBe('')
      expect(history.present.segments.map((s) => s.id)).not.toContain('edge-a')
      expect(history.present.avoidances).toEqual([])
      expect(history.present.vertices).toBe(state.vertices)
      expect(history.past).toHaveLength(1)
      expect(historyReducer(history, { type: 'undo' }).present.avoidances).toEqual(state.avoidances)
    },
  )

  it('hides part labels without cancelling bindings, including a vanished connector label', () => {
    const state = freeze(select(labelled(), [label(arc), label(entry)]))
    const next = contourReducer(state, { type: 'deleteSelection' })
    expect(next.error).toBe('')
    expect(next.avoidances).toHaveLength(1)
    expect(next.avoidances[0].partLabels?.arc?.visible).toBe(false)
    expect(next.avoidances[0].partLabels?.entry?.visible).toBe(false)
    expect(next.segments).toBe(state.segments)
  })

  it('routes generic stroke and label actions to part overrides while keeping source and gap routes on source', () => {
    const state = freeze(labelled())
    let next = contourReducer(state, {
      type: 'stroke',
      id: 'avoid:avoid-1:entry',
      patch: { width: 6 },
    })
    next = contourReducer(next, { type: 'label', target: arc, label: defaultLabel('B') })
    expect(next.avoidances[0].partStyles?.entry?.width).toBe(6)
    expect(next.avoidances[0].partLabels?.arc?.tex).toBe('B')
    expect(next.segments).toBe(state.segments)
    next = contourReducer(next, {
      type: 'stroke',
      id: 'gap:edge-a:before:avoid-1',
      patch: { width: 3 },
    })
    next = contourReducer(next, { type: 'label', target: source, label: defaultLabel('T') })
    expect(next.segments[0]).toMatchObject({ style: { width: 3 }, label: { tex: 'T' } })
    expect(next.avoidances[0].partStyles?.arc?.width).toBe(5)
  })

  it('applies mixed batch color, width and font size atomically to source and part labels', () => {
    const state = freeze(
      select(labelled(), [source, arc, entry, label(source), label(arc), label(entry)]),
    )
    const history = historyReducer(createHistory(state), {
      type: 'selectionStyle',
      patch: { color: '#abcdef', width: 4, labelSize: 22 },
    })
    const next = history.present
    expect(next.error).toBe('')
    expect(next.segments[0]).toMatchObject({
      style: { color: '#abcdef', width: 4 },
      label: { color: '#abcdef', size: 22 },
    })
    expect(next.avoidances[0].partStyles).toMatchObject({
      arc: { color: '#abcdef', width: 4 },
      entry: { color: '#abcdef', width: 4 },
    })
    expect(next.avoidances[0].partLabels).toMatchObject({
      arc: { color: '#abcdef', size: 22 },
      entry: { color: '#abcdef', size: 22 },
    })
    expect(history.past).toHaveLength(1)
  })

  it('deduplicates explicit dependencies without following another binding that shares the pole', () => {
    const state = createAvoidanceFixture()
    state.closed = false
    state.vertices[2].im = -2
    state.vertices[3].im = -2
    // Retain a hidden closing edge with its own binding to the same pole.
    state.segments = [state.segments[0], state.segments[1], state.segments[3], state.segments[2]]
    state.avoidances.push({ ...state.avoidances[0], id: 'hidden', targetSegmentId: 'edge-c' })
    const from = freeze(
      select(state, [arc, entry, { kind: 'marker', id: 'pole' }, { kind: 'vertex', id: 'a' }]),
    )
    const sources = translationSources(from, [arc, entry, { kind: 'marker', id: 'pole' }])
    expect([...sources.pointIds]).toEqual(['a', 'b', 'pole'])
    expect([...sources.segmentIds]).toEqual(['edge-a'])
    expect([...sources.formulaIds]).toEqual([])
    const candidate = translateSelection(from, { re: 0.25, im: 0.25 })
    expect(candidate.vertices[0]).toMatchObject({ re: -3.75, im: 0.25 })
    expect(candidate.vertices[2]).toBe(from.vertices[2])
    expect(candidate.vertices[3]).toBe(from.vertices[3])
    const next = contourReducer(from, {
      type: 'translateSelection',
      from,
      delta: { re: 0.25, im: 0.25 },
    })
    expect(next.error).toBe('')
    expect(next.markers[0]).toMatchObject({ re: 0.25, im: 0.25 })
    expect(next.vertices[2]).toBe(from.vertices[2])
    expect(next.avoidances).toHaveLength(2)
  })

  it('moves an entire contour with all bound poles and source arc through-points', () => {
    const state = labelled()
    state.segments[2] = { ...state.segments[2], kind: 'arc', through: { re: 0, im: 4 } }
    const from = freeze(select(state, [{ kind: 'contour' }, arc, label(arc)]))
    const next = contourReducer(from, { type: 'translateSelection', from, delta: { re: 1, im: 1 } })
    expect(next.error).toBe('')
    expect(next.vertices[0]).toMatchObject({ re: -3, im: 1 })
    expect(next.vertices[2]).toMatchObject({ re: 5, im: 4 })
    expect(next.markers[0]).toMatchObject({ re: 1, im: 1 })
    expect(next.segments[2]).toMatchObject({ through: { re: 1, im: 5 } })
    expect(next.avoidances[0].partLabels?.arc).toEqual(from.avoidances[0].partLabels?.arc)
  })

  it('keeps source and part label-only translation in pixels under unequal scales', () => {
    const state = labelled()
    state.viewport = { ...state.viewport, scaleX: 80, scaleY: 20, locked: false }
    const from = freeze(select(state, [label(source), label(arc)]))
    const next = contourReducer(from, {
      type: 'translateSelection',
      from,
      delta: { re: 0.2, im: 0.5 },
    })
    expect(next.error).toBe('')
    expect(next.vertices).toEqual(from.vertices)
    expect(next.markers).toEqual(from.markers)
    expect(next.segments[0].label).toMatchObject({ dx: 28, dy: -34 })
    expect(next.avoidances[0].partLabels?.arc).toMatchObject({ dx: 28, dy: -34 })
  })

  it('compensates a selected part label for an anchor changed by a separately moved pole', () => {
    const from = freeze(select(labelled(), [{ kind: 'marker', id: 'pole' }, label(arc)]))
    const next = contourReducer(from, { type: 'translateSelection', from, delta: { re: 0, im: 1 } })
    expect(next.error).toBe('')
    // Both the label and its arc midpoint moved up 40px: no double label movement.
    expect(next.avoidances[0].partLabels?.arc).toMatchObject({ dx: 12, dy: -24 })
    expect(next.vertices).toEqual(from.vertices)
  })

  it('bases repeated moves on drag start and restores binding labels on cancel and undo', () => {
    const from = freeze(select(labelled(), [label(arc), arc, { kind: 'marker', id: 'pole' }]))
    let history = historyReducer(createHistory(from), { type: 'beginGesture', owner: 'canvas' })
    history = historyReducer(history, {
      type: 'translateSelection',
      from,
      delta: { re: 0.25, im: 0 },
    })
    history = historyReducer(history, {
      type: 'translateSelection',
      from,
      delta: { re: 0.5, im: 0.25 },
    })
    expect(history.present.error).toBe('')
    expect(history.present.vertices[0]).toMatchObject({ re: -3.5, im: 0.25 })
    expect(history.present.markers[0]).toMatchObject({ re: 0.5, im: 0.25 })
    expect(historyReducer(history, { type: 'cancelGesture', owner: 'canvas' }).present).toEqual(
      from,
    )
    history = historyReducer(history, { type: 'endGesture', owner: 'canvas' })
    expect(history.past).toHaveLength(1)
    expect(historyReducer(history, { type: 'undo' }).present).toEqual(from)
  })

  it.each([
    { initialSide: 'left' as const, away: -1, learnedSide: 'right', throughIm: -0.5 },
    { initialSide: 'right' as const, away: 1, learnedSide: 'left', throughIm: 0.5 },
  ])(
    'retains the learned side returning online from $initialSide in one cancellable drag',
    ({ initialSide, away, learnedSide, throughIm }) => {
      const state = createAvoidanceFixture()
      state.avoidances[0].side = initialSide
      const from = freeze(select(state, [{ kind: 'marker', id: 'pole' }]))
      let history = historyReducer(createHistory(from), { type: 'beginGesture', owner: 'canvas' })
      history = historyReducer(history, {
        type: 'translateSelection',
        from,
        delta: { re: 0, im: away },
      })
      expect(history.present.error).toBe('')
      expect(history.present.avoidances[0].side).toBe(learnedSide)
      const direct = contourReducer(history.present, {
        type: 'moveObject',
        kind: 'marker',
        id: 'pole',
        point: { re: 0, im: 0 },
      })
      history = historyReducer(history, {
        type: 'translateSelection',
        from,
        delta: { re: 0, im: 0 },
      })
      expect(history.present.error).toBe('')
      expect(history.present.markers[0]).toMatchObject({ re: 0, im: 0 })
      expect(history.present.avoidances[0].side).toBe(learnedSide)
      expect(history.present.avoidances[0].side).toBe(direct.avoidances[0].side)
      expect(
        resolvedScene(history.present)
          .chains.get('edge-a')!
          .find((s) => s.kind === 'arc'),
      ).toMatchObject({ through: { re: 0, im: throughIm } })
      expect(history.past).toHaveLength(0)
      expect(historyReducer(history, { type: 'cancelGesture', owner: 'canvas' }).present).toEqual(
        from,
      )
      history = historyReducer(history, { type: 'endGesture', owner: 'canvas' })
      expect(history.past).toHaveLength(1)
      const undone = historyReducer(history, { type: 'undo' })
      expect(undone.present).toEqual(from)
      expect(historyReducer(undone, { type: 'redo' }).present.avoidances[0].side).toBe(learnedSide)
    },
  )

  it.each([
    { initialSide: 'left' as const, away: -1, learnedSide: 'right', anchorY: 320, labelDy: -64 },
    { initialSide: 'right' as const, away: 1, learnedSide: 'left', anchorY: 280, labelDy: 16 },
  ])(
    'compensates source and part labels against the kept online geometry after leaving $initialSide',
    ({ initialSide, away, learnedSide, anchorY, labelDy }) => {
      const state = labelled()
      state.avoidances[0].side = initialSide
      const from = freeze(
        select(state, [{ kind: 'marker', id: 'pole' }, label(source), label(arc)]),
      )
      const awayState = contourReducer(from, {
        type: 'translateSelection',
        from,
        delta: { re: 0, im: away },
      })
      const returned = contourReducer(awayState, {
        type: 'translateSelection',
        from,
        delta: { re: 0, im: 0 },
      })
      expect(returned.error).toBe('')
      expect(returned.avoidances[0].side).toBe(learnedSide)
      expect(returned.vertices).toEqual(from.vertices)
      for (const item of [label(source), label(arc)]) {
        expect(itemAnchor(returned, item)).toEqual({ x: 400, y: anchorY })
        expect(itemLabel(returned, item)).toMatchObject({ dx: 12, dy: labelDy })
      }
      // A repeated zero-distance event must keep drag-start-based offsets, not accumulate them.
      const repeated = contourReducer(returned, {
        type: 'translateSelection',
        from,
        delta: { re: 0, im: 0 },
      })
      expect(repeated.avoidances).toEqual(returned.avoidances)
      expect(repeated.segments).toEqual(returned.segments)
    },
  )

  it('validates other shared-endpoint geometry and rejects the entire translated candidate', () => {
    const state = labelled()
    state.segments[1] = { ...state.segments[1], kind: 'arc', through: { re: 5, im: 1.5 } }
    const from = freeze(select(state, [arc, label(arc)]))
    const candidate = translateSelection(from, { re: 2, im: 0 })
    expect(candidate.vertices[1].re).toBe(6)
    // The unselected arc shares b; it is not pruned from the candidate.
    expect(candidate.segments[1]).toBe(from.segments[1])
    const next = contourReducer(from, { type: 'translateSelection', from, delta: { re: 2, im: 0 } })
    expect(next.error).not.toBe('')
    expect(next.vertices).toBe(from.vertices)
    expect(next.markers).toBe(from.markers)
    expect(next.avoidances).toBe(from.avoidances)
  })

  it('deletes a mixed set of source points, source paths, parts and labels from its original ownership', () => {
    const state = freeze(
      select(labelled(), [
        { kind: 'vertex', id: 'a' },
        gap,
        arc,
        label(arc),
        { kind: 'marker', id: 'pole' },
        label(source),
      ]),
    )
    const next = contourReducer(state, { type: 'deleteSelection' })
    expect(next.error).toBe('')
    expect(next.vertices.map((p) => p.id)).toEqual(['b', 'c', 'd'])
    expect(next.segments.map((s) => s.id)).toEqual(['edge-b', 'edge-c'])
    expect(next.markers).toEqual([])
    expect(next.avoidances).toEqual([])
    expect(next.selection).toEqual({ kind: 'none' })
  })

  it('queries inherited and overridden appearance even after a connector vanishes', () => {
    const state = labelled()
    expect(selectedSegmentLabel(state, 'edge-a')?.tex).toBe('S')
    expect(selectedSegmentLabel(state, 'avoid:avoid-1:entry')?.tex).toBe('E')
    expect(selectedSegmentStyle(state, 'avoid:avoid-1:arc')).toMatchObject({
      width: 5,
      color: '#123456',
    })
    expect(selectedSegmentStyle(state, 'avoid:avoid-1:entry')).toMatchObject({
      width: 2,
      color: '#263238',
    })
    expect(selectedSegmentStyle(state, 'missing')).toBeUndefined()
    const moved = contourReducer(
      { ...state, selection: entry },
      { type: 'moveObject', kind: 'marker', id: 'pole', point: { re: 0, im: 1 } },
    )
    const vanished = contourReducer(moved, {
      type: 'moveObject',
      kind: 'marker',
      id: 'pole',
      point: { re: 0, im: 0 },
    })
    expect(vanished.selection).toEqual(entry)
    expect(selectionBounds(vanished, [entry])).toBeNull()
    expect(selectedSegmentLabel(vanished, 'avoid:avoid-1:entry')?.tex).toBe('E')
  })

  it('bounds an independently selected source label without including its distant part label', () => {
    const state = labelled()
    state.avoidances[0].partLabels!.arc = { ...defaultLabel('A'), dx: 500 }
    const bounds = selectionBounds(state, [label(source)])!
    expect(bounds.right).toBeLessThan(460)
    expect(selectionBounds(state, [source])!.right).toBeGreaterThan(900)
  })

  it('rejects a full-scene collision after translation without applying selected label offsets', () => {
    const from = freeze(select(labelled(), [arc, label(arc)]))
    const candidate = translateSelection(from, { re: 0, im: 2.8 })
    expect(candidate.markers[0].im).toBe(2.8)
    const history = historyReducer(createHistory(from), {
      type: 'translateSelection',
      from,
      delta: { re: 0, im: 2.8 },
    })
    expect(history.present.error).toMatch(/相交|相切|重叠/)
    expect(history.present.vertices).toBe(from.vertices)
    expect(history.present.avoidances).toBe(from.avoidances)
    expect(history.past).toHaveLength(0)
  })

  it('maps independent avoidance connections to marker endpoints and deletes only their source', () => {
    const state = labelled()
    state.closed = false
    state.connections = [state.segments[0]]
    state.segments = []
    state.markers.push(...state.vertices.slice(0, 2).map((p) => ({ ...state.markers[0], ...p })))
    state.vertices = []
    const from = freeze(select(state, [arc, entry, { kind: 'marker', id: 'a' }]))
    const next = contourReducer(from, { type: 'translateSelection', from, delta: { re: 1, im: 1 } })
    expect(next.error).toBe('')
    expect(next.markers.map(({ re, im }) => ({ re, im }))).toEqual([
      { re: 1, im: 1 },
      { re: -3, im: 1 },
      { re: 5, im: 1 },
    ])
    expect(selectionBounds(next, [source])).not.toBeNull()
    expect(
      contourReducer(select(next, [gap, label(arc)]), { type: 'deleteSelection' }),
    ).toMatchObject({ connections: [], avoidances: [] })
    const cancelled = contourReducer(from, { type: 'deleteSegment', id: 'avoid:avoid-1:entry' })
    expect(cancelled.error).toBe('')
    expect(cancelled.connections).toEqual(from.connections)
    expect(cancelled.avoidances).toEqual([])
  })
})
