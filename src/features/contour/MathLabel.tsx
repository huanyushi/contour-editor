import { renderMath } from '../../lib/math'
import type { MathRenderer } from '../../lib/mathRenderingScope'
import type { LabelSettings } from './appearance'

export function MathLabel({
  label,
  x,
  y,
  id,
  mathRenderer = renderMath,
}: {
  label: LabelSettings
  x: number
  y: number
  id?: string
  mathRenderer?: MathRenderer
}) {
  if (!label.visible || !label.tex.trim()) return null
  const result = mathRenderer(label.tex)
  if (result.error) return null
  return (
    <g
      data-testid={id ? `label-${id}` : undefined}
      role="img"
      aria-label={label.tex}
      pointerEvents="none"
      transform={`translate(${x + label.dx} ${y + label.dy}) scale(${label.size / 16})`}
      style={{ color: label.color }}
      dangerouslySetInnerHTML={{ __html: result.svg }}
    />
  )
}
