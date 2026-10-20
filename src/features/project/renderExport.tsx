import { renderToStaticMarkup } from 'react-dom/server'
import { CanvasScene } from '../contour/CanvasScene'
import type { ContourState } from '../contour/model'
import { serializeSvg, type ExportOptions } from './export'

export function renderExport(state: ContourState, options: ExportOptions): string {
  const markup = renderToStaticMarkup(<CanvasScene state={state} />)
  const document = new DOMParser().parseFromString(markup, 'image/svg+xml')
  return serializeSvg(document.documentElement as unknown as SVGSVGElement, options)
}
