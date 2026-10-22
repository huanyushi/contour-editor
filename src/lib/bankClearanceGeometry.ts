import { arcThrough, type CircularArc } from './arc'
import type { GeometryResult, ParallelBanks } from './connectedAvoidanceGeometry'
import { isValidPoint, type ComplexPoint } from './geometry'

export type BankName = 'entry' | 'exit'
export interface BankCut {
  bank: BankName
  startT: number
  endT: number
  start: ComplexPoint
  end: ComplexPoint
  through: ComplexPoint
  arc: CircularArc
}

/** Replace each affected bank by the boundary of channel ∪ clearance disk. */
export function buildBankClearance(input: {
  banks: ParallelBanks
  center: ComplexPoint
  radius: number
}): GeometryResult<{ cuts: readonly BankCut[] }> {
  const invalid = (error: string): GeometryResult<{ cuts: readonly BankCut[] }> => ({
    ok: false,
    error,
  })
  const { banks, radius } = input
  const center = { re: input.center.re, im: input.center.im }
  if (!isValidPoint(center) || !Number.isFinite(radius) || radius <= 0)
    return invalid('避让半径必须是有限正数，奇点坐标必须可绘制。')
  const n = { re: -banks.direction.im, im: banks.direction.re }
  const offset = (center.re - banks.center.re) * n.re + (center.im - banks.center.im) * n.im
  if (Math.abs(offset) > banks.gap / 2)
    return invalid('孤立奇点须位于两岸之间；移出通道请取消联动避让后重新构造。')
  const cuts: BankCut[] = []
  for (const bank of ['entry', 'exit'] as const) {
    const edge = banks[bank]
    const dx = edge.end.re - edge.start.re,
      dy = edge.end.im - edge.start.im
    const length = Math.hypot(dx, dy)
    if (!Number.isFinite(length) || length <= 0)
      return invalid('父绕行的岸线已消失或退化，请先取消相关两岸避让。')
    const u = { re: dx / length, im: dy / length }
    const along = (center.re - edge.start.re) * u.re + (center.im - edge.start.im) * u.im
    const h = (center.re - edge.start.re) * n.re + (center.im - edge.start.im) * n.im
    if (!Number.isFinite(along) || !Number.isFinite(h) || along <= 0 || along >= length)
      return invalid('孤立奇点不在两条有限岸线共同的通道范围内。')
    const distance = Math.abs(h)
    // The projection subtracts world coordinates before taking a local dot
    // product. Budget both errors so rotating/translating a true tangency does
    // not turn it into a near-zero arc. No fixed mathematical-length epsilon:
    // resolvable crossings must survive even for very small scenes.
    const contactRoundoff =
      16 *
      Number.EPSILON *
      Math.max(
        radius,
        length,
        Math.abs(center.re),
        Math.abs(center.im),
        Math.abs(edge.start.re),
        Math.abs(edge.start.im),
        Math.abs(edge.end.re),
        Math.abs(edge.end.im),
      )
    if (radius - distance <= contactRoundoff) continue
    const a = radius * Math.sqrt((1 - distance / radius) * (1 + distance / radius))
    const startT = (along - a) / length,
      endT = (along + a) / length
    if (startT <= 1e-9 || endT >= 1 - 1e-9)
      return invalid('避让圆侵入通道端部或源接入口，请减小半径或移动奇点。')
    const base = { re: center.re - h * n.re, im: center.im - h * n.im }
    const start = { re: base.re - a * u.re, im: base.im - a * u.im }
    const end = { re: base.re + a * u.re, im: base.im + a * u.im }
    const through = {
      re: center.re + edge.outward * radius * n.re,
      im: center.im + edge.outward * radius * n.im,
    }
    const fit = arcThrough(start, end, through)
    if (!fit.ok) return invalid(fit.error)
    const ulp =
      Number.EPSILON *
      Math.max(...[start, end, center].flatMap((p) => [Math.abs(p.re), Math.abs(p.im)]))
    if (
      Math.hypot(fit.arc.center.re - center.re, fit.arc.center.im - center.im) >
        1e-9 * radius + 8 * ulp ||
      Math.abs(fit.arc.radius - radius) > 1e-9 * radius + 8 * ulp
    )
      return invalid('两岸圆弧在当前精度下无法保持指定圆心和半径。')
    cuts.push({
      bank,
      startT,
      endT,
      start,
      end,
      through,
      arc: { ...fit.arc, center: { ...center }, radius },
    })
  }
  return { ok: true, value: { cuts } }
}
