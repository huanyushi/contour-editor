import type { Dispatch, MouseEvent } from 'react'
import { Pentagon, Slash, Spline } from 'lucide-react'
import { MathText } from '../../components/MathText'
import type { ContourAction, ContourState, PathSegment } from './model'
import type { SelectionItem } from './appearance'
import { selectionItems } from './selection/selectionState'
import { mathematicalCategory, mathematicalNames } from './mathematicalKind'
import { pathObjectRows, type PathObjectRow } from './scene/pathObjects'

function SegmentIcon({ kind }: { kind: PathSegment['kind'] }) {
  const Icon = kind === 'arc' ? Spline : Slash
  return <Icon className="ui-icon" aria-hidden="true" focusable="false" />
}

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
  const pathRow = (row: PathObjectRow) => (
    <button
      key={row.id}
      className={isSelected({ kind: 'segment', id: row.id }) ? 'object-row selected' : 'object-row'}
      aria-label={row.accessibleName}
      onClick={(event) => choose(event, { kind: 'segment', id: row.id })}
    >
      <span className="object-row-name">
        <SegmentIcon kind={row.kind} />
        {row.name}
      </span>
      <span>{row.description}</span>
    </button>
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
        <span className="object-row-name">
          <Pentagon className="ui-icon" aria-hidden="true" focusable="false" />
          整体围道
        </span>{' '}
        <span>{state.closed ? '闭合' : '开放'}</span>
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
          <span>
            {vertex.mathematicalKind && vertex.mathematicalKind !== 'ordinary'
              ? mathematicalNames[mathematicalCategory(vertex.mathematicalKind)]
              : `端点 ${index + 1}`}
          </span>
        </button>
      ))}
      {pathObjectRows(state, 'contour').map(pathRow)}
      {!!state.connections.length && <h3>独立线段／圆弧</h3>}
      {pathObjectRows(state, 'connection').map(pathRow)}
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
          <span>{mathematicalNames[mathematicalCategory(point.mathematicalKind)]}</span>
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
