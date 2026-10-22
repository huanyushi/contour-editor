import { render } from '@testing-library/react'
import { expect, it } from 'vitest'
import { createConnectedFixture } from '../../test/connectedAvoidanceFixtures'
import { CanvasScene } from '../contour/CanvasScene'
import { defaultLabel } from '../contour/appearance'
import { validateAvoidances } from '../contour/avoidanceValidation'
import type { AvoidanceWorkflow } from '../contour/useAvoidanceDraft'
import { defaultExportOptions, serializeSvg } from './export'
import { renderExport } from './renderExport'

it('exports applied geometry rather than a preview with a different parent gap', () => {
  const applied = createConnectedFixture({ clearanceRadius: 0.1 })
  const preview = createConnectedFixture({ gap: 0.06, clearanceRadius: 0.1 })
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
  const { container, rerender } = render(<CanvasScene state={applied} />)
  const before = serializeSvg(container.querySelector('svg')!, defaultExportOptions())
  rerender(<CanvasScene state={applied} avoidanceWorkflow={workflow} />)
  const during = serializeSvg(container.querySelector('svg')!, defaultExportOptions())
  const paths = (text: string) =>
    [
      ...new DOMParser().parseFromString(text, 'image/svg+xml').querySelectorAll('path[stroke]'),
    ].map((p) => p.getAttribute('d'))
  expect(paths(during)).toEqual(paths(before))
  expect(during).not.toContain('data-preview-part')
  expect(during).not.toContain('data-avoidance-handle')
})

it('exports each bank label once with anisotropic mathematical circles and no derived endpoints', () => {
  const state = createConnectedFixture({ clearanceRadius: 0.1 })
  state.viewport = { ...state.viewport, scaleX: 200, scaleY: 100, locked: false }
  state.avoidances[1].partLabels = {
    'bank-entry': { ...defaultLabel('C_1'), dx: 80, dy: -40 },
    'bank-exit': defaultLabel('C_2'),
  }
  const snapshot = JSON.stringify(state)
  const text = renderExport(state, { ...defaultExportOptions(), axes: false, endpoints: false })
  const svg = new DOMParser().parseFromString(text, 'image/svg+xml')
  expect(svg.querySelectorAll('g[aria-label="C_1"]')).toHaveLength(1)
  expect(svg.querySelectorAll('g[aria-label="C_2"]')).toHaveLength(1)
  expect(svg.querySelectorAll('circle')).toHaveLength(2)
  expect(text).toContain('A 20 10')
  expect(text).not.toContain('拖动调整')
  expect(JSON.stringify(state)).toBe(snapshot)
})
