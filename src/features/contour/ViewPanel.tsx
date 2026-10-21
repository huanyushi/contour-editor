import { useState, type Dispatch } from 'react'
import { defaultViewport, gridStep, validViewport, type AxesSettings } from '../../lib/viewport'
import type { ContourAction, ContourState } from './model'
import { PointForm } from './PointForm'
import { ColorField, RangeField } from '../../components/StyleInputs'
import { AxesLabelForm } from './AxesLabelForm'

export function ViewPanel({
  state,
  dispatch,
  onAddVertex,
}: {
  state: ContourState
  dispatch: Dispatch<ContourAction>
  onAddVertex: () => void
}) {
  const view = state.viewport,
    axes = state.axes
  const [x, setX] = useState(String(view.scaleX / 40))
  const [y, setY] = useState(String(view.scaleY / 40))
  const [previous, setPrevious] = useState(view)
  const [error, setError] = useState('')
  if (
    previous.scaleX !== view.scaleX ||
    previous.scaleY !== view.scaleY ||
    previous.locked !== view.locked
  ) {
    setPrevious(view)
    setX(String(Number((view.scaleX / 40).toPrecision(10))))
    setY(String(Number((view.scaleY / 40).toPrecision(10))))
  }
  const axis = (patch: Partial<AxesSettings>) => dispatch({ type: 'axes', patch })
  return (
    <div className="property-content">
      <fieldset className="property-group">
        <legend>显示与吸附</legend>
        <label className="check-row">
          <input
            type="checkbox"
            checked={state.grid}
            onChange={() => dispatch({ type: 'toggleGrid' })}
          />
          显示网格
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={axes.visible}
            onChange={(event) => axis({ visible: event.target.checked })}
          />
          显示坐标轴
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={axes.ticks}
            onChange={(event) => axis({ ticks: event.target.checked })}
          />
          显示坐标轴刻度标签
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={state.snap}
            onChange={() => dispatch({ type: 'toggleSnap' })}
          />
          网格吸附
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={state.handles}
            onChange={() => dispatch({ type: 'toggleHandles' })}
          />
          显示编辑手柄
        </label>
        <p className="muted small">按住 Alt 临时关闭吸附。数值输入保持精确值。</p>
      </fieldset>
      <fieldset className="property-group">
        <legend>视图中心</legend>
        <PointForm
          point={{ re: view.centerRe, im: view.centerIm }}
          prefix="视图中心"
          buttonLabel="应用视图中心"
          onApply={(p) =>
            dispatch({ type: 'viewport', value: { ...view, centerRe: p.re, centerIm: p.im } })
          }
        />
        <button className="full-width secondary" onClick={onAddVertex}>
          在原点追加顶点
        </button>
      </fieldset>
      <form
        className="property-group"
        onSubmit={(event) => {
          event.preventDefault()
          const candidate = {
            ...view,
            scaleX: Number(x) * 40,
            scaleY: Number(view.locked ? x : y) * 40,
          }
          if (!x.trim() || (!view.locked && !y.trim()) || !validViewport(candidate)) {
            setError('倍率须为 0.00025–100 之间的有限数值。')
            return
          }
          setError('')
          dispatch({ type: 'viewport', value: candidate })
        }}
      >
        <h3>坐标轴单位比例</h3>
        <label className="check-row">
          <input
            type="checkbox"
            checked={view.locked}
            onChange={(event) =>
              dispatch({
                type: 'viewport',
                value: {
                  ...view,
                  locked: event.target.checked,
                  scaleY: event.target.checked ? view.scaleX : view.scaleY,
                },
              })
            }
          />
          锁定两轴 1:1
        </label>
        <div className="coordinate-fields">
          <label>
            横轴倍率
            <input
              aria-label="横轴倍率"
              inputMode="decimal"
              value={x}
              onChange={(event) => setX(event.target.value)}
            />
          </label>
          <label>
            纵轴倍率
            <input
              aria-label="纵轴倍率"
              inputMode="decimal"
              value={view.locked ? x : y}
              disabled={view.locked}
              onChange={(event) => setY(event.target.value)}
            />
          </label>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="primary full-width">
          应用视图比例
        </button>
        <p className="muted small">
          1× = 40 像素／单位。自动刻度：横 {gridStep(view.scaleX, view.centerRe)}，纵{' '}
          {gridStep(view.scaleY, view.centerIm)}。
        </p>
      </form>
      <AxesLabelForm value={axes} onApply={axis} />
      <fieldset className="property-group">
        <legend>坐标轴外观</legend>
        <ColorField
          label="轴颜色"
          name="坐标轴颜色"
          value={axes.color}
          onChange={(color) => axis({ color })}
        />
        <RangeField
          label="轴线宽"
          name="坐标轴线宽"
          value={axes.width}
          min={0.5}
          max={4}
          step={0.5}
          onChange={(width) => axis({ width })}
        />
        <label className="field-row">
          箭头形状
          <select
            aria-label="坐标轴箭头"
            value={axes.arrow}
            onChange={(event) => axis({ arrow: event.target.value as AxesSettings['arrow'] })}
          >
            <option value="latex">LaTeX 风格</option>
            <option value="triangle">实心三角</option>
            <option value="open">开放箭头</option>
            <option value="none">无箭头</option>
          </select>
        </label>
        <RangeField
          label="箭头大小"
          name="坐标轴箭头大小"
          value={axes.arrowSize}
          min={6}
          max={20}
          onChange={(arrowSize) => axis({ arrowSize })}
        />
      </fieldset>
      <button
        className="full-width secondary"
        onClick={() => dispatch({ type: 'viewport', value: defaultViewport() })}
      >
        重置视图比例
      </button>
    </div>
  )
}
