import { useRef, useState, type Dispatch } from 'react'
import { defaultLabel } from './appearance'
import { AvoidanceNumberField } from './AvoidanceNumberField'
import { constructAvoidances } from './avoidanceConstructionTable'
import { avoidanceSelectionId } from './avoidanceDependencies'
import { patchAvoidance, type AvoidancePatch } from './avoidanceModel'
import {
  isLegacyAvoidance,
  type AvoidancePart,
  type BankClearanceAvoidance,
  type CorridorAvoidance,
} from './avoidanceTypes'
import { projectSceneError } from '../project/validation'
import { focusInspector } from './inspectorFocus'
import { LabelForm } from './LabelForm'
import type { EditorAction } from './history'
import type { ContourState } from './model'
import {
  findResolvedSegment,
  findSegment,
  segmentOrigin,
  visibleSceneSegments,
} from './sceneObjects'
import { StrokeFields } from './StyleFields'
import type { AvoidanceWorkflow } from './useAvoidanceDraft'
import {
  avoidanceAngle,
  avoidanceDirectionPatch,
  avoidanceNormalPatch,
  editableAvoidance,
} from './avoidanceParameters'

const names: Record<AvoidancePart, string> = {
  entry: '进入连接段',
  arc: '绕行圆弧',
  exit: '离开连接段',
  'bank-entry': '进入岸避让弧',
  'bank-exit': '离开岸避让弧',
}

/** Parents and paired clearances share parameter, preview, navigation and appearance semantics. */
export function ConnectedAvoidanceProperties({
  state,
  dispatch,
  workflow,
  value,
  creating = false,
}: {
  state: ContourState
  dispatch: Dispatch<EditorAction>
  workflow: AvoidanceWorkflow
  value: CorridorAvoidance | BankClearanceAvoidance
  creating?: boolean
}) {
  const content = useRef<HTMLDivElement>(null)
  const [part, setPart] = useState<AvoidancePart>(value.kind === 'corridor' ? 'arc' : 'bank-entry')
  const [error, setError] = useState('')
  const candidate = creating ? (workflow.previewDocument ?? state) : state
  const storedParent =
    value.kind === 'corridor'
      ? value
      : candidate.avoidances.find((a) => a.id === value.parentAvoidanceId)
  const parent = storedParent && editableAvoidance(candidate, storedParent)
  if (!parent || parent.kind === 'bank-clearance')
    return (
      <p className="error" role="alert">
        父绕行不存在。
      </p>
    )
  const table = constructAvoidances(candidate)
  const construction = table.ok ? table.value.parents.get(parent.id) : undefined
  const clearance = table.ok ? table.value.clearances.get(value.id) : undefined
  const sourceId =
    construction?.primarySourceId ??
    (parent.kind === 'corridor' ? parent.anchor.segmentId : parent.targetSegmentId)
  const source = findSegment(state, sourceId)
  const gap =
    parent.kind === 'corridor'
      ? parent.gap
      : (construction?.bankPair?.gap ?? 2 * parent.radius * parent.openingRatio)
  const currentOrigin =
    state.selection.kind === 'segment' ? segmentOrigin(state, state.selection.id) : undefined
  const current =
    currentOrigin?.kind === 'avoidance' && currentOrigin.avoidanceId === value.id
      ? currentOrigin.part
      : part
  const parts: AvoidancePart[] =
    value.kind === 'corridor' ? ['entry', 'arc', 'exit'] : ['bank-entry', 'bank-exit']
  const visible = new Set(visibleSceneSegments(state).map((s) => s.id))
  const hidden = construction?.trims.some((t) => !visible.has(t.sourceSegmentId))
  const navigate = (id: string, kind: 'segment' | 'marker' | 'vertex' = 'segment') => {
    dispatch({ type: 'selectObject', selection: { kind, id } })
    focusInspector()
  }
  const navigateMarker = () =>
    navigate(
      value.markerId,
      state.vertices.some((p) => p.id === value.markerId) ? 'vertex' : 'marker',
    )
  const change = (patch: AvoidancePatch) => {
    setError('')
    if (creating) workflow.patch(patch)
    else dispatch({ type: 'updateAvoidance', id: value.id, patch })
  }
  const changeGap = (nextGap: number) => {
    setError('')
    if (value.kind === 'corridor') {
      change({ gap: nextGap })
      return
    }
    if (creating) {
      workflow.patchParentGap(nextGap)
      return
    }
    const patch: AvoidancePatch = isLegacyAvoidance(parent)
      ? { openingRatio: nextGap / (2 * parent.radius) }
      : { gap: nextGap }
    const proposed = {
      ...state,
      avoidances: state.avoidances.map((a) =>
        a.id === parent.id ? patchAvoidance(editableAvoidance(state, a), patch) : a,
      ),
    }
    const next = constructAvoidances(proposed)
    const actual = next.ok ? next.value.parents.get(parent.id)?.bankPair?.gap : undefined
    const problem = projectSceneError(proposed)
    if (problem || actual === undefined || Math.abs(actual - nextGap) > 1e-9 * nextGap) {
      setError(problem || '请求的两岸间距无法保持，请调整半径或间距。')
      return
    }
    dispatch({ type: 'updateAvoidance', id: parent.id, patch })
  }
  const parentPart = current === 'bank-entry' ? 'entry' : current === 'bank-exit' ? 'exit' : current
  const style = {
    ...state.appearance.stroke,
    ...source?.style,
    ...(value.kind === 'bank-clearance' ? parent.partStyles?.[parentPart] : {}),
    ...value.partStyles?.[current],
  }
  const previewError =
    creating && workflow.preview && !workflow.preview.ok ? workflow.preview.error : ''
  return (
    <div ref={content} className="property-content">
      <p className="muted small">
        奇点 {value.markerId} ·{' '}
        {value.kind === 'bank-clearance' ? `父绕行 ${parent.id}` : `原路径 ${sourceId}`}
      </p>
      <fieldset className="property-group">
        <legend>绕行参数</legend>
        <AvoidanceNumberField
          label="绕行半径"
          value={value.radius}
          onCommit={(radius) => change({ radius })}
        />
        <AvoidanceNumberField label="两岸间距" value={gap} onCommit={changeGap} />
        {value.kind === 'corridor' && (
          <>
            <p className="muted small">
              {value.alignment?.kind === 'normal'
                ? '移动奇点时，接入口沿源路径法向跟随。'
                : value.alignment?.kind === 'direction'
                  ? '移动奇点时保留手动朝向，接入口随之移动。'
                  : '旧项目保留原接入位置，可恢复法向跟随。'}
            </p>
            {value.alignment?.kind !== 'normal' && (
              <button
                type="button"
                className="full-width"
                onClick={() => {
                  const result = avoidanceNormalPatch(candidate, value)
                  if (result.ok) change(result.value)
                  else setError(result.error)
                }}
              >
                恢复法向跟随
              </button>
            )}
            {construction && !construction.bankPair && (
              <p className="muted small">接近源路径时按圆交点直接绕行；两岸间距作为偏好保留。</p>
            )}
          </>
        )}
        {value.kind === 'corridor' && (
          <AvoidanceNumberField
            label="开口朝向（度）"
            signed
            value={avoidanceAngle(candidate, value)}
            onCommit={(degrees) => {
              const result = avoidanceDirectionPatch(candidate, value, degrees)
              if (result.ok) change(result.value)
              else setError(result.error)
            }}
          />
        )}
        <p className="muted small">
          {value.kind === 'corridor'
            ? '半径、间距分别调整；朝向以正实轴为 0°，逆时针为正。'
            : '两岸共用此半径；间距影响整个父通道。'}
        </p>
        <p className="muted small">按 Enter 或移开焦点应用数值。</p>
        {value.kind === 'corridor' && (
          <p className="muted small">
            圆弧端点调半径，接入点同步定位，双箭头调间距；朝向也可输入角度。
          </p>
        )}
        {(error || previewError) && (
          <p className="error" role="alert">
            {error || previewError}
          </p>
        )}
      </fieldset>
      {creating ? (
        <>
          <button
            className="primary full-width"
            disabled={!workflow.preview?.ok}
            onClick={() => {
              const field = content.current?.querySelector<HTMLInputElement>(
                'input[aria-invalid="true"]',
              )
              if (field) {
                field.focus()
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
              navigateMarker()
            }}
          >
            取消预览
          </button>
        </>
      ) : (
        <>
          <div className="endpoint-actions">
            <button onClick={navigateMarker}>定位奇点</button>
            <button onClick={() => navigate(sourceId)}>定位原路径</button>
            {value.kind === 'bank-clearance' && (
              <button onClick={() => navigate(avoidanceSelectionId(parent))}>定位父绕行</button>
            )}
          </div>
          <button
            className="danger full-width"
            onClick={() => {
              dispatch({ type: 'removeAvoidance', id: value.id })
              navigate(value.kind === 'bank-clearance' ? avoidanceSelectionId(parent) : sourceId)
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
                value={current}
                onChange={(event) => {
                  const next = parts.find((p) => p === event.target.value)
                  if (next) {
                    setPart(next)
                    navigate(`avoid:${value.id}:${next}`)
                  }
                }}
              >
                {parts.map((p) => (
                  <option key={p} value={p}>
                    {names[p]}
                  </option>
                ))}
              </select>
            </label>
            {hidden ? (
              <p className="muted small">原路径暂存，父子部件暂不显示；设置已保留。</p>
            ) : value.kind === 'bank-clearance' && clearance?.cuts.length === 0 ? (
              <p className="muted small">当前半径未触及岸线，已在通道留空区内；设置已保留。</p>
            ) : (
              !findResolvedSegment(state, `avoid:${value.id}:${current}`) && (
                <p className="muted small">当前部件被分段或暂不显示，设置已保留。</p>
              )
            )}
            <p className="muted small">外观与标签只覆盖当前部件。</p>
          </fieldset>
          <StrokeFields
            value={style}
            onChange={(patch) =>
              dispatch({ type: 'avoidanceStyle', id: value.id, part: current, patch })
            }
          />
          <LabelForm
            key={`${value.id}:${current}`}
            value={value.partLabels?.[current] ?? defaultLabel()}
            onApply={(label) =>
              dispatch({ type: 'avoidanceLabel', id: value.id, part: current, label })
            }
          />
        </>
      )}
    </div>
  )
}
