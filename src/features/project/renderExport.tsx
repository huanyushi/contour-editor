import { renderToStaticMarkup } from 'react-dom/server'
import { CanvasScene } from '../contour/scene/CanvasScene'
import type { ContourState } from '../contour/model'
import { serializeSvg, type ExportOptions } from './export'
import { computeExportLayout } from './exportLayout'
import { createMathRenderingScope } from '../../lib/mathRenderingScope'
import { sceneMathTexts } from '../contour/scene/sceneMath'
import { resolvedScene } from '../contour/scene/sceneObjects'

export function renderExport(state: ContourState, options: ExportOptions): string {
  const scope = createMathRenderingScope()
  scope.retain(sceneMathTexts(state, [resolvedScene(state)]))
  const layout = computeExportLayout(state, options, scope.render)
  const markup = renderToStaticMarkup(
    <CanvasScene state={layout.state} size={layout.size} mathRenderer={scope.render} />,
  )
  const document = new DOMParser().parseFromString(markup, 'image/svg+xml')
  return serializeSvg(document.documentElement as unknown as SVGSVGElement, options)
}
