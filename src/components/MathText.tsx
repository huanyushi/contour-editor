import { renderMath } from '../lib/math'

export function MathText({
  tex,
  size = 16,
  color,
}: {
  tex: string
  size?: number
  color?: string
}) {
  const result = renderMath(tex)
  return result.error ? (
    <span title={result.error}>{tex}</span>
  ) : (
    <span
      className="math-text"
      style={{ width: (result.width * size) / 16, height: (result.height * size) / 16, color }}
      role="img"
      aria-label={tex}
      dangerouslySetInnerHTML={{ __html: result.svg }}
    />
  )
}
