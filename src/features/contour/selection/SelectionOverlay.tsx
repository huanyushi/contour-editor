import { Trash2, X } from 'lucide-react'
import { canvasBounds, type CanvasSize } from '../../../lib/viewport'
import type { SelectionRect } from './selectionGeometry'
import type { PointerEvent } from 'react'

export function SelectionOverlay({
  bounds,
  count,
  size,
  onDelete,
  onClear,
  onDrag,
  dragEnabled,
}: {
  bounds: SelectionRect
  count: number
  size: CanvasSize
  onDelete: () => void
  onClear: () => void
  onDrag: (event: PointerEvent<SVGRectElement>) => void
  dragEnabled: boolean
}) {
  const canvas = canvasBounds(size)
  const width = Math.min(220, size.width - 20)
  const x = Math.max(canvas.left + 10, Math.min(bounds.left - 6, canvas.right - width - 10))
  const preferredY = bounds.top > canvas.top + 54 ? bounds.top - 48 : bounds.bottom + 12
  const y = Math.max(canvas.top + 10, Math.min(preferredY, canvas.bottom - 80))
  return (
    <g data-export-omit="" pointerEvents="none">
      <rect
        data-testid="selection-rectangle"
        x={bounds.left - 6}
        y={bounds.top - 6}
        width={bounds.right - bounds.left + 12}
        height={bounds.bottom - bounds.top + 12}
        fill="#238b8b08"
        stroke="#238b8b"
        strokeWidth="1.5"
        strokeDasharray="5 3"
        pointerEvents={dragEnabled ? 'all' : 'none'}
        className="selection-drag-area"
        onPointerDown={onDrag}
      />
      <foreignObject
        x={x}
        y={y}
        width={width}
        height="42"
        pointerEvents="auto"
        data-selection-toolbar=""
      >
        <div
          className="selection-toolbar"
          data-testid="selection-toolbar"
          role="toolbar"
          aria-label="选中对象操作"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <span>{count} 个对象</span>
          <button
            type="button"
            aria-label="删除选中对象"
            data-tooltip="删除 · Delete / Backspace"
            onClick={onDelete}
          >
            <Trash2 className="ui-icon" aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="取消选择"
            data-tooltip="取消选择 · Esc"
            onClick={onClear}
          >
            <X className="ui-icon" aria-hidden="true" />
          </button>
        </div>
      </foreignObject>
    </g>
  )
}
