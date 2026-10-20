import type { Dispatch } from 'react'
import { ColorField, RangeField } from '../../components/StyleInputs'
import { defaultPointStyle } from './appearance'
import type { ContourAction, ContourState } from './model'
import { itemColor, itemLabel, selectionItems } from './selectionModel'
import { findSegment } from './sceneObjects'

function common<T>(values: T[]): T | undefined {
  return values.length && values.every((value) => value === values[0]) ? values[0] : undefined
}

export function MultipleProperties({
  state,
  dispatch,
}: {
  state: ContourState
  dispatch: Dispatch<ContourAction>
}) {
  const items = selectionItems(state.selection)
  const widths = items.flatMap((item) =>
    item.kind === 'contour'
      ? state.segments.map((s) => s.style?.width ?? state.appearance.stroke.width)
      : item.kind === 'segment' && item.part !== 'label'
        ? [findSegment(state, item.id)?.style?.width ?? state.appearance.stroke.width]
        : [],
  )
  const radii = items.flatMap((item) =>
    (item.kind === 'vertex' || item.kind === 'marker') && item.part !== 'label'
      ? [
          (item.kind === 'vertex' ? state.vertices : state.markers).find((p) => p.id === item.id)
            ?.pointStyle?.radius ?? defaultPointStyle().radius,
        ]
      : [],
  )
  const textSizes = items.flatMap((item) =>
    item.kind !== 'contour' && (item.kind === 'formula' || item.part === 'label')
      ? [itemLabel(state, item)?.size ?? 16]
      : [],
  )
  return (
    <div className="property-content">
      {state.selectionSource === 'click' && (
        <button className="danger full-width" onClick={() => dispatch({ type: 'deleteSelection' })}>
          删除选中对象
        </button>
      )}
      <p className="muted small">
        已选中 {items.length} 个对象。外观修改同时应用于适用的选中对象。
      </p>
      <fieldset className="property-group">
        <legend>批量外观</legend>
        <ColorField
          label="颜色"
          name="所选对象颜色"
          value={common(items.map((item) => itemColor(state, item)))}
          onChange={(color) => dispatch({ type: 'selectionStyle', patch: { color } })}
        />
        {!!widths.length && (
          <RangeField
            label="线宽"
            name="所选线宽"
            min={0.5}
            max={8}
            step={0.5}
            value={common(widths) ?? widths[0]}
            valueLabel={common(widths) === undefined ? '多种' : `${widths[0]} px`}
            onChange={(width) => dispatch({ type: 'selectionStyle', patch: { width } })}
          />
        )}
        {!!radii.length && (
          <RangeField
            label="点半径"
            name="所选点半径"
            min={2}
            max={10}
            step={1}
            value={common(radii) ?? radii[0]}
            valueLabel={common(radii) === undefined ? '多种' : `${radii[0]} px`}
            onChange={(radius) => dispatch({ type: 'selectionStyle', patch: { radius } })}
          />
        )}
        {!!textSizes.length && (
          <RangeField
            label="文字字号"
            name="所选文字字号"
            min={10}
            max={40}
            step={1}
            value={common(textSizes) ?? textSizes[0]}
            valueLabel={common(textSizes) === undefined ? '多种' : `${textSizes[0]} px`}
            onChange={(labelSize) => dispatch({ type: 'selectionStyle', patch: { labelSize } })}
          />
        )}
      </fieldset>
      <p className="muted small">Delete／Backspace 删除；Ctrl／⌘＋单击增减选择；Esc 取消选择。</p>
    </div>
  )
}
