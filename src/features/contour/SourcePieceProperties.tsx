import type { Dispatch } from 'react'
import { defaultLabel } from './appearance'
import type { ContourState } from './model'
import type { EditorAction } from './history'
import { LabelForm } from './LabelForm'
import { StrokeFields } from './StyleFields'
import { selectedSegmentLabel, selectedSegmentStyle } from './avoidance/avoidanceSelection'
import { findResolvedSegment, segmentOrigin } from './scene/sceneObjects'
import type { AvoidanceWorkflow } from './avoidance/useAvoidanceDraft'
import { AvoidanceProperties } from './avoidance/AvoidanceProperties'

export function SourcePieceProperties({
  state,
  dispatch,
  id,
  avoidanceWorkflow,
  onInspectHidden,
}: {
  state: ContourState
  dispatch: Dispatch<EditorAction>
  id: string
  avoidanceWorkflow?: AvoidanceWorkflow
  onInspectHidden?: (id: string) => void
}) {
  const origin = segmentOrigin(state, id)
  const segment = findResolvedSegment(state, id)
  const style = selectedSegmentStyle(state, id)
  if (origin?.kind !== 'gap' || !style) return null
  return (
    <div className="property-content">
      {avoidanceWorkflow && (
        <AvoidanceProperties
          state={state}
          dispatch={dispatch}
          workflow={avoidanceWorkflow}
          onInspectHidden={onInspectHidden}
        />
      )}
      <p className="muted small">原路径 {origin.sourceSegmentId} · 保留段</p>
      <p className="muted small">形状由原路径和绕行参数确定；以下设置只作用于当前段。</p>
      {!segment && !avoidanceWorkflow && (
        <p className="muted small">原路径暂存，当前段不显示；设置已保留。</p>
      )}
      <fieldset className="property-group">
        <legend>当前段外观</legend>
        <StrokeFields value={style} onChange={(patch) => dispatch({ type: 'stroke', id, patch })} />
      </fieldset>
      <LabelForm
        key={id}
        value={selectedSegmentLabel(state, id) ?? defaultLabel()}
        onApply={(label) => dispatch({ type: 'label', target: { kind: 'segment', id }, label })}
      />
    </div>
  )
}
