import { renderToStaticMarkup } from 'react-dom/server'
import { CanvasScene } from '../contour/CanvasScene'
import type { ContourState } from '../contour/model'
import { serializeSvg, type ExportOptions } from './export'
import { computeExportLayout } from './exportLayout'

export function renderExport(state: ContourState, options: ExportOptions): string {
  const layout = computeExportLayout(state, options)
  const markup = renderToStaticMarkup(<CanvasScene state={layout.state} size={layout.size} />)
  const document = new DOMParser().parseFromString(markup, 'image/svg+xml')
  return serializeSvg(document.documentElement as unknown as SVGSVGElement, options)
}
