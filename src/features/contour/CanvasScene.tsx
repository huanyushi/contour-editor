import { useState, type RefObject } from 'react'
import { toSvg } from '../../lib/geometry'
import { canvasBounds, exportSize, type CanvasSize } from '../../lib/viewport'
import { createMathRenderingScope, type MathRenderer } from '../../lib/mathRenderingScope'
import { sceneMathTexts } from './sceneMath'
import type { ContourState } from './model'
import { buildSceneGeometry } from './pathGeometry'
import { defaultLabel, defaultPointStyle } from './appearance'
import { MathLabel } from './MathLabel'
import { DraggableLabel } from './DraggableLabel'
import { AxesLayer } from './AxesLayer'
import type { useCanvasInteraction } from './useCanvasInteraction'
import { isSelected, selectionItems } from './selectionModel'
import { selectionBounds } from './selectionGeometry'
import { SelectionOverlay } from './SelectionOverlay'
import { resolvedScene } from './sceneObjects'
import type { AvoidanceWorkflow } from './useAvoidanceDraft'
import { ScenePaths } from './ScenePaths'
import { AvoidanceHandles } from './AvoidanceHandles'

interface Props {
  state: ContourState
  size?: CanvasSize
  interaction?: ReturnType<typeof useCanvasInteraction>
  canvasRef?: RefObject<SVGSVGElement | null>
  avoidanceWorkflow?: AvoidanceWorkflow
  mathRenderer?: MathRenderer
}

export function CanvasScene({
  state,
  size = exportSize,
  interaction,
  canvasRef,
  avoidanceWorkflow,
  mathRenderer,
}: Props) {
  const bounds = canvasBounds(size)
  const appliedScene = resolvedScene(state)
  const preview = avoidanceWorkflow?.preview
  const previewId =
    avoidanceWorkflow?.draft.kind === 'configure' ? avoidanceWorkflow.draft.avoidance.id : null
  const showingPreview = !!(preview?.ok && previewId)
  const scene = showingPreview && preview?.ok ? preview.scene : appliedScene
  const drawingState = showingPreview ? (avoidanceWorkflow?.previewDocument ?? state) : state
  const geometry = buildSceneGeometry(scene, drawingState)
  const [mathScope] = useState(() => createMathRenderingScope())
  mathScope.retain(mathRenderer ? [] : sceneMathTexts(state, [appliedScene, scene]))
  const render = mathRenderer ?? mathScope.render
  const fill = state.appearance.fill
  const selectedItems = selectionItems(state.selection)
  const selectedBounds =
    interaction?.showSelection && !interaction.marquee
      ? selectionBounds(state, selectedItems, render)
      : null
  const selectedLabel = (id: string) =>
    state.handles &&
    selectedItems.some((item) => item.kind !== 'contour' && item.id === id && item.part === 'label')
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
      <AxesLayer state={state} size={size} mathRenderer={render} />
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
      {showingPreview && (
        <g data-export-preview-source="" visibility="hidden" pointerEvents="none">
          <ScenePaths
            mathRenderer={render}
            state={state}
            scene={appliedScene}
            geometry={buildSceneGeometry(appliedScene, state)}
            exportOriginal
          />
        </g>
      )}
      <g
        data-testid={showingPreview ? 'avoidance-preview' : undefined}
        data-export-omit={showingPreview ? '' : undefined}
        pointerEvents={showingPreview ? 'none' : undefined}
      >
        <ScenePaths
          mathRenderer={render}
          state={drawingState}
          scene={scene}
          geometry={geometry}
          interaction={interaction}
          previewId={showingPreview ? previewId : null}
        />
      </g>
      {state.vertices.map((vertex, index) => {
        const point = toSvg(vertex, state.viewport)
        const selected = isSelected(state.selection, { kind: 'vertex', id: vertex.id })
        const style = vertex.pointStyle ?? defaultPointStyle()
        const label = vertex.label ?? defaultLabel(`z_{${index + 1}}`)
        const semantic = (vertex.mathematicalKind ?? 'ordinary') !== 'ordinary'
        return (
          <g
            key={vertex.id}
            className="vertex"
            transform={`translate(${point.x} ${point.y})`}
            onPointerDown={(event) => interaction?.beginDrag(event, 'vertex', vertex.id, vertex)}
          >
            {(state.handles || semantic) && (
              <>
                <circle
                  data-export-omit=""
                  r="16"
                  fill="transparent"
                  data-testid={`vertex-${vertex.id}`}
                />
                {selected && state.handles && (
                  <circle data-export-omit="" r="11" fill="#208a8522" pointerEvents="none" />
                )}
              </>
            )}
            <circle
              data-export-endpoint={semantic ? undefined : ''}
              visibility={state.handles || semantic ? 'visible' : 'hidden'}
              r={style.radius}
              fill={style.color}
              stroke="#fff"
              strokeWidth="1"
              pointerEvents="none"
            />
            <DraggableLabel
              mathRenderer={render}
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
          if (segment.kind !== 'arc' || scene.origins.get(segment.id)?.kind !== 'source')
            return null
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
                mathRenderer={render}
                label={{ ...defaultLabel(`q_{${index + 1}}`), color: '#8b641f' }}
                x={0}
                y={0}
              />
            </g>
          )
        })}
      {state.markers.map((object) => {
        const point = toSvg(object, state.viewport)
        const selected = isSelected(state.selection, { kind: 'marker', id: object.id })
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
              mathRenderer={render}
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
          dimensions = render(object.label.tex)
        const selected = isSelected(state.selection, { kind: 'formula', id: object.id })
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
            <MathLabel label={object.label} x={0} y={0} id={object.id} mathRenderer={render} />
          </g>
        )
      })}
      {state.handles && (!avoidanceWorkflow || avoidanceWorkflow.draft.kind === 'idle') && (
        <AvoidanceHandles state={state} scene={scene} interaction={interaction} />
      )}
      {interaction?.marquee && (
        <rect
          data-export-omit=""
          data-testid="marquee-rectangle"
          x={interaction.marquee.left}
          y={interaction.marquee.top}
          width={interaction.marquee.right - interaction.marquee.left}
          height={interaction.marquee.bottom - interaction.marquee.top}
          fill="#238b8b18"
          stroke="#238b8b"
          strokeWidth="1.5"
          strokeDasharray="5 3"
          pointerEvents="none"
        />
      )}
      {interaction && selectedBounds && (
        <SelectionOverlay
          bounds={selectedBounds}
          count={selectedItems.length}
          size={size}
          onDelete={interaction.deleteSelection}
          onClear={interaction.clearSelection}
          onDrag={interaction.beginSelectionDrag}
          dragEnabled={interaction.selectionDragEnabled}
        />
      )}
    </svg>
  )
}
