import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { createAvoidanceFixture } from '../../test/avoidanceFixtures'
import { createArcFixture } from '../../test/fixtures'
import { defaultLabel } from './appearance'
import { CanvasScene } from './CanvasScene'
import { contourReducer } from './model'
import type { AvoidanceWorkflow } from './useAvoidanceDraft'
import { validateAvoidances } from './avoidanceValidation'

describe('actual scene rendering', () => {
  it.each(['line', 'arc', 'corner'] as const)(
    'shows the complete %s preview exactly as applied, including fill and trimmed source paths',
    (mode) => {
      const state = createAvoidanceFixture()
      if (mode === 'arc') {
        state.vertices = [
          { id: 'a', re: -3, im: 0 },
          { id: 'b', re: 3, im: 0 },
        ]
        state.segments = [
          { id: 'edge-a', kind: 'arc', startId: 'a', endId: 'b', through: { re: 0, im: 3 } },
          { id: 'edge-b', kind: 'line', startId: 'b', endId: 'a' },
        ]
        state.markers[0].im = 3
      }
      if (mode === 'corner') {
        state.vertices[1].mathematicalKind = 'pole'
        state.avoidances[0] = { ...state.avoidances[0], markerId: 'b', exitSegmentId: 'edge-b' }
        state.markers = []
      }
      const avoidance = state.avoidances[0]
      const applied = state
      const source = { ...state, avoidances: [] }
      const workflow: AvoidanceWorkflow = {
        draft: { kind: 'configure', avoidance },
        preview: validateAvoidances(applied),
        start() {},
        pickTarget() {},
        patch() {},
        apply() {},
        cancel() {},
      }
      expect(workflow.preview?.ok).toBe(true)
      const { container, rerender } = render(<CanvasScene state={source} />)
      const original = container.querySelector('[data-testid="contour-path"]')!.getAttribute('d')
      rerender(<CanvasScene state={source} avoidanceWorkflow={workflow} />)
      const previewPath = container.querySelector('[data-testid="contour-path"]')!.getAttribute('d')
      expect(previewPath).not.toBe(original)
      expect(container.querySelector('[data-testid="segment-edge-a"]')).toBeNull()
      const previewParts = [...container.querySelectorAll('[data-testid^="segment-"]')].map((p) =>
        p.getAttribute('d'),
      )
      rerender(<CanvasScene state={applied} />)
      expect(container.querySelector('[data-testid="contour-path"]')).toHaveAttribute(
        'd',
        previewPath,
      )
      expect(
        [...container.querySelectorAll('[data-testid^="segment-"]')].map((p) =>
          p.getAttribute('d'),
        ),
      ).toEqual(previewParts)
      rerender(<CanvasScene state={source} />)
      expect(container.querySelector('[data-testid="contour-path"]')).toHaveAttribute('d', original)
      expect(container.querySelector('[data-testid="avoidance-preview"]')).toBeNull()
    },
  )

  it('keeps a semantic cut-corner visible without handles, tagging only ordinary vertices as optional endpoints', () => {
    const state = createAvoidanceFixture()
    state.markers = []
    state.vertices[1].mathematicalKind = 'pole'
    state.avoidances = [{ ...state.avoidances[0], markerId: 'b', exitSegmentId: 'edge-b' }]
    state.handles = false
    const { container } = render(<CanvasScene state={state} />)
    const pole = [...container.querySelectorAll('.vertex')].find(
      (g) => g.getAttribute('transform') === 'translate(560 300)',
    )!
    const circle = pole.querySelector('circle[stroke]')!
    expect(circle).toHaveAttribute('visibility', 'visible')
    expect(circle).not.toHaveAttribute('data-export-endpoint')
    expect(container.querySelectorAll('circle[data-export-endpoint]')).toHaveLength(3)
    expect(container.querySelectorAll('[data-testid^="marker-"]')).toHaveLength(0)
  })

  it('renders a center-bound arc without exposing generated points or a free through handle', () => {
    const state = createAvoidanceFixture()
    const { container } = render(<CanvasScene state={state} />)
    const arc = container.querySelector('[data-testid="segment-avoid:avoid-1:arc"]')
    expect(arc).not.toBeNull()
    expect(arc?.getAttribute('d')).toContain('A 20 20')
    expect(container.querySelector('[data-testid="through-avoid:avoid-1:arc"]')).toBeNull()
    expect(container.querySelectorAll('[data-testid^="vertex-"]')).toHaveLength(4)
    expect(container.querySelectorAll('[data-testid^="marker-"]')).toHaveLength(1)
    expect(
      container.querySelectorAll('.segment-hit[data-source-segment-id="edge-a"]'),
    ).toHaveLength(3)
    expect(container.querySelectorAll('[data-testid^="arrow-"]')).toHaveLength(4)
  })

  it('renders each source and part label once at its resolved anchor and restores vanished labels', () => {
    const state = createAvoidanceFixture()
    state.segments[0].label = { ...defaultLabel('C'), dx: 0, dy: 0 }
    state.avoidances[0].partLabels = {
      arc: defaultLabel('C_r'),
      entry: defaultLabel('in'),
    }
    const { container, rerender } = render(<CanvasScene state={state} />)
    expect(container.querySelectorAll('[data-testid="label-edge-a"]')).toHaveLength(1)
    expect(container.querySelector('[data-testid="label-edge-a"]')?.getAttribute('transform')).toBe(
      'translate(400 280) scale(1)',
    )
    expect(container.querySelectorAll('[data-testid="label-avoid:avoid-1:arc"]')).toHaveLength(1)
    expect(container.querySelector('[data-testid="label-avoid:avoid-1:entry"]')).toBeNull()
    rerender(<CanvasScene state={{ ...state, markers: [{ ...state.markers[0], im: 1 }] }} />)
    expect(container.querySelectorAll('[data-testid="label-avoid:avoid-1:entry"]')).toHaveLength(1)
    expect(container.querySelectorAll('[data-testid="label-edge-a"]')).toHaveLength(1)
  })

  it('retains ordinary three-point arc handles and existing source test IDs', () => {
    const { container } = render(<CanvasScene state={createArcFixture()} />)
    expect(container.querySelector('[data-testid="through-edge-b"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="segment-edge-a"]')).not.toBeNull()
    expect(container.querySelector('.segment-hit')?.getAttribute('data-source-segment-id')).toBe(
      'edge-a',
    )
  })

  it.each(['contour', 'connection'] as const)(
    'highlights the whole expanded %s source without changing its logical selection',
    (collection) => {
      const state = createAvoidanceFixture()
      state.markers[0].im = 1
      state.segments[0].label = defaultLabel('S')
      if (collection === 'connection') {
        state.closed = false
        state.connections = [state.segments[0]]
        state.segments = state.segments.slice(1)
      }
      const selected = contourReducer(state, { type: 'selectSegment', id: 'edge-a' })
      expect(selected.selection).toEqual({ kind: 'segment', id: 'edge-a' })
      const { container, rerender } = render(<CanvasScene state={selected} />)
      const highlightedIds = () =>
        [...container.querySelectorAll('path[stroke="#238b8b20"]')].map((halo) =>
          halo
            .parentElement!.querySelector('[data-testid^="segment-"]')!
            .getAttribute('data-testid'),
        )
      expect(highlightedIds()).toEqual([
        'segment-gap:edge-a:before:avoid-1',
        'segment-avoid:avoid-1:entry',
        'segment-avoid:avoid-1:arc',
        'segment-avoid:avoid-1:exit',
        'segment-gap:edge-a:after:avoid-1',
      ])
      rerender(
        <CanvasScene
          state={{ ...selected, selection: { kind: 'segment', id: 'edge-a', part: 'label' } }}
        />,
      )
      expect(highlightedIds()).toEqual([])
      expect(container.querySelector('[data-testid="label-handle-edge-a"]')).toHaveAttribute(
        'stroke',
        '#238b8b',
      )
      rerender(
        <CanvasScene
          state={{
            ...selected,
            selection: {
              kind: 'multiple',
              items: [
                { kind: 'segment', id: 'edge-a', part: 'label' },
                { kind: 'segment', id: 'avoid:avoid-1:arc' },
              ],
            },
          }}
        />,
      )
      expect(highlightedIds()).toEqual(['segment-avoid:avoid-1:arc'])
    },
  )

  it('allows a part arrow to override a disabled source without duplicating the logical arrow', () => {
    const state = createAvoidanceFixture()
    state.appearance.stroke.arrows = false
    state.avoidances[0].partStyles = { arc: { arrows: true } }
    const { container, rerender } = render(<CanvasScene state={state} />)
    expect(container.querySelectorAll('[data-testid^="arrow-"]')).toHaveLength(1)
    const arrow = container.querySelector('[data-testid="arrow-avoid:avoid-1:arc"]')!
    expect(Number(arrow.getAttribute('x2')) - Number(arrow.getAttribute('x1'))).toBeCloseTo(12)
    rerender(
      <CanvasScene state={{ ...state, viewport: { ...state.viewport, scaleX: 3, scaleY: 3 } }} />,
    )
    expect(container.querySelectorAll('[data-testid^="arrow-"]')).toHaveLength(0)
  })
})
