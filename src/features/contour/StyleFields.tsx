import { ColorField, RangeField } from '../../components/StyleInputs'
import type { ArrowShape, FillStyle, PointStyle, StrokeStyle } from './appearance'

export function ArrowFields({
  shape,
  size,
  mixedSize = false,
  name = '方向箭头',
  onChange,
}: {
  shape: ArrowShape | undefined
  size: number
  mixedSize?: boolean
  name?: string
  onChange: (patch: Partial<Pick<StrokeStyle, 'arrowShape' | 'arrowSize'>>) => void
}) {
  return (
    <>
      <label className="field-row">
        箭头形状
        <select
          aria-label={`${name}形状`}
          value={shape ?? ''}
          onChange={(event) => onChange({ arrowShape: event.target.value as ArrowShape })}
        >
          {shape === undefined && (
            <option value="" disabled>
              多种
            </option>
          )}
          <option value="latex">LaTeX 风格</option>
          <option value="triangle">实心三角</option>
          <option value="open">开放箭头</option>
        </select>
      </label>
      <RangeField
        label="箭头大小"
        name={`${name}大小`}
        value={size}
        min={6}
        max={20}
        step={1}
        valueLabel={mixedSize ? '多种' : `${size} px`}
        onChange={(arrowSize) => onChange({ arrowSize })}
      />
    </>
  )
}

export function StrokeFields({
  value,
  onChange,
}: {
  value: StrokeStyle
  onChange: (patch: Partial<StrokeStyle>) => void
}) {
  return (
    <fieldset className="property-group">
      <legend>线条样式</legend>
      <ColorField label="线条颜色" value={value.color} onChange={(color) => onChange({ color })} />
      <RangeField
        label="线条粗细"
        value={value.width}
        min={0.5}
        max={8}
        step={0.5}
        onChange={(width) => onChange({ width })}
      />
      <label className="field-row">
        线型
        <select
          aria-label="线型"
          value={value.dash}
          onChange={(event) => onChange({ dash: event.target.value as StrokeStyle['dash'] })}
        >
          <option value="solid">实线</option>
          <option value="dashed">虚线</option>
          <option value="dotted">点线</option>
        </select>
      </label>
      <label className="check-row">
        <input
          type="checkbox"
          checked={value.arrows}
          onChange={(event) => onChange({ arrows: event.target.checked })}
        />
        显示方向箭头
      </label>
      {value.arrows && (
        <ArrowFields shape={value.arrowShape} size={value.arrowSize} onChange={onChange} />
      )}
    </fieldset>
  )
}

export function FillFields({
  value,
  onChange,
}: {
  value: FillStyle
  onChange: (patch: Partial<FillStyle>) => void
}) {
  return (
    <fieldset className="property-group">
      <legend>区域填充</legend>
      <label className="field-row">
        填充形式
        <select
          aria-label="填充形式"
          value={value.mode}
          onChange={(event) => onChange({ mode: event.target.value as FillStyle['mode'] })}
        >
          <option value="none">无填充</option>
          <option value="solid">纯色 / 阴影</option>
          <option value="hatch">斜线填充</option>
        </select>
      </label>
      {value.mode !== 'none' && (
        <>
          <ColorField
            label="填充颜色"
            value={value.color}
            onChange={(color) => onChange({ color })}
          />
          <RangeField
            label="不透明度"
            name="填充不透明度"
            value={value.opacity}
            min={0}
            max={1}
            step={0.05}
            valueLabel={`${Math.round(value.opacity * 100)}%`}
            onChange={(opacity) => onChange({ opacity })}
          />
          {value.mode === 'hatch' && (
            <>
              <RangeField
                label="斜线角度"
                value={value.angle}
                min={-180}
                max={180}
                step={5}
                valueLabel={`${value.angle}°`}
                onChange={(angle) => onChange({ angle })}
              />
              <RangeField
                label="斜线间距"
                value={value.spacing}
                min={4}
                max={30}
                onChange={(spacing) => onChange({ spacing })}
              />
            </>
          )}
        </>
      )}
    </fieldset>
  )
}

export function PointStyleFields({
  value,
  onChange,
}: {
  value: PointStyle
  onChange: (patch: Partial<PointStyle>) => void
}) {
  return (
    <fieldset className="property-group">
      <legend>点样式</legend>
      <ColorField label="点颜色" value={value.color} onChange={(color) => onChange({ color })} />
      <RangeField
        label="点半径"
        value={value.radius}
        min={2}
        max={10}
        onChange={(radius) => onChange({ radius })}
      />
    </fieldset>
  )
}
