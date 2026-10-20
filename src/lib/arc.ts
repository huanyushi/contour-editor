import { isValidPoint, type ComplexPoint } from './geometry'

export interface CircularArc {
  center: ComplexPoint
  radius: number
  startAngle: number
  /** Signed angle in mathematical coordinates: positive is counterclockwise. */
  sweep: number
}

export type ArcResult = { ok: true; arc: CircularArc } | { ok: false; error: string }
const TAU = 2 * Math.PI
const EPSILON = 1e-10
const positiveAngle = (angle: number) => ((angle % TAU) + TAU) % TAU

export function arcThrough(
  start: ComplexPoint,
  end: ComplexPoint,
  through: ComplexPoint,
): ArcResult {
  // Solve in a canonical endpoint order so reversal cannot change validity or radius
  // through different floating-point cancellation. Only traversal changes afterward.
  const reversed = start.re > end.re || (start.re === end.re && start.im > end.im)
  const result = solveArc(reversed ? end : start, reversed ? start : end, through)
  if (!result.ok || !reversed) return result
  return {
    ok: true,
    arc: {
      ...result.arc,
      startAngle: result.arc.startAngle + result.arc.sweep,
      sweep: -result.arc.sweep,
    },
  }
}

function solveArc(start: ComplexPoint, end: ComplexPoint, through: ComplexPoint): ArcResult {
  const invalid = (error: string): ArcResult => ({ ok: false, error })
  if (![start, end, through].every(isValidPoint)) return invalid('圆弧坐标必须是可绘制的有限数值。')

  const ux = end.re - start.re
  const uy = end.im - start.im
  const vx = through.re - start.re
  const vy = through.im - start.im
  const wx = through.re - end.re
  const wy = through.im - end.im
  const scale = Math.max(
    Math.abs(ux),
    Math.abs(uy),
    Math.abs(vx),
    Math.abs(vy),
    Math.abs(wx),
    Math.abs(wy),
  )
  if (!Number.isFinite(scale)) return invalid('圆弧坐标跨度过大，无法稳定计算。')
  if (scale === 0) return invalid('圆弧的三个点不能重合。')
  const u = { x: ux / scale, y: uy / scale }
  const v = { x: vx / scale, y: vy / scale }
  const lu = Math.hypot(u.x, u.y)
  const lv = Math.hypot(v.x, v.y)
  const lw = Math.hypot(wx / scale, wy / scale)
  const longest = Math.max(lu, lv, lw)
  if (Math.min(lu, lv, lw) <= EPSILON * longest)
    return invalid('圆弧起点、终点和经过点不能重合或过于接近。')
  const cross = u.x * v.y - u.y * v.x
  // Twice triangle area / longest-side² is invariant under point permutation.
  if (Math.abs(cross) <= EPSILON * longest * longest)
    return invalid('三点共线或近共线，不能确定稳定的圆弧。')

  const uu = u.x * u.x + u.y * u.y
  const vv = v.x * v.x + v.y * v.y
  const cx = (uu * v.y - vv * u.y) / (2 * cross)
  const cy = (u.x * vv - v.x * uu) / (2 * cross)
  const radius = Math.hypot(cx, cy) * scale
  const center = { re: start.re + cx * scale, im: start.im + cy * scale }
  // Guard the full circle's bounds as well as SVG's radius conversion.
  if (
    !Number.isFinite(radius * 40) ||
    radius <= 0 ||
    !isValidPoint(center) ||
    !isValidPoint({ re: center.re + radius, im: center.im + radius }) ||
    !isValidPoint({ re: center.re - radius, im: center.im - radius })
  )
    return invalid('圆弧半径超出安全绘制范围。')

  // Angles in normalized local coordinates avoid subtracting a large world origin.
  const startAngle = Math.atan2(-cy, -cx)
  const endAngle = Math.atan2(u.y - cy, u.x - cx)
  const throughAngle = Math.atan2(v.y - cy, v.x - cx)
  const ccwEnd = positiveAngle(endAngle - startAngle)
  const ccwThrough = positiveAngle(throughAngle - startAngle)
  const sweep = ccwThrough < ccwEnd ? ccwEnd : ccwEnd - TAU
  if (Math.abs(sweep) <= EPSILON || TAU - Math.abs(sweep) <= EPSILON)
    return invalid('圆弧转角过小或过于接近整圆，无法稳定计算。')
  return { ok: true, arc: { center, radius, startAngle, sweep } }
}

export function pointOnArc(arc: CircularArc, t: number): ComplexPoint {
  const angle = arc.startAngle + arc.sweep * t
  return {
    re: arc.center.re + arc.radius * Math.cos(angle),
    im: arc.center.im + arc.radius * Math.sin(angle),
  }
}

export function tangentOnArc(arc: CircularArc, t: number): ComplexPoint {
  const angle = arc.startAngle + arc.sweep * t
  const direction = Math.sign(arc.sweep)
  return { re: -Math.sin(angle) * direction, im: Math.cos(angle) * direction }
}
