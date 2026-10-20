import type { PointerEvent } from 'react'
import { renderMath } from '../../lib/math'
import type { LabelSettings } from './appearance'
import { MathLabel } from './MathLabel'

export function DraggableLabel({
  label,
  x,
  y,
  id,
  selected,
  onPointerDown,
}: {
  label: LabelSettings
  x: number
  y: number
  id: string
  selected: boolean
  onPointerDown: (event: PointerEvent<SVGGElement>) => void
}) {
  if (!label.visible || !label.tex.trim()) return null
  const math = renderMath(label.tex)
  if (math.error) return null
  return (
    <g className="draggable-label" onPointerDown={onPointerDown}>
      <rect
        data-export-omit=""
        data-testid={`label-handle-${id}`}
        className="label-hit"
        x={x + label.dx - 3}
        y={y + label.dy - 3}
        width={Math.max(10, (math.width * label.size) / 16) + 6}
        height={Math.max(10, (math.height * label.size) / 16) + 6}
        fill="transparent"
        stroke={selected ? '#238b8b' : 'none'}
        strokeDasharray="3 3"
        rx="2"
      />
      <MathLabel label={label} x={x} y={y} id={id} />
    </g>
  )
}
