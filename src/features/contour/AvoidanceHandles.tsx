import { toSvg } from '../../lib/geometry'
import type { ContourState } from './model'
import type { ResolvedScene } from './resolvedScene'
import type { useCanvasInteraction } from './useCanvasInteraction'
import { avoidanceHandles } from './avoidanceHandles'

export function AvoidanceHandles({
  state,
  scene,
  interaction,
}: {
  state: ContourState
  scene: ResolvedScene
  interaction?: ReturnType<typeof useCanvasInteraction>
}) {
  const handles = avoidanceHandles(state, scene)
  return (
    <g data-export-omit="">
      {handles.map((handle) => {
        const { avoidanceId, kind, part, end, point } = handle
        const p = toSvg(point, state.viewport)
        const enabled = interaction?.avoidanceHandlesInteractive !== false
        return (
          <g
            key={handle.key}
            data-avoidance-handle={kind === 'radius' ? '' : undefined}
            data-avoidance-control={kind === 'port' ? 'port' : kind === 'gap' ? 'gap' : undefined}
            data-testid={
              kind === 'gap'
                ? `avoidance-gap-${avoidanceId}`
                : kind === 'port'
                  ? `avoidance-port-${avoidanceId}-${end}`
                  : `avoidance-radius-${avoidanceId}-${part === 'arc' ? '' : `${part}-`}${end}`
            }
            className="vertex"
            transform={`translate(${p.x} ${p.y})`}
            role="button"
            tabIndex={enabled && interaction ? 0 : undefined}
            pointerEvents={enabled ? undefined : 'none'}
            aria-label={
              kind === 'gap'
                ? `调整绕行 ${avoidanceId} 的两岸间距`
                : kind === 'port'
                  ? `调整绕行 ${avoidanceId} 的${end === 'entry' ? '进入' : '离开'}接入点`
                  : `调整绕行 ${avoidanceId} 的${part === 'arc' ? '' : part === 'bank-entry' ? '进入岸' : '离开岸'}${end === 'entry' ? '入口' : '出口'}半径`
            }
            onPointerDown={(event) => interaction?.beginAvoidanceDrag(event, handle, handles)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                event.stopPropagation()
                interaction?.inspectAvoidance(avoidanceId, part)
              }
            }}
          >
            <title>
              {kind === 'gap'
                ? '拖动调整两岸间距'
                : kind === 'port'
                  ? '拖动同步调整接入位置'
                  : '拖动调整半径，两端联动'}
            </title>
            <circle r="12" fill="transparent" />
            {handle.kind === 'gap' ? (
              <g pointerEvents="none" transform={`rotate(${handle.angle})`} color="#237b6d">
                <circle r="11" fill="#fff" />
                <path
                  d="M -8 0 H 8 M -8 0 L -4 -4 M -8 0 L -4 4 M 8 0 L 4 -4 M 8 0 L 4 4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </g>
            ) : (
              <circle r="4" fill="#fff" stroke="#237b6d" strokeWidth="1.5" pointerEvents="none" />
            )}
          </g>
        )
      })}
    </g>
  )
}
