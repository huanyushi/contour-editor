import type { PointerEventHandler } from 'react'
import type { StrokeStyle } from '../appearance'
import type { PathArrowGeometry } from './arrowGeometry'

export function PathArrow({
  id,
  arrow,
  style,
  prefix = '',
  kind,
  onPointerDown,
}: {
  id: string
  arrow: PathArrowGeometry
  style: StrokeStyle
  prefix?: string
  kind?: 'line' | 'arc'
  onPointerDown?: PointerEventHandler<SVGGElement>
}) {
  const direction = `${prefix}direction-${id}`
  const head =
    style.arrowShape === 'latex'
      ? 'M 0 0 L -10 -4 Q -7 0 -10 4 Z'
      : style.arrowShape === 'triangle'
        ? 'M 0 0 L -10 -4 L -10 4 Z'
        : 'M -10 -4 L 0 0 L -10 4'
  const { bounds } = arrow
  return (
    <g>
      <defs>
        <marker
          id={direction}
          viewBox="-11 -5 12 10"
          refX="0"
          refY="0"
          markerWidth={style.arrowSize * 1.2}
          markerHeight={style.arrowSize}
          markerUnits="userSpaceOnUse"
          orient={(Math.atan2(arrow.tangent.y, arrow.tangent.x) * 180) / Math.PI}
        >
          <path
            d={head}
            fill={style.arrowShape === 'open' ? 'none' : style.color}
            stroke={style.arrowShape === 'open' ? style.color : 'none'}
            strokeWidth="1.2"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </marker>
      </defs>
      <path
        data-testid={`${prefix}arrow-${id}`}
        data-segment-kind={kind}
        d={arrow.path}
        fill="none"
        stroke={style.color}
        strokeWidth={style.width}
        strokeLinecap="round"
        markerEnd={`url(#${direction})`}
        pointerEvents="none"
      />
      {onPointerDown && (
        <g data-export-omit="" onPointerDown={onPointerDown} style={{ cursor: 'grab' }}>
          <title>沿当前路径段拖动箭头</title>
          <rect
            data-testid={`${prefix}arrow-hit-${id}`}
            x={bounds.left - 3}
            y={bounds.top - 3}
            width={bounds.right - bounds.left + 6}
            height={bounds.bottom - bounds.top + 6}
            fill="transparent"
            pointerEvents="all"
          />
        </g>
      )}
    </g>
  )
}
