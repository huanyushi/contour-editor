import { useRef, useState, type Dispatch } from 'react'
import { constructAvoidance } from './avoidanceConstruction'
import { defaultLabel } from '../appearance'
import { AvoidanceFields } from './AvoidanceFields'
import type { LegacyAvoidance, ParentAvoidancePart } from './avoidanceTypes'
import { isLegacyAvoidance } from './avoidanceTypes'
import {
  avoidanceSelectionId,
  avoidanceSourceIds,
  relatedAvoidanceIds,
} from './avoidanceDependencies'
import { ConnectedAvoidanceProperties } from './ConnectedAvoidanceProperties'
import { editableAvoidance } from './avoidanceParameters'
import type { EditorAction } from '../history'
import { focusInspector } from '../inspectorFocus'
import { LabelForm } from '../LabelForm'
import type { ContourState } from '../model'
import {
  findPoint,
  findResolvedSegment,
  findSegment,
  scenePoints,
  segmentOrigin,
  visibleSceneSegments,
} from '../scene/sceneObjects'
import { StrokeFields } from '../StyleFields'
import type { AvoidanceWorkflow } from './useAvoidanceDraft'
import {
  mathematicalCategories,
  mathematicalCategory,
  mathematicalNames,
} from '../mathematicalKind'
import { avoidancePartNames as partNames } from './avoidancePresentation'

interface AvoidancePropertiesProps {
  state: ContourState
  dispatch: Dispatch<EditorAction>
  workflow: AvoidanceWorkflow
  avoidanceId?: string
  markerId?: string
}

const number = (value: number) => Number(value.toFixed(6)).toString()
const pointKind = (state: ContourState, id: string) =>
  state.vertices.some((p) => p.id === id) ? ('vertex' as const) : ('marker' as const)
function BindingEditor({
  state,
  dispatch,
  workflow,
  value,
  creating = false,
}: {
  state: ContourState
  dispatch: Dispatch<EditorAction>
  workflow: AvoidanceWorkflow
  value: LegacyAvoidance
  creating?: boolean
}) {
  const content = useRef<HTMLDivElement>(null)
  const [hiddenPart, setHiddenPart] = useState<ParentAvoidancePart>('arc')
  const source = findSegment(state, value.targetSegmentId)!
  const start = findPoint(state, source.startId)!
  const end = findPoint(state, source.endId)!
  const center = findPoint(state, value.markerId)!
  const result = constructAvoidance(state, value)
  // Preserve the mode controls even while an invalid draft has no geometry.
  const mode = result.ok ? result.value.mode : value.exitSegmentId ? 'corner' : source.kind
  const exit = value.exitSegmentId ? findSegment(state, value.exitSegmentId) : undefined
  const dx = end.re - start.re,
    dy = end.im - start.im
  const length = Math.hypot(dx, dy)
  const projection = (point: { re: number; im: number }) =>
    (point.re - start.re) * (dx / length) + (point.im - start.im) * (dy / length)
  const s = projection(center)
  const maximum =
    mode !== 'line'
      ? Math.min(
          ...[start, exit ? findPoint(state, exit.endId)! : end].map((p) =>
            Math.hypot(p.re - center.re, p.im - center.im),
          ),
        )
      : Math.min(
          s,
          length - s,
          ...state.avoidances
            .filter((a) => a.id !== value.id && a.targetSegmentId === source.id)
            .map((a) => Math.abs(s - projection(findPoint(state, a.markerId)!)) - a.radius),
        )
  const selection = state.selection
  const origin = selection.kind === 'segment' ? segmentOrigin(state, selection.id) : undefined
  const part =
    origin?.kind === 'avoidance' && origin.avoidanceId === value.id ? origin.part : hiddenPart
  const visible = new Set(visibleSceneSegments(state).map((s) => s.id))
  const sourceVisible = visible.has(source.id) && (!exit || visible.has(exit.id))
  const error =
    creating && workflow.preview && !workflow.preview.ok
      ? workflow.preview.error
      : result.ok
        ? ''
        : result.error
  const navigate = (kind: 'vertex' | 'marker' | 'segment', id: string) => {
    dispatch({ type: 'selectObject', selection: { kind, id } })
    focusInspector()
  }
  return (
    <div ref={content} className="property-content">
      <p className="muted small">
        奇点 {center.id} ·{' '}
        {exit ? `进入路径 ${source.id} · 离开路径 ${exit.id}` : `原路径 ${source.id}`}
      </p>
      <p className="muted small">
        {mode === 'line' ? '沿线占用范围：' : '端点距离必要上界：'}
        <output aria-label="可用半径范围">0 &lt; r &lt; {number(maximum)}</output>
        {mode === 'line' ? '。还需通过路径交叉检查。' : '。仍须满足有限源路径交点和完整场景检查。'}
      </p>
      {mode !== 'line' && (
        <p className="muted small">
          {mode === 'corner'
            ? '避让圆分别与进入、离开两条源路径求交并裁剪角点；默认短弧，可切换另一侧。'
            : '避让圆与源圆弧须有两个不同交点；按交点裁剪，保留两侧真实源圆弧。'}
        </p>
      )}
      <AvoidanceFields
        value={value}
        mode={mode}
        geometry={result.ok ? result.value.geometry : null}
        error={error}
        onChange={(patch) =>
          creating
            ? workflow.patch(patch)
            : dispatch({ type: 'updateAvoidance', id: value.id, patch })
        }
      />
      {creating ? (
        <>
          <button
            className="primary full-width"
            disabled={!workflow.preview?.ok}
            onClick={() => {
              const invalid = content.current?.querySelector<HTMLInputElement>(
                'input[aria-invalid="true"]',
              )
              if (invalid) {
                invalid.focus()
                return
              }
              workflow.apply()
              focusInspector()
            }}
          >
            应用绕行
          </button>
          <button
            className="full-width"
            onClick={() => {
              workflow.cancel()
              navigate(pointKind(state, value.markerId), value.markerId)
            }}
          >
            取消预览
          </button>
        </>
      ) : (
        <>
          <div className="endpoint-actions">
            <button onClick={() => navigate(pointKind(state, value.markerId), value.markerId)}>
              定位奇点
            </button>
            <button onClick={() => navigate('segment', source.id)}>定位原路径</button>
            {exit && <button onClick={() => navigate('segment', exit.id)}>定位离开路径</button>}
          </div>
          <button
            className="danger full-width"
            onClick={() => {
              dispatch({ type: 'removeAvoidance', id: value.id })
              navigate('segment', source.id)
            }}
          >
            取消绕行
          </button>
          <fieldset className="property-group avoidance-part-properties">
            <legend>部件外观与标签</legend>
            <label className="field-row avoidance-select-field">
              当前部件
              <select
                aria-label="绕行部件"
                value={part}
                onChange={(event) => {
                  const next = event.target.value
                  if (next !== 'entry' && next !== 'arc' && next !== 'exit') return
                  const id = `avoid:${value.id}:${next}`
                  if (segmentOrigin(state, id)) navigate('segment', id)
                  else setHiddenPart(next)
                }}
              >
                {(['entry', 'arc', 'exit'] as const).map((name) => (
                  <option key={name} value={name}>
                    {partNames[name]}
                  </option>
                ))}
              </select>
            </label>
            {!sourceVisible ? (
              <p className="muted small">原路径暂存，部件暂不显示；设置已保留。</p>
            ) : (
              !findResolvedSegment(state, `avoid:${value.id}:${part}`) && (
                <p className="muted small">当前连接段长度为零，样式和标签保留，重新出现时生效。</p>
              )
            )}
            <p className="muted small">默认继承原路径；修改仅覆盖当前部件。</p>
          </fieldset>
          <StrokeFields
            value={{ ...state.appearance.stroke, ...source.style, ...value.partStyles?.[part] }}
            onChange={(patch) => dispatch({ type: 'avoidanceStyle', id: value.id, part, patch })}
          />
          <LabelForm
            key={`${value.id}:${part}`}
            value={value.partLabels?.[part] ?? defaultLabel()}
            onApply={(label) => dispatch({ type: 'avoidanceLabel', id: value.id, part, label })}
          />
        </>
      )}
    </div>
  )
}

export function AvoidanceProperties({
  state,
  dispatch,
  workflow,
  avoidanceId,
  markerId,
  onInspectHidden,
}: AvoidancePropertiesProps & { onInspectHidden?: (id: string) => void }) {
  const draft = workflow.draft
  if (draft.kind === 'pickTarget')
    return (
      <div className="property-content">
        <div className="property-group">
          <h3>选择绕行目标</h3>
          <p className="muted small">点击画布中的源直线或圆弧；角点可选任一相邻路径。Esc 取消。</p>
          {draft.error && (
            <>
              <p className="error" role="alert">
                {draft.error}
              </p>
              <button className="full-width" onClick={() => workflow.start(draft.markerId)}>
                重新选择目标
              </button>
            </>
          )}
          <button
            className="full-width"
            onClick={() => {
              workflow.cancel()
              dispatch({
                type: 'selectObject',
                selection: { kind: pointKind(state, draft.markerId), id: draft.markerId },
              })
              focusInspector()
            }}
          >
            取消选择目标
          </button>
        </div>
      </div>
    )
  if (draft.kind === 'configure')
    if (!isLegacyAvoidance(draft.avoidance))
      return (
        <ConnectedAvoidanceProperties
          key={draft.avoidance.id}
          state={state}
          dispatch={dispatch}
          workflow={workflow}
          value={draft.avoidance}
          creating
        />
      )
    else
      return (
        <BindingEditor
          key={draft.avoidance.id}
          state={state}
          dispatch={dispatch}
          workflow={workflow}
          value={draft.avoidance}
          creating
        />
      )
  const stored = state.avoidances.find((a) => a.id === avoidanceId)
  const avoidance = stored && editableAvoidance(state, stored)
  if (avoidance)
    if (!isLegacyAvoidance(avoidance))
      return (
        <ConnectedAvoidanceProperties
          key={avoidance.id}
          state={state}
          dispatch={dispatch}
          workflow={workflow}
          value={avoidance}
        />
      )
    else
      return (
        <BindingEditor
          key={avoidance.id}
          state={state}
          dispatch={dispatch}
          workflow={workflow}
          value={avoidance}
        />
      )
  const marker = markerId ? findPoint(state, markerId) : undefined
  const category = mathematicalCategory(marker?.mathematicalKind)
  const selection = state.selection
  const sourceId =
    selection.kind === 'segment' ? segmentOrigin(state, selection.id)?.sourceSegmentId : undefined
  const related = new Set(sourceId ? relatedAvoidanceIds(state, sourceId) : [])
  const bindings = state.avoidances.filter((a) =>
    marker ? a.markerId === marker.id : related.has(a.id),
  )
  if (!marker && !sourceId && bindings.length === 0) return null
  return (
    <div className="property-group">
      {marker && (
        <label className="field-row avoidance-select-field">
          数学类型
          <select
            aria-label="数学类型"
            value={category}
            onChange={(event) => {
              const value = mathematicalCategories.find(
                (kind) => kind === event.currentTarget.value,
              )
              if (value && value !== category)
                dispatch({ type: 'mathematicalKind', id: marker.id, value })
            }}
          >
            {mathematicalCategories.map((kind) => (
              <option key={kind} value={kind}>
                {mathematicalNames[kind]}
              </option>
            ))}
          </select>
        </label>
      )}
      {bindings.length > 0 && <h3>绕行绑定 · {bindings.length}</h3>}
      {sourceId && !visibleSceneSegments(state).some((s) => s.id === sourceId) && (
        <p className="muted small">原路径暂存，部件暂不显示；设置已保留，可继续编辑绕行。</p>
      )}
      {bindings.map((a, index) => (
        <button
          key={a.id}
          className="full-width"
          aria-label={`编辑绕行 ${index + 1}`}
          onClick={() => {
            const id = avoidanceSelectionId(a)
            if (segmentOrigin(state, id)) dispatch({ type: 'selectSegment', id })
            else onInspectHidden?.(a.id)
            focusInspector()
          }}
        >
          绕行 {index + 1} ·{' '}
          {marker
            ? a.kind === 'bank-clearance'
              ? `父绕行 ${a.parentAvoidanceId}`
              : `原路径 ${avoidanceSourceIds(state, a.id).join('、')}`
            : `奇点 ${a.markerId}`}
        </button>
      ))}
      {marker && marker.mathematicalKind && marker.mathematicalKind !== 'ordinary' && (
        <button className="full-width" onClick={() => workflow.start(marker.id)}>
          添加绕行
        </button>
      )}
      {!marker && sourceId && findSegment(state, sourceId) && (
        <>
          <p className="muted small">选择奇点后添加绕行，再点击目标直线或圆弧。</p>
          {scenePoints(state)
            .filter((m) => m.mathematicalKind && m.mathematicalKind !== 'ordinary')
            .map((m, index) => (
              <button
                key={m.id}
                className="full-width"
                onClick={() => {
                  dispatch({
                    type: 'selectObject',
                    selection: { kind: pointKind(state, m.id), id: m.id },
                  })
                  focusInspector()
                }}
              >
                选择奇点 {index + 1} 添加绕行
              </button>
            ))}
        </>
      )}
    </div>
  )
}
