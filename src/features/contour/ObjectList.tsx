import type { Dispatch } from 'react'
import { MathText } from '../../components/MathText'
import type { ContourAction, ContourState } from './model'
import type { SelectionItem } from './appearance'
import { selectionItems } from './selectionModel'
import type { MouseEvent } from 'react'
import { isSingleCycle } from './pathTopology'

export function ObjectList({
  state,
  dispatch,
}: {
  state: ContourState
  dispatch: Dispatch<ContourAction>
}) {
  const isSelected = (target: SelectionItem) =>
    selectionItems(state.selection).some(
      (item) =>
        item.kind === target.kind &&
        (item.kind === 'contour' || (target.kind !== 'contour' && item.id === target.id)),
    )
  const choose = (event: MouseEvent, item: SelectionItem) =>
    dispatch(
      event.ctrlKey || event.metaKey
        ? { type: 'toggleSelection', item }
        : { type: 'selectObject', selection: item },
    )
  return (
    <section className="object-list" aria-label="对象列表">
      <h3>
        对象列表 <span className="muted">/ OBJECTS</span>
      </h3>
      <button
        className={isSelected({ kind: 'contour' }) ? 'object-row selected' : 'object-row'}
        onClick={(event) => choose(event, { kind: 'contour' })}
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
          onClick={(event) => choose(event, { kind: 'vertex', id: vertex.id })}
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
          onClick={(event) => choose(event, { kind: 'segment', id: segment.id })}
        >
          <span>
            {segment.kind === 'arc' ? '⌒' : '╱'} 路径段 {index + 1}
          </span>
          <span>
            {!state.closed && isSingleCycle(state) && index === state.segments.length - 1
              ? '暂存闭合边'
              : segment.kind === 'arc'
                ? '圆弧'
                : '线段'}
          </span>
        </button>
      ))}
      {!!state.connections.length && <h3>独立线段／圆弧</h3>}
      {state.connections.map((segment, index) => (
        <button
          key={segment.id}
          className={
            isSelected({ kind: 'segment', id: segment.id }) ? 'object-row selected' : 'object-row'
          }
          aria-label={`选择独立路径段 ${index + 1}`}
          onClick={(event) => choose(event, { kind: 'segment', id: segment.id })}
        >
          <span>
            {segment.kind === 'arc' ? '⌒ 圆弧' : '╱ 线段'} {index + 1}
          </span>
          <span>已有端点连接</span>
        </button>
      ))}
      {state.markers.map((point, index) => (
        <button
          key={point.id}
          className={
            isSelected({ kind: 'marker', id: point.id }) ? 'object-row selected' : 'object-row'
          }
          aria-label={`选择标记点 ${index + 1}`}
          onClick={(event) => choose(event, { kind: 'marker', id: point.id })}
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
          onClick={(event) => choose(event, { kind: 'formula', id: point.id })}
        >
          <span>ƒ 公式 {index + 1}</span>
        </button>
      ))}
    </section>
  )
}
