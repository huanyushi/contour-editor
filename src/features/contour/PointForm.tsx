import { useId, useState, type FormEvent } from 'react'
import { isValidPoint, type ComplexPoint } from '../../lib/geometry'
import { MathText } from '../../components/MathText'

interface Props {
  point: ComplexPoint
  onApply: (point: ComplexPoint) => void
  prefix?: string
  buttonLabel: string
}

export function PointForm({ point, onApply, prefix = '', buttonLabel }: Props) {
  const [re, setRe] = useState(String(point.re))
  const [im, setIm] = useState(String(point.im))
  const [error, setError] = useState('')
  const [committed, setCommitted] = useState(point)
  const errorId = useId()
  if (committed.re !== point.re || committed.im !== point.im) {
    setCommitted(point)
    setRe(String(point.re))
    setIm(String(point.im))
    setError('')
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    const candidate = { re: Number(re), im: Number(im) }
    if (!re.trim() || !im.trim() || !isValidPoint(candidate)) {
      setError('请输入有效的有限数值，实部和虚部均不能为空。')
      return
    }
    setError('')
    onApply(candidate)
  }

  return (
    <form onSubmit={submit} noValidate>
      <div className="coordinate-fields">
        <label>
          {prefix}实部 <MathText tex="\mathrm{Re}" />
          <input
            aria-label={`${prefix}实部 Re`}
            inputMode="decimal"
            value={re}
            onChange={(event) => setRe(event.target.value)}
            aria-invalid={!!error}
            aria-describedby={error ? errorId : undefined}
          />
        </label>
        <label>
          {prefix}虚部 <MathText tex="\mathrm{Im}" />
          <input
            aria-label={`${prefix}虚部 Im`}
            inputMode="decimal"
            value={im}
            onChange={(event) => setIm(event.target.value)}
            aria-invalid={!!error}
            aria-describedby={error ? errorId : undefined}
          />
        </label>
      </div>
      {error && (
        <p role="alert" className="error" id={errorId}>
          {error}
        </p>
      )}
      <button className="primary full-width" type="submit">
        {buttonLabel}
      </button>
    </form>
  )
}
