import { toSvg } from '../../lib/geometry'
import { renderMath } from '../../lib/math'
import {
  canvasBounds,
  exportSize,
  formatTick,
  gridStep,
  ticks,
  viewBounds,
  type CanvasSize,
} from '../../lib/viewport'
import { defaultLabel } from './appearance'
import type { ContourState } from './model'
import { MathLabel } from './MathLabel'

export function AxesLayer({
  state,
  size = exportSize,
}: {
  state: ContourState
  size?: CanvasSize
}) {
  const { left, top, right, bottom } = canvasBounds(size)
  const view = state.viewport,
    axes = state.axes
  const origin = toSvg({ re: 0, im: 0 }, view)
  const bounds = viewBounds(view, size)
  const stepX = gridStep(view.scaleX, view.centerRe),
    stepY = gridStep(view.scaleY, view.centerIm)
  const width = stepX * view.scaleX,
    height = stepY * view.scaleY
  const xTicks = ticks(bounds.min.re, bounds.max.re, stepX)
  const yTicks = ticks(bounds.min.im, bounds.max.im, stepY)
  const baseX = Math.round(view.centerRe / stepX),
    baseY = Math.round(view.centerIm / stepY)
  const gridX = 400 + (baseX * stepX - view.centerRe) * view.scaleX
  const gridY = 300 - (baseY * stepY - view.centerIm) * view.scaleY
  const showX = origin.y >= top && origin.y <= bottom
  const showY = origin.x >= left && origin.x <= right
  const arrowPath =
    axes.arrow === 'latex'
      ? 'M 0 0 L -10 -4 Q -7 0 -10 4 Z'
      : axes.arrow === 'triangle'
        ? 'M 0 0 L -10 -4 L -10 4 Z'
        : 'M -10 -4 L 0 0 L -10 4'
  const marker = axes.arrow === 'none' ? undefined : 'url(#axis-arrow)'
  const reWidth = renderMath(axes.reLabel).width * 1.25
  const imWidth = renderMath(axes.imLabel).width * 1.25
  return (
    <>
      <defs>
        <pattern
          id="grid"
          width={width}
          height={height}
          patternUnits="userSpaceOnUse"
          x={((gridX % width) + width) % width}
          y={((gridY % height) + height) % height}
        >
          <path d={`M ${width} 0 L 0 0 0 ${height}`} fill="none" stroke="#e7ecef" strokeWidth="1" />
        </pattern>
        <marker
          id="axis-arrow"
          viewBox="-11 -5 12 10"
          refX="0"
          refY="0"
          markerWidth={axes.arrowSize * 1.2}
          markerHeight={axes.arrowSize}
          markerUnits="userSpaceOnUse"
          orient="auto"
        >
          <path
            d={arrowPath}
            fill={axes.arrow === 'open' ? 'none' : axes.color}
            stroke={axes.arrow === 'open' ? axes.color : 'none'}
            strokeWidth="1.2"
            strokeLinejoin="round"
          />
        </marker>
      </defs>
      <rect
        data-export-background=""
        x={left}
        y={top}
        width={size.width}
        height={size.height}
        fill="#fff"
      />
      <rect
        data-export-grid=""
        x={left}
        y={top}
        width={size.width}
        height={size.height}
        fill="url(#grid)"
        visibility={state.grid ? 'visible' : 'hidden'}
      />
      <g
        data-export-axes=""
        data-testid="coordinate-axes"
        visibility={axes.visible ? 'visible' : 'hidden'}
        pointerEvents="none"
      >
        {showX && (
          <path
            data-testid="real-axis"
            d={`M ${left + 20} ${origin.y} H ${right - 20}`}
            fill="none"
            stroke={axes.color}
            strokeWidth={axes.width}
            markerEnd={marker}
          />
        )}
        {showY && (
          <path
            data-testid="imaginary-axis"
            d={`M ${origin.x} ${bottom - 20} V ${top + 20}`}
            fill="none"
            stroke={axes.color}
            strokeWidth={axes.width}
            markerEnd={marker}
          />
        )}
        <g
          data-testid="axis-ticks"
          visibility={axes.ticks ? 'visible' : 'hidden'}
          fill={axes.color}
          fontFamily="Georgia, serif"
          fontSize="11"
        >
          {showX &&
            xTicks
              .filter((n) => n !== 0)
              .map((n) => {
                const x = gridX + (Math.round(n / stepX) - baseX) * width
                return x > left + 24 && x < right - 30 ? (
                  <g key={`x${n}`}>
                    <path
                      d={`M ${x} ${origin.y - 3} v 6`}
                      stroke={axes.color}
                      strokeWidth={axes.width}
                    />
                    <text
                      x={x}
                      y={origin.y > bottom - 30 ? origin.y - 10 : origin.y + 18}
                      textAnchor="middle"
                    >
                      {formatTick(n, stepX)}
                    </text>
                  </g>
                ) : null
              })}
          {showY &&
            yTicks
              .filter((n) => n !== 0)
              .map((n) => {
                const y = gridY - (Math.round(n / stepY) - baseY) * height
                return y > top + 35 && y < bottom - 24 ? (
                  <g key={`y${n}`}>
                    <path
                      d={`M ${origin.x - 3} ${y} h 6`}
                      stroke={axes.color}
                      strokeWidth={axes.width}
                    />
                    <text
                      x={origin.x < left + 35 ? origin.x + 9 : origin.x - 9}
                      y={y + 4}
                      textAnchor={origin.x < left + 35 ? 'start' : 'end'}
                    >
                      {formatTick(n, stepY)}
                    </text>
                  </g>
                ) : null
              })}
          {showX && showY && (
            <text x={origin.x - 12} y={origin.y + 18}>
              0
            </text>
          )}
        </g>
        {showX && (
          <MathLabel
            id="axis-re"
            label={{ ...defaultLabel(axes.reLabel), dx: 0, dy: 0, size: 20, color: axes.color }}
            x={Math.max(left + 20, right - reWidth - 20)}
            y={origin.y > top + 40 ? origin.y - 26 : origin.y + 12}
          />
        )}
        {showY && (
          <MathLabel
            id="axis-im"
            label={{ ...defaultLabel(axes.imLabel), dx: 0, dy: 0, size: 20, color: axes.color }}
            x={Math.max(
              left + 20,
              origin.x + 14 + imWidth > right - 20 ? origin.x - imWidth - 14 : origin.x + 14,
            )}
            y={top + 22}
          />
        )}
      </g>
    </>
  )
}
