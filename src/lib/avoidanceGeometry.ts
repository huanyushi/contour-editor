import { arcThrough, type CircularArc } from './arc'
import { isValidPoint, type ComplexPoint } from './geometry'

export interface AvoidanceInput {
  start: ComplexPoint
  end: ComplexPoint
  center: ComplexPoint
  radius: number
  side: 'left' | 'right'
  openingRatio: number
}

export interface AvoidanceGeometry {
  entryBase: ComplexPoint
  entry: ComplexPoint
  exit: ComplexPoint
  exitBase: ComplexPoint
  through: ComplexPoint
  arc: CircularArc
  signedDistance: number
  preferredOpeningWidth: number
  actualOpeningWidth: number
  footprint: readonly [number, number]
  onLine: boolean
}

export type AvoidanceResult =
  { ok: true; geometry: AvoidanceGeometry } | { ok: false; error: string }

const EPSILON = 1e-9

// Error-free tails retain small pole offsets lost in baseline-sized subtraction
// and product cancellation. All products below use power-of-two-scaled operands.
function differenceTail(a: number, b: number, difference: number): number {
  const virtualB = a - difference
  return a - (difference + virtualB) + (virtualB - b)
}

function productTail(a: number, b: number, product: number): number {
  const splitA = 134217729 * a
  const highA = splitA - (splitA - a)
  const lowA = a - highA
  const splitB = 134217729 * b
  const highB = splitB - (splitB - b)
  const lowB = b - highB
  return highA * highB - product + highA * lowB + lowA * highB + lowA * lowB
}

export function buildAvoidance(input: AvoidanceInput): AvoidanceResult {
  const invalid = (error: string): AvoidanceResult => ({ ok: false, error })
  const { start, end, center, radius, side, openingRatio } = input
  if (![start, end, center].every(isValidPoint)) return invalid('绕行坐标必须是可绘制的有限数值。')
  if (!Number.isFinite(radius) || radius <= 0) return invalid('绕行半径必须是有限正数。')
  if (!Number.isFinite(openingRatio) || openingRatio <= 0 || openingRatio > 1)
    return invalid('偏好开口比例必须大于 0 且不超过 1。')
  if (side !== 'left' && side !== 'right') return invalid('绕行方向必须为左侧或右侧。')

  const dx = end.re - start.re
  const dy = end.im - start.im
  const cx = center.re - start.re
  const cy = center.im - start.im
  const span = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(cx), Math.abs(cy), radius)
  if (!Number.isFinite(span)) return invalid('绕行坐标跨度过大，无法稳定计算。')
  // Binary scaling preserves the exact operands used by the compensated determinant.
  const scale = 2 ** Math.floor(Math.log2(span))
  // Source-boundary decisions use the baseline scale; detour classification below
  // uses its own radius so extending the source cannot change the construction.
  const ux = dx / scale
  const uy = dy / scale
  const vx = cx / scale
  const vy = cy / scale
  const length = Math.hypot(ux, uy)
  if (length === 0) return invalid('绕行源线段的两个端点不能重合。')
  const t = { re: dx / scale / length, im: dy / scale / length }
  const n = { re: -t.im, im: t.re }
  const s = (cx / scale) * t.re + (cy / scale) * t.im
  const uxt = differenceTail(end.re, start.re, dx) / scale
  const uyt = differenceTail(end.im, start.im, dy) / scale
  const vxt = differenceTail(center.re, start.re, cx) / scale
  const vyt = differenceTail(center.im, start.im, cy) / scale
  const left = ux * vy
  const right = uy * vx
  const correction =
    productTail(ux, vy, left) -
    productTail(uy, vx, right) +
    ux * vyt +
    uxt * vy -
    uy * vxt -
    uyt * vx +
    uxt * vyt -
    uyt * vxt
  const h = (left - right + correction) / length
  const r = radius / scale
  if (s <= EPSILON || length - s <= EPSILON)
    return invalid('奇点在源直线上的投影必须严格位于线段内部。')
  if (s - r <= EPSILON || length - s - r <= EPSILON)
    return invalid('绕行的完整半径占用范围必须严格位于源线段内部。')

  // Construct in radius units, independently of the source length. In particular,
  // squaring a baseline-normalized radius could underflow for a resolvable detour.
  const distance = h / r
  if (!Number.isFinite(distance)) return invalid('绕行半径与奇点距离无法稳定解析。')
  const onLine = Math.abs(distance) <= EPSILON
  const preferred = 2 * openingRatio
  const minimum =
    Math.abs(distance) < 1 ? 2 * Math.sqrt((1 - Math.abs(distance)) * (1 + Math.abs(distance))) : 0
  const width = onLine ? 2 : Math.max(preferred, minimum)
  const half = width / 2
  const radicand = (1 - half) * (1 + half)
  // Only a roundoff-sized negative radicand may be clamped.
  if (radicand < -EPSILON) return invalid('绕行开口宽度超出圆的直径。')
  const inset = Math.sqrt(Math.max(0, radicand))
  if (!onLine && inset - Math.abs(distance) > EPSILON) return invalid('绕行连接段长度无效。')
  const direction = onLine ? (side === 'left' ? 1 : -1) : Math.sign(distance)
  const offset = (along: number, normal: number): ComplexPoint => ({
    re: center.re + (along * t.re + normal * n.re) * radius,
    im: center.im + (along * t.im + normal * n.im) * radius,
  })
  const entryBase = offset(-half, -distance)
  const exitBase = offset(half, -distance)
  // At the minimum opening the connectors vanish exactly. Reuse the joints rather
  // than letting square-root roundoff create a negative or microscopic connector.
  const atMinimum = !onLine && (minimum >= preferred || inset >= Math.abs(distance))
  const entry = atMinimum ? entryBase : offset(-half, -direction * inset)
  const exit = atMinimum ? exitBase : offset(half, -direction * inset)
  const through = offset(0, direction)
  const result = arcThrough(entry, exit, through)
  if (!result.ok) return invalid(result.error)
  const arc = result.arc
  if (
    Math.hypot((arc.center.re - center.re) / scale, (arc.center.im - center.im) / scale) >
      EPSILON * r ||
    Math.abs(arc.radius / scale - r) > EPSILON * r
  )
    return invalid('绕行圆弧无法稳定保持以奇点为圆心。')

  return {
    ok: true,
    geometry: {
      entryBase,
      entry,
      exit,
      exitBase,
      through,
      // arcThrough validates the actual world-space points first. Preserve the
      // exact pole center even for near-line classification and roundoff in its fit.
      arc: {
        ...arc,
        center: { ...center },
        radius,
        startAngle: Math.atan2(entry.im - center.im, entry.re - center.re),
      },
      signedDistance: h * scale,
      preferredOpeningWidth: preferred * radius,
      actualOpeningWidth: width * radius,
      footprint: [(s - r) * scale, (s + r) * scale],
      onLine,
    },
  }
}
