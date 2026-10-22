import { memo } from 'react'
import { renderExport } from '../project/renderExport'
import { defaultExportOptions } from '../project/export'
import { defaultViewport } from '../../lib/viewport'
import type { ContourState } from './model'

interface Props {
  state: ContourState
  label: string
}

/** Each image is its own SVG document: hatch and MathJax IDs cannot collide. */
export const SceneThumbnail = memo(
  function SceneThumbnail({ state, label }: Props) {
    try {
      const svg = renderExport(
        { ...state, viewport: defaultViewport(), selection: { kind: 'none' } },
        {
          ...defaultExportOptions(),
          axes: false,
          grid: false,
          endpoints: true,
          background: 'transparent',
        },
      )
      return (
        <img
          className="scene-thumbnail"
          alt={label}
          src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`}
          draggable={false}
        />
      )
    } catch {
      return (
        <span className="scene-thumbnail thumbnail-error" role="img" aria-label={label}>
          预览暂不可用
        </span>
      )
    }
  },
  (a, b) =>
    a.label === b.label &&
    (
      [
        'vertices',
        'segments',
        'connections',
        'avoidances',
        'markers',
        'formulas',
        'appearance',
        'closed',
      ] as const
    ).every((key) => a.state[key] === b.state[key]),
)
