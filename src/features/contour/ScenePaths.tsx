import type { ContourState } from './model'
import type { ResolvedScene } from './resolvedScene'
import type { useCanvasInteraction } from './useCanvasInteraction'
import type { ContourGeometry } from './pathGeometry'
import { dashArray } from './appearance'
import { isSelected, selectionItems } from './selectionModel'
import { DraggableLabel } from './DraggableLabel'
import { MathLabel } from './MathLabel'

/** Shared applied/preview drawing; neither branch constructs its own geometry. */
export function ScenePaths({
  state,
  scene,
  geometry,
  interaction,
  previewId,
  exportOriginal = false,
}: {
  state: ContourState
  scene: ResolvedScene
  geometry: ContourGeometry
  interaction?: ReturnType<typeof useCanvasInteraction>
  previewId?: string | null
  exportOriginal?: boolean
}) {
  const fill = state.appearance.fill
  const prefix = exportOriginal ? 'export-original-' : ''
  const editable = !previewId && !exportOriginal
  return (
    <>
      <path
        d={geometry.path}
        data-testid={`${prefix}contour-path`}
        fill={
          !state.closed || fill.mode === 'none'
            ? 'none'
            : fill.mode === 'hatch'
              ? 'url(#contour-hatch)'
              : fill.color
        }
        fillOpacity={fill.opacity}
        fillRule="nonzero"
        stroke="none"
        pointerEvents={
          editable && state.closed && fill.mode !== 'none' && fill.opacity > 0
            ? 'visiblePainted'
            : 'none'
        }
        onPointerDown={editable ? interaction?.selectContour : undefined}
      />
      {geometry.segments.map(({ segment, path, arrow }) => {
        const style = { ...state.appearance.stroke, ...segment.style }
        const origin = scene.origins.get(segment.id)!
        const selected =
          editable &&
          (isSelected(state.selection, { kind: 'segment', id: segment.id }) ||
            isSelected(state.selection, { kind: 'segment', id: origin.sourceSegmentId }))
        const direction = `${prefix}direction-${segment.id}`
        return (
          <g key={segment.id}>
            <defs>
              <marker
                id={direction}
                viewBox="0 0 10 10"
                refX="7"
                refY="5"
                markerWidth="10"
                markerHeight="10"
                markerUnits="userSpaceOnUse"
                orient="auto"
              >
                <path d="M 0 1 L 8 5 L 0 9 Z" fill={style.color} />
              </marker>
            </defs>
            {selected && state.handles && (
              <path
                data-export-omit=""
                d={path}
                fill="none"
                stroke="#238b8b20"
                strokeWidth={style.width + 8}
                pointerEvents="none"
              />
            )}
            <path
              data-testid={`${prefix}segment-${segment.id}`}
              data-preview-part={
                previewId && origin.kind === 'avoidance' && origin.avoidanceId === previewId
                  ? segment.id
                  : undefined
              }
              d={path}
              fill="none"
              stroke={style.color}
              strokeWidth={style.width}
              strokeDasharray={dashArray(style)}
              strokeLinecap="round"
              strokeLinejoin="round"
              pointerEvents="none"
            />
            {editable && (
              <path
                d={path}
                fill="none"
                stroke="transparent"
                strokeWidth={Math.max(12, style.width + 8)}
                className="segment-hit"
                data-source-segment-id={origin.sourceSegmentId}
                data-export-omit=""
                onPointerDown={(event) => interaction?.selectSegment(event, segment.id)}
              />
            )}
            {arrow && style.arrows && (
              <line
                data-testid={`${prefix}arrow-${segment.id}`}
                data-segment-kind={segment.kind}
                x1={arrow.point.x - arrow.tangent.x * 6}
                y1={arrow.point.y - arrow.tangent.y * 6}
                x2={arrow.point.x + arrow.tangent.x * 6}
                y2={arrow.point.y + arrow.tangent.y * 6}
                stroke={style.color}
                strokeWidth={style.width}
                markerEnd={`url(#${direction})`}
                pointerEvents="none"
              />
            )}
          </g>
        )
      })}
      {geometry.labels.map(({ target, point, value }) =>
        editable ? (
          <DraggableLabel
            key={target.id}
            label={value}
            x={point.x}
            y={point.y}
            id={`${prefix}${target.id}`}
            selected={
              state.handles &&
              selectionItems(state.selection).some(
                (item) => item.kind !== 'contour' && item.id === target.id && item.part === 'label',
              )
            }
            onPointerDown={(event) =>
              interaction?.beginLabelDrag(event, 'segment', target.id, value)
            }
          />
        ) : (
          <MathLabel
            key={target.id}
            label={value}
            x={point.x}
            y={point.y}
            id={`${prefix}${target.id}`}
          />
        ),
      )}
    </>
  )
}
