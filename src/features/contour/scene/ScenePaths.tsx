import type { ContourState } from '../model'
import type { ResolvedScene } from './resolvedScene'
import type { useCanvasInteraction } from '../interaction/useCanvasInteraction'
import type { ContourGeometry } from './pathGeometry'
import { dashArray } from '../appearance'
import { isSelected, selectionItems } from '../selection/selectionState'
import { DraggableLabel } from './DraggableLabel'
import { MathLabel } from './MathLabel'
import { logicalSegmentId } from './sceneObjects'
import type { MathRenderer } from '../../../lib/mathRenderingScope'
import { PathArrow } from './PathArrow'

/** Shared applied/preview drawing; neither branch constructs its own geometry. */
export function ScenePaths({
  state,
  scene,
  geometry,
  interaction,
  previewId,
  exportOriginal = false,
  mathRenderer,
}: {
  state: ContourState
  scene: ResolvedScene
  geometry: ContourGeometry
  interaction?: ReturnType<typeof useCanvasInteraction>
  previewId?: string | null
  exportOriginal?: boolean
  mathRenderer?: MathRenderer
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
          (isSelected(state.selection, {
            kind: 'segment',
            id: logicalSegmentId(state, segment.id),
          }) ||
            (origin.sourceSegmentIds ?? [origin.sourceSegmentId]).some((id) =>
              isSelected(state.selection, { kind: 'segment', id }),
            ) ||
            selectionItems(state.selection).some((item) => {
              const selectedOrigin =
                item.kind === 'segment' ? scene.origins.get(item.id) : undefined
              if (selectedOrigin?.kind !== 'avoidance' || origin.kind !== 'avoidance') return false
              return (
                (selectedOrigin.avoidanceId === origin.avoidanceId &&
                  selectedOrigin.part === origin.part) ||
                (origin.parentAvoidanceId === selectedOrigin.avoidanceId &&
                  `bank-${selectedOrigin.part}` === origin.part)
              )
            }))
        return (
          <g key={segment.id}>
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
              <PathArrow
                id={segment.id}
                arrow={arrow}
                style={style}
                prefix={prefix}
                kind={segment.kind}
              />
            )}
          </g>
        )
      })}
      {geometry.labels.map(({ target, point, value }) =>
        editable ? (
          <DraggableLabel
            mathRenderer={mathRenderer}
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
            mathRenderer={mathRenderer}
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
