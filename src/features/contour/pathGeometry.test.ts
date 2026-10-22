import { describe, expect, it } from 'vitest'
import { createInitialState, contourReducer } from './model'
import { createArcFixture } from '../../test/fixtures'
import { buildContourGeometry, buildSceneGeometry } from './pathGeometry'
import { createAvoidanceFixture } from '../../test/avoidanceFixtures'
import { defaultLabel } from './appearance'
import { resolvedScene } from './sceneObjects'
import { createRectangleConnectedFixture } from '../../test/connectedAvoidanceFixtures'
import { sourcePieceId } from './sourcePieces'

describe('resolved SVG geometry', () => {
  it('immediately gives every newly constructed detour object its own inherited arrow', () => {
    const state = createRectangleConnectedFixture()
    const parts = buildContourGeometry(state).segments
    for (const id of [
      'gap:edge-a:before:parent',
      'avoid:parent:entry',
      'avoid:parent:arc',
      'avoid:parent:exit',
      'gap:edge-a:after:parent',
    ])
      expect(parts.find((part) => part.segment.id === id)?.arrow, id).toBeDefined()
    const changed = contourReducer(state, {
      type: 'stroke',
      id: 'avoid:parent:entry',
      patch: { arrows: false },
    })
    const next = buildContourGeometry(changed).segments
    expect(next.find((part) => part.segment.id === 'avoid:parent:entry')?.arrow).toBeUndefined()
    expect(next.find((part) => part.segment.id === 'avoid:parent:exit')?.arrow).toBeDefined()
  })
  it('traces every expanded contour part into the closed fill, excluding independent paths', () => {
    const state = createAvoidanceFixture()
    state.connections = [{ id: 'diagonal', kind: 'line', startId: 'a', endId: 'c' }]
    const geometry = buildContourGeometry(state)
    expect(geometry.segments).toHaveLength(7)
    expect(geometry.path).toBe(
      'M 240 300 L 380 300 A 20 20 0 0 1 420 300 L 560 300 L 560 180 L 240 180 L 240 300 Z',
    )
  })

  it('places independent default arrows and keeps the old source label on the first retained object', () => {
    const state = createAvoidanceFixture()
    state.markers[0].re = -2
    state.segments[0].label = defaultLabel('C')
    const geometry = buildContourGeometry(state)
    const arrows = geometry.segments.filter((part) => part.arrow)
    expect(arrows).toHaveLength(6)
    const arrow = arrows.find((part) => part.segment.id === 'gap:edge-a:after:avoid-1')!.arrow!
    expect(arrow.point.x).toBeCloseTo(450)
    expect(arrow.point.y).toBe(300)
    expect(arrow.tangent).toEqual({ x: 1, y: 0 })
    expect(geometry.labels).toHaveLength(1)
    expect(geometry.labels[0].target).toEqual({
      kind: 'segment',
      id: sourcePieceId('edge-a', { startAvoidanceId: null, endAvoidanceId: 'avoid-1' }),
      part: 'label',
    })
    expect(geometry.labels[0].point).toEqual({ x: 270, y: 300 })
  })

  it.each([true, false])(
    'honors explicit part arrows=%s without relocating an unrelated default arrow',
    (arrows) => {
      const state = createAvoidanceFixture()
      state.markers[0].re = -2
      state.avoidances[0].partStyles = { arc: { arrows } }
      const parts = buildContourGeometry(state).segments
      expect(parts.filter((part) => part.arrow)).toHaveLength(arrows ? 6 : 5)
      const arc = parts.find((part) => part.segment.id === 'avoid:avoid-1:arc')!
      expect(Boolean(arc.arrow)).toBe(arrows)
      if (arrows) expect(arc.arrow!.point).toEqual({ x: 320, y: 280 })
      expect(
        parts.find((part) => part.segment.id === 'gap:edge-a:after:avoid-1')!.arrow!.point.x,
      ).toBeCloseTo(450)
    },
  )

  it('suppresses a default arrow landing on an explicitly disabled part', () => {
    const state = createAvoidanceFixture()
    state.avoidances[0].partStyles = { arc: { arrows: false } }
    const parts = buildContourGeometry(state).segments
    expect(parts.filter((part) => part.arrow)).toHaveLength(5)
  })

  it('uses each independent object for the 20px arrow threshold', () => {
    const state = createAvoidanceFixture()
    state.viewport = { ...state.viewport, scaleX: 3, scaleY: 3 }
    const parts = buildContourGeometry(state).segments
    expect(parts.find((part) => part.segment.id === 'avoid:avoid-1:arc')?.arrow).toBeUndefined()
    expect(parts.find((part) => part.segment.id === 'edge-c')?.arrow).toBeDefined()
    expect(parts.find((part) => part.segment.id === 'edge-b')?.arrow).toBeUndefined()
  })

  it('builds preview geometry using only a resolved scene and a separate view', () => {
    const state = createAvoidanceFixture()
    state.segments[0].label = defaultLabel('C')
    const geometry = buildSceneGeometry(resolvedScene(state), {
      closed: state.closed,
      appearance: state.appearance,
      viewport: { ...state.viewport, scaleX: 80, scaleY: 20, locked: false },
    })
    expect(geometry.path).toBe(
      'M 80 300 L 360 300 A 40 10 0 0 1 440 300 L 720 300 L 720 240 L 80 240 L 80 300 Z',
    )
    expect(geometry.labels[0].point).toEqual({ x: 220, y: 300 })
  })

  it('keeps an independently bound connection entirely outside the contour fill', () => {
    const state = createAvoidanceFixture()
    state.connections = [{ id: 'diagonal', kind: 'line', startId: 'a', endId: 'c' }]
    state.markers[0].im = 1.5
    state.avoidances[0].targetSegmentId = 'diagonal'
    const geometry = buildContourGeometry(state)
    expect(geometry.segments).toHaveLength(7)
    expect(geometry.segments.filter((part) => part.arc)).toHaveLength(1)
    expect(geometry.path).toBe('M 240 300 L 560 300 L 560 180 L 240 180 L 240 300 Z')
  })

  it('traces disconnected expanded chains by endpoint IDs rather than array order', () => {
    const state = createAvoidanceFixture()
    state.closed = false
    state.segments = [state.segments[2], state.segments[0]]
    const geometry = buildContourGeometry(state)
    expect(geometry.path).toBe(
      'M 560 180 L 240 180 M 240 300 L 380 300 A 20 20 0 0 1 420 300 L 560 300',
    )
  })
})

describe('mixed SVG geometry', () => {
  it('keeps arrows finite between opposite large endpoints', () => {
    const state = createInitialState()
    state.vertices[0].re = -3e306
    state.vertices[1].re = 3e306
    const geometry = buildContourGeometry(state)
    expect(geometry.segments[0].arrow?.tangent.x).toBe(1)
    for (const { arrow } of geometry.segments) {
      expect(arrow).toBeDefined()
      expect(
        [arrow!.point.x, arrow!.point.y, arrow!.tangent.x, arrow!.tangent.y].every(Number.isFinite),
      ).toBe(true)
    }
  })
  it('renders a continuous semicircle path with correct SVG sweep and tangent arrows', () => {
    const geometry = buildContourGeometry(createArcFixture())
    expect(geometry.path).toBe('M 320 300 L 480 300 A 80 80 0 0 0 320 300 Z')
    expect(geometry.segments[0].arrow?.tangent).toEqual({ x: 1, y: 0 })
    expect(geometry.segments[1].arrow?.point.x).toBeCloseTo(400)
    expect(geometry.segments[1].arrow?.point.y).toBeCloseTo(220)
    expect(geometry.segments[1].arrow?.tangent.x).toBeCloseTo(-1)
    expect(geometry.segments[1].arrow?.tangent.y).toBeCloseTo(0)
  })
  it('reverses sweep and arrows while preserving the filled boundary', () => {
    const reversed = buildContourGeometry(contourReducer(createArcFixture(), { type: 'reverse' }))
    expect(reversed.path).toBe('M 480 300 L 320 300 A 80 80 0 0 1 480 300 Z')
    expect(reversed.segments[0].arrow?.tangent.x).toBe(-1)
    expect(reversed.segments[1].arrow?.tangent.x).toBeCloseTo(1)
    expect(reversed.segments[1].arrow?.point.y).toBeCloseTo(220)
  })
  it('hides the closing arc when open and restores it when closed again', () => {
    const state = contourReducer(createArcFixture(), { type: 'toggleClosed' })
    expect(buildContourGeometry(state).path).toBe('M 320 300 L 480 300')
    expect(
      buildContourGeometry(contourReducer(state, { type: 'toggleClosed' })).segments,
    ).toHaveLength(2)
  })
})
