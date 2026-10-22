import { render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import * as math from '../../../lib/math'
import { defaultLabel, defaultPointStyle } from '../appearance'
import { createInitialState, type ContourState } from '../model'
import { CanvasScene } from './CanvasScene'
import { serializeProject } from '../../project/format'
import { parseProject } from '../../project/project'
import { renderExport } from '../../project/renderExport'
import { defaultExportOptions } from '../../project/export'
import { createConnectedFixture } from '../../../test/connectedAvoidanceFixtures'
import { validateAvoidances } from '../avoidance/avoidanceValidation'
import type { AvoidanceWorkflow } from '../avoidance/useAvoidanceDraft'
import { ContourCanvas } from '../ContourCanvas'
import { computeExportLayout } from '../../project/exportLayout'

afterEach(() => vi.restoreAllMocks())

function manyLabels(count: number, vertices = false): ContourState {
  const state = createInitialState()
  state.vertices = []
  state.segments = []
  state.closed = false
  const points = Array.from({ length: count }, (_, i) => ({
    id: `m${i}`,
    re: (i % 20) / 5,
    im: Math.floor(i / 20) / 5,
    pointStyle: defaultPointStyle(),
    label: defaultLabel(`z_{${i}}`),
  }))
  if (vertices)
    state.vertices = points.map(({ id, re, im, pointStyle }) => ({ id, re, im, pointStyle }))
  else state.markers = points
  return parseProject(serializeProject(state))
}

it.each([301, 400])(
  'reuses %s different labels through view, selection and appearance updates',
  (count) => {
    let state = manyLabels(count)
    const spy = vi.spyOn(math, 'renderMath')
    const { container, rerender, unmount } = render(<CanvasScene state={state} />)
    expect(container.querySelectorAll('.draggable-label')).toHaveLength(count)
    spy.mockClear()
    for (const update of [
      { viewport: { ...state.viewport, centerRe: 1, scaleX: 70, scaleY: 30, locked: false } },
      { selection: { kind: 'marker' as const, id: 'm0' } },
      {
        markers: state.markers.map((p) => ({
          ...p,
          label: { ...p.label, color: '#cc2233', dx: 30 },
        })),
      },
    ]) {
      state = { ...state, ...update }
      rerender(<CanvasScene state={state} />)
      expect(spy).not.toHaveBeenCalled()
    }
    state = {
      ...state,
      markers: state.markers.map((p, i) =>
        i ? p : { ...p, label: { ...p.label, tex: 'w_{new}' } },
      ),
    }
    rerender(<CanvasScene state={state} />)
    expect(spy.mock.calls.map(([tex]) => tex)).toEqual(['w_{new}'])
    expect(container.querySelector('g[aria-label="w_{new}"] svg')).not.toBeNull()
    const snapshot = JSON.stringify(state)
    spy.mockClear()
    computeExportLayout(state, { ...defaultExportOptions(), axes: true })
    expect(spy.mock.calls.filter(([tex]) => tex === 'z_{1}')).toHaveLength(1)
    spy.mockClear()
    const exported = renderExport(state, { ...defaultExportOptions(), axes: false })
    expect(spy.mock.calls.filter(([tex]) => tex === 'z_{1}')).toHaveLength(1)
    const svg = new DOMParser().parseFromString(exported, 'image/svg+xml')
    expect(svg.querySelectorAll('g[role="img"]')).toHaveLength(count)
    expect(svg.querySelector('g[aria-label="w_{new}"] svg')).not.toBeNull()
    expect(JSON.stringify(state)).toBe(snapshot)
    rerender(<CanvasScene state={{ ...state, markers: [] }} />)
    expect(container.querySelectorAll('.draggable-label')).toHaveLength(0)
    unmount()
    spy.mockClear()
    const remount = render(<CanvasScene state={state} />)
    expect(spy.mock.calls.some(([tex]) => tex === 'w_{new}')).toBe(true)
    remount.unmount()
  },
)

it('retains over 300 implicit vertex labels and isolates two mounted scenes', () => {
  const state = manyLabels(301, true)
  const spy = vi.spyOn(math, 'renderMath')
  const first = render(<CanvasScene state={state} />)
  const second = render(<CanvasScene state={createInitialState()} />)
  spy.mockClear()
  first.rerender(<CanvasScene state={{ ...state, selection: { kind: 'vertex', id: 'm0' } }} />)
  expect(spy).not.toHaveBeenCalled()
  expect(first.container.querySelector('g[aria-label="z_{301}"] svg')).not.toBeNull()
  first.unmount()
  second.unmount()
})

it('reuses selection bounds and caches invalid measured formula results without drawing invalid glyphs', () => {
  const state = manyLabels(301)
  state.selection = {
    kind: 'multiple',
    items: state.markers.map((m) => ({ kind: 'marker', id: m.id })),
  }
  state.selectionSource = 'marquee'
  state.formulas = [{ ...state.markers[0], id: 'f', label: defaultLabel('\\notACommand') }]
  const spy = vi.spyOn(math, 'renderMath')
  const props = { dispatch: vi.fn(), gestureOwner: null, tool: 'marquee' as const, onArcPoint() {} }
  const view = render(<ContourCanvas {...props} state={state} />)
  expect(view.container.querySelector('[data-testid="selection-rectangle"]')).not.toBeNull()
  expect(view.container.querySelector('g[aria-label="\\notACommand"]')).toBeNull()
  spy.mockClear()
  view.rerender(
    <ContourCanvas
      {...props}
      state={{ ...state, viewport: { ...state.viewport, centerRe: 0.1 } }}
    />,
  )
  expect(spy).not.toHaveBeenCalled()
})

it('keeps applied and preview label results and uses an external renderer without a second internal cache', () => {
  const applied = createConnectedFixture()
  applied.avoidances[0].partLabels = { arc: defaultLabel('A') }
  const preview = createConnectedFixture()
  preview.avoidances[0].partLabels = { arc: defaultLabel('B') }
  const workflow: AvoidanceWorkflow = {
    draft: { kind: 'configure', avoidance: preview.avoidances[0] },
    preview: validateAvoidances(preview),
    previewDocument: preview,
    start() {},
    pickTarget() {},
    patch() {},
    patchParentGap() {},
    apply() {},
    cancel() {},
  }
  const spy = vi.spyOn(math, 'renderMath')
  const view = render(<CanvasScene state={applied} avoidanceWorkflow={workflow} />)
  expect(
    view.container.querySelector('g[data-export-preview-source] g[aria-label="A"] svg'),
  ).not.toBeNull()
  expect(view.container.querySelector('g[aria-label="B"] svg')).not.toBeNull()
  spy.mockClear()
  view.rerender(
    <CanvasScene
      state={{ ...applied, viewport: { ...applied.viewport, centerRe: 1 } }}
      avoidanceWorkflow={workflow}
    />,
  )
  expect(spy).not.toHaveBeenCalled()
  const external = vi.fn(math.renderMath)
  view.rerender(<CanvasScene state={applied} mathRenderer={external} />)
  expect(external.mock.calls.some(([tex]) => tex === 'A')).toBe(true)
  external.mockClear()
  view.rerender(<CanvasScene state={applied} mathRenderer={external} />)
  expect(external.mock.calls.some(([tex]) => tex === 'A')).toBe(true)
})
