import { useState, type Dispatch, type ReactNode } from 'react'
import { arcThrough } from '../../lib/arc'
import { defaultLabel, defaultPointStyle, type SelectionItem } from './appearance'
import type { ContourState, PathSegment } from './model'
import type { EditorAction } from './history'
import { PointForm } from './PointForm'
import { LabelForm } from './LabelForm'
import { FillFields, PointStyleFields, StrokeFields } from './StyleFields'
import { MultipleProperties } from './MultipleProperties'
import { findPoint, findSegment, segmentOrigin } from './sceneObjects'
import { AvoidanceProperties } from './AvoidanceProperties'
import type { AvoidanceWorkflow } from './useAvoidanceDraft'

const number = (n: number) => Number(n.toFixed(6)).toString()

function PropertySection({
  title,
  open,
  toggle,
  children,
}: {
  title: string
  open: boolean
  toggle: () => void
  children: ReactNode
}) {
  return (
    <details className="property-section" open={open}>
      <summary
        aria-expanded={open}
        onClick={(event) => {
          event.preventDefault()
          toggle()
        }}
      >
        {title}
      </summary>
      <div hidden={!open}>{children}</div>
    </details>
  )
}

function ArcDetails({ state, segment }: { state: ContourState; segment: PathSegment }) {
  if (segment.kind !== 'arc') return null
  const result = arcThrough(
    findPoint(state, segment.startId)!,
    findPoint(state, segment.endId)!,
    segment.through,
  )
  if (!result.ok) return null
  const arc = result.arc
  const start = ((((arc.startAngle * 180) / Math.PI) % 360) + 360) % 360
  const sweep = (arc.sweep * 180) / Math.PI
  return (
    <details className="arc-details">
      <summary>圆弧参数</summary>
      <fieldset className="property-group">
        <legend>圆弧几何 · 实时计算</legend>
        <dl className="geometry-values">
          <dt>圆心 Re</dt>
          <dd>
            <output aria-label="圆心实部">{number(arc.center.re)}</output>
          </dd>
          <dt>圆心 Im</dt>
          <dd>
            <output aria-label="圆心虚部">{number(arc.center.im)}</output>
          </dd>
          <dt>半径</dt>
          <dd>
            <output aria-label="圆弧半径">{number(arc.radius)}</output>
          </dd>
          <dt>起点角</dt>
          <dd>
            <output aria-label="圆弧起点角">{number(start)}°</output>
          </dd>
          <dt>终点角</dt>
          <dd>
            <output aria-label="圆弧终点角">{number(start + sweep)}°</output>
          </dd>
          <dt>有向转角</dt>
          <dd>
            <output aria-label="圆弧转角">{number(sweep)}°</output>
          </dd>
          <dt>方向</dt>
          <dd>{sweep > 0 ? '逆时针' : '顺时针'}</dd>
        </dl>
        <p className="muted small">角度从实轴正方向起算，逆时针为正。</p>
      </fieldset>
    </details>
  )
}

function SingleObjectProperties({
  state,
  dispatch,
  selection,
  avoidanceWorkflow,
  onInspectHidden,
}: {
  state: ContourState
  dispatch: Dispatch<EditorAction>
  selection: SelectionItem
  avoidanceWorkflow?: AvoidanceWorkflow
  onInspectHidden: (id: string) => void
}) {
  const segment = selection.kind === 'segment' ? findSegment(state, selection.id) : undefined
  const point =
    selection.kind === 'vertex'
      ? state.vertices.find((p) => p.id === selection.id)
      : selection.kind === 'marker'
        ? state.markers.find((p) => p.id === selection.id)
        : selection.kind === 'formula'
          ? state.formulas.find((p) => p.id === selection.id)
          : undefined
  const [expanded, setExpanded] = useState(
    selection.kind === 'formula' || (selection.kind !== 'contour' && selection.part === 'label')
      ? 'label'
      : selection.kind === 'contour'
        ? 'fill'
        : 'geometry',
  )
  const part = selection.kind === 'contour' ? undefined : selection.part
  const [lastPart, setLastPart] = useState(part)
  if (lastPart !== part) {
    setLastPart(part)
    setExpanded(part === 'label' || selection.kind === 'formula' ? 'label' : 'geometry')
  }
  const section = (title: string, id: string, children: ReactNode) => (
    <PropertySection
      title={title}
      open={expanded === id}
      toggle={() => setExpanded(expanded === id ? '' : id)}
    >
      {children}
    </PropertySection>
  )
  const start = segment && findPoint(state, segment.startId)!
  const end = segment && findPoint(state, segment.endId)!
  const selectPoint = (id: string) =>
    dispatch({
      type: 'selectObject',
      selection: { kind: state.markers.some((m) => m.id === id) ? 'marker' : 'vertex', id },
    })
  return (
    <div className="property-content">
      {avoidanceWorkflow &&
        (selection.kind === 'marker' || selection.kind === 'vertex' || segment) && (
          <AvoidanceProperties
            state={state}
            dispatch={dispatch}
            workflow={avoidanceWorkflow}
            onInspectHidden={onInspectHidden}
            markerId={
              selection.kind === 'marker' || selection.kind === 'vertex' ? selection.id : undefined
            }
          />
        )}
      {point && selection.kind !== 'contour' && (
        <>
          {selection.kind === 'formula' &&
            section(
              '公式',
              'label',
              <>
                <LabelForm
                  value={point.label ?? defaultLabel()}
                  formula
                  onApply={(label) => dispatch({ type: 'label', target: selection, label })}
                />
                <button
                  className="danger full-width"
                  onClick={() =>
                    dispatch({ type: 'removeObject', kind: 'formula', id: selection.id })
                  }
                >
                  删除公式
                </button>
              </>,
            )}
          {section(
            selection.kind === 'formula' ? '位置' : '几何',
            'geometry',
            <>
              <fieldset className="property-group">
                <legend>位置 · 数学坐标</legend>
                <PointForm
                  point={point}
                  buttonLabel="应用坐标"
                  onApply={(position) => {
                    if (selection.kind === 'vertex')
                      dispatch({ type: 'move', id: selection.id, point: position })
                    else if (selection.kind === 'marker' || selection.kind === 'formula')
                      dispatch({
                        type: 'moveObject',
                        kind: selection.kind,
                        id: selection.id,
                        point: position,
                      })
                  }}
                />
              </fieldset>
              {selection.kind !== 'formula' && (
                <>
                  <button
                    className="danger full-width"
                    onClick={() => {
                      if (selection.kind === 'vertex') dispatch({ type: 'delete' })
                      else if (selection.kind === 'marker')
                        dispatch({ type: 'removeObject', kind: 'marker', id: selection.id })
                    }}
                  >
                    {selection.kind === 'vertex' ? '删除选中顶点' : '删除标记点'}
                  </button>
                  {selection.kind === 'vertex' && (
                    <p className="muted small">删除端点时同步删除相连路径段，不自动重连。</p>
                  )}
                </>
              )}
            </>,
          )}
          {(selection.kind === 'vertex' || selection.kind === 'marker') &&
            section(
              '外观',
              'style',
              <PointStyleFields
                value={point.pointStyle ?? defaultPointStyle()}
                onChange={(patch) => dispatch({ type: 'pointStyle', target: selection, patch })}
              />,
            )}
          {selection.kind !== 'formula' &&
            section(
              '标签',
              'label',
              <LabelForm
                value={point.label ?? defaultLabel(`z_{${state.vertices.indexOf(point) + 1}}`)}
                onApply={(label) => dispatch({ type: 'label', target: selection, label })}
              />,
            )}
        </>
      )}
      {segment && start && end && (
        <>
          {section(
            '几何',
            'geometry',
            <>
              <div className="property-group">
                <h3>共享端点</h3>
                <div className="endpoint-actions">
                  <button onClick={() => selectPoint(start.id)}>编辑起点</button>
                  <button onClick={() => selectPoint(end.id)}>编辑终点</button>
                </div>
                <p className="muted small">
                  ({number(start.re)}, {number(start.im)}) → ({number(end.re)}, {number(end.im)})
                </p>
              </div>
              <fieldset className="property-group">
                <legend>{segment.kind === 'arc' ? '圆弧经过点' : '指定经过点以转换为圆弧'}</legend>
                <PointForm
                  point={
                    segment.kind === 'arc'
                      ? segment.through
                      : { re: start.re / 2 + end.re / 2, im: start.im / 2 + end.im / 2 }
                  }
                  prefix="经过点"
                  buttonLabel="应用经过点"
                  onApply={(through) => dispatch({ type: 'setArc', id: segment.id, through })}
                />
                <button
                  className="full-width secondary"
                  disabled={segment.kind === 'line'}
                  onClick={() => dispatch({ type: 'setLine', id: segment.id })}
                >
                  改为线段
                </button>
              </fieldset>
              <ArcDetails state={state} segment={segment} />
              <button
                className="danger full-width"
                onClick={() => dispatch({ type: 'deleteSegment', id: segment.id })}
              >
                删除路径段
              </button>
            </>,
          )}
          {section(
            '外观',
            'style',
            <StrokeFields
              value={{ ...state.appearance.stroke, ...segment.style }}
              onChange={(patch) => dispatch({ type: 'stroke', id: segment.id, patch })}
            />,
          )}
          {section(
            '标签',
            'label',
            <LabelForm
              value={segment.label ?? defaultLabel()}
              onApply={(label) => dispatch({ type: 'label', target: selection, label })}
            />,
          )}
        </>
      )}
      {selection.kind === 'contour' && (
        <>
          <p className="muted small">
            {state.vertices.length} 个共享端点 ·{' '}
            {state.segments.filter((s) => s.kind === 'arc').length} 条圆弧 ·{' '}
            {state.closed ? '闭合围道' : '开放路径'}
          </p>
          {section(
            '填充',
            'fill',
            <>
              <FillFields
                value={state.appearance.fill}
                onChange={(patch) => dispatch({ type: 'fill', patch })}
              />
              {!state.closed && <p className="muted small">填充设置已保留，闭合路径后显示。</p>}
            </>,
          )}
          {section(
            '线条',
            'stroke',
            <>
              <StrokeFields
                value={state.appearance.stroke}
                onChange={(patch) => dispatch({ type: 'stroke', patch })}
              />
              <p className="muted small">已单独设置的路径段使用各自样式。</p>
            </>,
          )}
        </>
      )}
    </div>
  )
}

export function ObjectProperties(props: {
  state: ContourState
  dispatch: Dispatch<EditorAction>
  avoidanceWorkflow?: AvoidanceWorkflow
}) {
  const [hiddenBinding, setHiddenBinding] = useState<{
    id: string
    selection: ContourState['selection']
  }>()
  const selection = props.state.selection
  const inspectHidden = (id: string) => setHiddenBinding({ id, selection })
  if (
    hiddenBinding &&
    hiddenBinding.selection === selection &&
    props.avoidanceWorkflow &&
    props.state.avoidances.some((a) => a.id === hiddenBinding.id)
  )
    return (
      <AvoidanceProperties
        state={props.state}
        workflow={props.avoidanceWorkflow}
        avoidanceId={hiddenBinding.id}
        dispatch={(action) => {
          if (action.type === 'selectObject' || action.type === 'selectSegment')
            setHiddenBinding(undefined)
          props.dispatch(action)
        }}
      />
    )
  if (selection.kind === 'multiple') return <MultipleProperties {...props} />
  if (selection.kind === 'none')
    return <p className="muted small property-content">选择对象或拖动框选区域以编辑属性。</p>
  if (selection.kind === 'segment') {
    const origin = segmentOrigin(props.state, selection.id)
    if (origin?.kind === 'avoidance' && props.avoidanceWorkflow)
      return (
        <AvoidanceProperties
          state={props.state}
          dispatch={props.dispatch}
          workflow={props.avoidanceWorkflow}
          avoidanceId={origin.avoidanceId}
        />
      )
    if (origin?.kind === 'gap')
      return (
        <SingleObjectProperties
          {...props}
          onInspectHidden={inspectHidden}
          selection={{ ...selection, id: origin.sourceSegmentId }}
        />
      )
  }
  return <SingleObjectProperties {...props} onInspectHidden={inspectHidden} selection={selection} />
}
