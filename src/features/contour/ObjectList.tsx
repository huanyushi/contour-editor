import type { Dispatch } from 'react'
import { MathText } from '../../components/MathText'
import type { ContourAction, ContourState } from './model'
import type { Selection } from './appearance'

export function ObjectList({
  state,
  dispatch,
}: {
  state: ContourState
  dispatch: Dispatch<ContourAction>
}) {
  const isSelected = (target: Selection) =>
    state.selection.kind === target.kind &&
    (target.kind === 'contour' ||
      (state.selection.kind !== 'contour' && state.selection.id === target.id))
  return (
    <section className="object-list" aria-label="对象列表">
      <h3>
        对象列表 <span className="muted">/ OBJECTS</span>
      </h3>
      <button
        className={isSelected({ kind: 'contour' }) ? 'object-row selected' : 'object-row'}
        onClick={() => dispatch({ type: 'selectObject', selection: { kind: 'contour' } })}
      >
        ▱ 整体围道 <span>{state.closed ? '闭合' : '开放'}</span>
      </button>
      {state.vertices.map((vertex, index) => (
        <button
          key={vertex.id}
          className={
            isSelected({ kind: 'vertex', id: vertex.id }) ? 'object-row selected' : 'object-row'
          }
          aria-label={`选择顶点 z${index + 1}`}
          onClick={() => dispatch({ type: 'select', id: vertex.id })}
        >
          <MathText tex={vertex.label?.tex || `z_{${index + 1}}`} />
          <span>端点 {index + 1}</span>
        </button>
      ))}
      {state.segments.map((segment, index) => (
        <button
          key={segment.id}
          className={
            isSelected({ kind: 'segment', id: segment.id }) ? 'object-row selected' : 'object-row'
          }
          aria-label={`选择路径段 ${index + 1}`}
          onClick={() => dispatch({ type: 'selectSegment', id: segment.id })}
        >
          <span>
            {segment.kind === 'arc' ? '⌒' : '╱'} 路径段 {index + 1}
          </span>
          <span>
            {!state.closed && index === state.segments.length - 1
              ? '暂存闭合边'
              : segment.kind === 'arc'
                ? '圆弧'
                : '直线'}
          </span>
        </button>
      ))}
      {state.markers.map((point, index) => (
        <button
          key={point.id}
          className={
            isSelected({ kind: 'marker', id: point.id }) ? 'object-row selected' : 'object-row'
          }
          aria-label={`选择标记点 ${index + 1}`}
          onClick={() =>
            dispatch({ type: 'selectObject', selection: { kind: 'marker', id: point.id } })
          }
        >
          <MathText tex={point.label.tex} />
          <span>独立点</span>
        </button>
      ))}
      {state.formulas.map((point, index) => (
        <button
          key={point.id}
          className={
            isSelected({ kind: 'formula', id: point.id }) ? 'object-row selected' : 'object-row'
          }
          aria-label={`选择公式 ${index + 1}`}
          onClick={() =>
            dispatch({ type: 'selectObject', selection: { kind: 'formula', id: point.id } })
          }
        >
          <span>ƒ 公式 {index + 1}</span>
        </button>
      ))}
    </section>
  )
}
