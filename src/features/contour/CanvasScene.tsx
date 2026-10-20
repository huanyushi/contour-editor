import type { RefObject } from 'react'
import { toSvg } from '../../lib/geometry'
import { canvasBounds, exportSize, type CanvasSize } from '../../lib/viewport'
import { renderMath } from '../../lib/math'
import { pointOnArc } from '../../lib/arc'
import type { ContourState } from './model'
import { buildContourGeometry } from './pathGeometry'
import { dashArray, defaultLabel, defaultPointStyle } from './appearance'
import { MathLabel } from './MathLabel'
import { DraggableLabel } from './DraggableLabel'
import { AxesLayer } from './AxesLayer'
import type { useCanvasInteraction } from './useCanvasInteraction'

interface Props {
  state: ContourState
  size?: CanvasSize
  interaction?: ReturnType<typeof useCanvasInteraction>
  canvasRef?: RefObject<SVGSVGElement | null>
}

export function CanvasScene({ state, size = exportSize, interaction, canvasRef }: Props) {
  const bounds = canvasBounds(size)
  const geometry = buildContourGeometry(state)
  const fill = state.appearance.fill
  const selectedLabel = (id: string) =>
    state.handles &&
    state.selection.kind !== 'contour' &&
    state.selection.id === id &&
    state.selection.part === 'label'
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      ref={canvasRef}
      viewBox={`${bounds.left} ${bounds.top} ${size.width} ${size.height}`}
      tabIndex={0}
      className={`contour-canvas ${interaction?.panning ? 'viewport-pan' : interaction?.adding ? 'adding' : ''} ${interaction?.pointerFocus ? 'pointer-focus' : ''}`}
      data-testid="contour-canvas"
      role="group"
      aria-label="复平面围道画布"
      aria-describedby="canvas-help"
      {...interaction?.handlers}
    >
      <AxesLayer state={state} size={size} />
      <defs>
        <pattern
          id="contour-hatch"
          width={fill.spacing}
          height={fill.spacing}
          patternUnits="userSpaceOnUse"
          patternTransform={`rotate(${fill.angle})`}
        >
          <path d={`M 0 0 V ${fill.spacing}`} stroke={fill.color} strokeWidth="2" />
        </pattern>
      </defs>
      <path
        d={geometry.path}
        data-testid="contour-path"
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
          state.closed && fill.mode !== 'none' && fill.opacity > 0 ? 'visiblePainted' : 'none'
        }
        onPointerDown={interaction?.selectContour}
      />
      {geometry.segments.map(({ segment, path, arrow, arc }) => {
        const style = { ...state.appearance.stroke, ...segment.style }
        const selected = state.selection.kind === 'segment' && state.selection.id === segment.id
        const start = toSvg(
          state.vertices.find((point) => point.id === segment.startId)!,
          state.viewport,
        )
        const end = toSvg(
          state.vertices.find((point) => point.id === segment.endId)!,
          state.viewport,
        )
        const midpoint = arc
          ? toSvg(pointOnArc(arc, 0.5), state.viewport)
          : { x: start.x / 2 + end.x / 2, y: start.y / 2 + end.y / 2 }
        return (
          <g key={segment.id}>
            <defs>
              <marker
                id={`direction-${segment.id}`}
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
              data-testid={`segment-${segment.id}`}
              d={path}
              fill="none"
              stroke={style.color}
              strokeWidth={style.width}
              strokeDasharray={dashArray(style)}
              strokeLinecap="round"
              strokeLinejoin="round"
              pointerEvents="none"
            />
            <path
              d={path}
              fill="none"
              stroke="transparent"
              strokeWidth={Math.max(12, style.width + 8)}
              className="segment-hit"
              data-export-omit=""
              onPointerDown={(event) => interaction?.selectSegment(event, segment.id)}
            />
            {arrow && style.arrows && (
              <line
                data-testid={`arrow-${segment.id}`}
                data-segment-kind={segment.kind}
                x1={arrow.point.x - arrow.tangent.x * 6}
                y1={arrow.point.y - arrow.tangent.y * 6}
                x2={arrow.point.x + arrow.tangent.x * 6}
                y2={arrow.point.y + arrow.tangent.y * 6}
                stroke={style.color}
                strokeWidth={style.width}
                markerEnd={`url(#direction-${segment.id})`}
                pointerEvents="none"
              />
            )}
            {segment.label && (
              <DraggableLabel
                label={segment.label}
                x={midpoint.x}
                y={midpoint.y}
                id={segment.id}
                selected={selectedLabel(segment.id)}
                onPointerDown={(event) =>
                  interaction?.beginLabelDrag(event, 'segment', segment.id, segment.label!)
                }
              />
            )}
          </g>
        )
      })}
      {state.vertices.map((vertex, index) => {
        const point = toSvg(vertex, state.viewport)
        const selected = state.selection.kind === 'vertex' && state.selection.id === vertex.id
        const style = vertex.pointStyle ?? defaultPointStyle()
        const label = vertex.label ?? defaultLabel(`z_{${index + 1}}`)
        return (
          <g
            key={vertex.id}
            className="vertex"
            transform={`translate(${point.x} ${point.y})`}
            onPointerDown={(event) => interaction?.beginDrag(event, 'vertex', vertex.id, vertex)}
          >
            {state.handles && (
              <>
                <circle
                  data-export-omit=""
                  r="16"
                  fill="transparent"
                  data-testid={`vertex-${vertex.id}`}
                />
                {selected && (
                  <circle data-export-omit="" r="11" fill="#208a8522" pointerEvents="none" />
                )}
              </>
            )}
            <circle
              data-export-endpoint=""
              visibility={state.handles ? 'visible' : 'hidden'}
              r={style.radius}
              fill={style.color}
              stroke="#fff"
              strokeWidth="1"
              pointerEvents="none"
            />
            <DraggableLabel
              label={label}
              x={0}
              y={0}
              id={vertex.id}
              selected={selectedLabel(vertex.id)}
              onPointerDown={(event) =>
                interaction?.beginLabelDrag(event, 'vertex', vertex.id, label)
              }
            />
          </g>
        )
      })}
      {state.handles &&
        geometry.segments.map(({ segment }, index) => {
          if (segment.kind !== 'arc') return null
          const point = toSvg(segment.through, state.viewport)
          return (
            <g
              key={`through-${segment.id}`}
              data-export-omit=""
              className="vertex arc-handle"
              transform={`translate(${point.x} ${point.y})`}
              onPointerDown={(event) =>
                interaction?.beginDrag(event, 'through', segment.id, segment.through)
              }
            >
              <circle r="16" fill="transparent" data-testid={`through-${segment.id}`} />
              <path
                d="M 0 -6 L 6 0 L 0 6 L -6 0 Z"
                fill="#fff5df"
                stroke="#a57428"
                strokeWidth="1.5"
                pointerEvents="none"
              />
              <MathLabel
                label={{ ...defaultLabel(`q_{${index + 1}}`), color: '#8b641f' }}
                x={0}
                y={0}
              />
            </g>
          )
        })}
      {state.markers.map((object) => {
        const point = toSvg(object, state.viewport)
        const selected = state.selection.kind === 'marker' && state.selection.id === object.id
        return (
          <g
            key={object.id}
            className="vertex"
            transform={`translate(${point.x} ${point.y})`}
            onPointerDown={(event) => interaction?.beginDrag(event, 'marker', object.id, object)}
          >
            <circle
              data-export-omit=""
              r="16"
              fill="transparent"
              data-testid={`marker-${object.id}`}
            />
            {selected && state.handles && (
              <circle data-export-omit="" r="11" fill="#208a8522" pointerEvents="none" />
            )}
            <circle
              r={object.pointStyle.radius}
              fill={object.pointStyle.color}
              pointerEvents="none"
            />
            <DraggableLabel
              label={object.label}
              x={0}
              y={0}
              id={object.id}
              selected={selectedLabel(object.id)}
              onPointerDown={(event) =>
                interaction?.beginLabelDrag(event, 'marker', object.id, object.label)
              }
            />
          </g>
        )
      })}
      {state.formulas.map((object) => {
        const point = toSvg(object, state.viewport),
          dimensions = renderMath(object.label.tex)
        const selected = state.selection.kind === 'formula' && state.selection.id === object.id
        return (
          <g
            key={object.id}
            className="vertex formula-object"
            transform={`translate(${point.x} ${point.y})`}
            onPointerDown={(event) => interaction?.beginDrag(event, 'formula', object.id, object)}
          >
            <rect
              data-testid={`formula-${object.id}`}
              data-export-omit=""
              x={object.label.dx - 4}
              y={object.label.dy - 4}
              width={Math.max(16, (dimensions.width * object.label.size) / 16) + 8}
              height={Math.max(12, (dimensions.height * object.label.size) / 16) + 8}
              rx="3"
              fill="transparent"
              stroke={selected && state.handles ? '#238b8b' : 'none'}
              strokeDasharray="3 3"
            />
            <MathLabel label={object.label} x={0} y={0} id={object.id} />
          </g>
        )
      })}
    </svg>
  )
}
