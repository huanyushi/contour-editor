import type { ComplexPoint, SvgPoint } from '../../../lib/geometry'
import { LABEL_OFFSET_LIMIT, type LabelSettings } from '../appearance'
import type { ContourAction } from '../model'

export function labelDragEdit(input: {
  id: string
  kind: 'vertex' | 'segment' | 'marker'
  label: LabelSettings
  start: SvgPoint
  current: SvgPoint
  implicit: boolean
}): Extract<ContourAction, { type: 'label' | 'clearVertexLabel' }> {
  const clamp = (n: number) => Math.max(-LABEL_OFFSET_LIMIT, Math.min(LABEL_OFFSET_LIMIT, n))
  const dx = Math.round((input.current.x - input.start.x) * 1000) / 1000
  const dy = Math.round((input.current.y - input.start.y) * 1000) / 1000
  if (input.implicit && dx === 0 && dy === 0) return { type: 'clearVertexLabel', id: input.id }
  return {
    type: 'label',
    target: { kind: input.kind, id: input.id },
    label: { ...input.label, dx: clamp(input.label.dx + dx), dy: clamp(input.label.dy + dy) },
  }
}

export function draggedAvoidanceRadius(
  center: ComplexPoint,
  current: ComplexPoint,
  offset: ComplexPoint,
): number {
  return Math.hypot(current.re - offset.re - center.re, current.im - offset.im - center.im)
}

export function draggedAvoidanceGap(
  initialGap: number,
  normal: ComplexPoint,
  start: ComplexPoint,
  current: ComplexPoint,
): number {
  return (
    initialGap + 2 * ((current.re - start.re) * normal.re + (current.im - start.im) * normal.im)
  )
}
