import { arcExtrema, arcThrough, pointOnArc } from './arc'
import type { AvoidanceGeometry } from './avoidanceGeometry'
import { edgeArcFrame } from './edgeArcFrame'
import { isValidPoint, type ComplexPoint } from './geometry'
import type { GeometricEdge } from './geometryIntersections'

export type GeometryResult<T> = { ok: true; value: T } | { ok: false; error: string }
export type SourceAnchor =
  | { kind: 'segment'; segmentId: string; t: number }
  | { kind: 'vertex'; vertexId: string; segmentId: string }
export interface DirectedSourceEdge {
  id: string
  startId: string
  endId: string
  edge: GeometricEdge
}
export interface SourceChain {
  edges: readonly DirectedSourceEdge[]
  cyclic: boolean
}
export interface SourceInterval {
  sourceSegmentId: string
  startT: number
  endT: number
}
export type DetourGeometry = Pick<
  AvoidanceGeometry,
  'entryBase' | 'entry' | 'exit' | 'exitBase' | 'through' | 'arc'
>
export interface BankEdge {
  start: ComplexPoint
  end: ComplexPoint
  outward: -1 | 1
}
export interface ParallelBanks {
  center: ComplexPoint
  direction: ComplexPoint
  gap: number
  entry: BankEdge
  exit: BankEdge
}
export interface ConnectedGeometry {
  geometry: DetourGeometry
  trims: readonly SourceInterval[]
  banks: ParallelBanks
}

const EPS = 1e-9
const TAU = 2 * Math.PI
const positive = (v: number) => ((v % TAU) + TAU) % TAU

export function sourceAnchorParameter(anchor: SourceAnchor, edge: DirectedSourceEdge): number {
  if (anchor.segmentId !== edge.id) return NaN
  return anchor.kind === 'segment'
    ? anchor.t
    : anchor.vertexId === edge.startId
      ? 0
      : anchor.vertexId === edge.endId
        ? 1
        : NaN
}

export function edgePointAt(edge: GeometricEdge, t: number): ComplexPoint {
  if (t === 0) return edge.start
  if (t === 1) return edge.end
  if (edge.kind === 'line')
    return {
      re: (1 - t) * edge.start.re + t * edge.end.re,
      im: (1 - t) * edge.start.im + t * edge.end.im,
    }
  const { origin, scale, arc } = edgeArcFrame(edge)
  const p = pointOnArc(arc, origin === edge.start ? t : 1 - t)
  return { re: origin.re + p.re * scale, im: origin.im + p.im * scale }
}

export function edgeParameter(edge: GeometricEdge, point: ComplexPoint): number {
  if (edge.kind === 'line') {
    const dx = edge.end.re - edge.start.re,
      dy = edge.end.im - edge.start.im
    const length = Math.hypot(dx, dy)
    return (
      ((point.re - edge.start.re) / length) * (dx / length) +
      ((point.im - edge.start.im) / length) * (dy / length)
    )
  }
  const { origin, scale, arc } = edgeArcFrame(edge)
  const angle = Math.atan2(
    (point.im - origin.im) / scale - arc.center.im,
    (point.re - origin.re) / scale - arc.center.re,
  )
  const reversed = origin !== edge.start
  const sweep = reversed ? -arc.sweep : arc.sweep
  const start = arc.startAngle + (reversed ? arc.sweep : 0)
  if (Math.hypot(point.re - edge.start.re, point.im - edge.start.im) <= EPS * scale) return 0
  if (Math.hypot(point.re - edge.end.re, point.im - edge.end.im) <= EPS * scale) return 1
  return positive(Math.sign(sweep) * (angle - start)) / Math.abs(sweep)
}

type Hit = { index: number; t: number; x: number; sign: -1 | 1; unsafe?: boolean }

/** Geometry is solved in a pole-centred, radius-sized frame; no global tolerances change. */
export function buildConnectedAvoidance(input: {
  source: SourceChain
  anchor: SourceAnchor
  center: ComplexPoint
  radius: number
  gap: number
}): GeometryResult<ConnectedGeometry> {
  const invalid = (error: string): GeometryResult<ConnectedGeometry> => ({ ok: false, error })
  try {
    const { source, anchor, radius, gap } = input
    const center = { re: input.center.re, im: input.center.im }
    if (
      !isValidPoint(center) ||
      !Number.isFinite(radius) ||
      radius <= 0 ||
      !Number.isFinite(gap) ||
      gap <= 0 ||
      gap / radius >= 2
    )
      return invalid('半径和两岸间距须为有限正数，且两岸间距必须小于直径。')
    const size = source.edges.length
    const ai = source.edges.findIndex((s) => s.id === anchor.segmentId)
    if (ai < 0) return invalid('接入位置的源路径不存在。')
    const anchored = source.edges[ai]
    const at = sourceAnchorParameter(anchor, anchored)
    if (!Number.isFinite(at) || at < 0 || at > 1) return invalid('接入位置必须位于真实源路径上。')
    const p = edgePointAt(anchored.edge, at)
    const distance = Math.hypot(p.re - center.re, p.im - center.im)
    if (!Number.isFinite(distance) || distance === 0)
      return invalid('接入位置不能与奇点重合，请使用局部绕行或调整位置。')
    const d = { re: (p.re - center.re) / distance, im: (p.im - center.im) / distance }
    const n = { re: -d.im, im: d.re }
    const local = (v: ComplexPoint): ComplexPoint => {
      const x = (v.re - center.re) / radius,
        y = (v.im - center.im) / radius
      const result = { re: x * d.re + y * d.im, im: x * n.re + y * n.im }
      if (!isValidPoint(result)) throw new Error('源路径与半径的数值尺度无法稳定解析。')
      return result
    }
    const world = (x: number, y: number): ComplexPoint => ({
      re: center.re + radius * (x * d.re + y * n.re),
      im: center.im + radius * (x * d.im + y * n.im),
    })
    const edges = source.edges.map(({ edge }): GeometricEdge => ({
      ...edge,
      start: local(edge.start),
      end: local(edge.end),
      ...(edge.kind === 'arc' ? { through: local(edge.through) } : {}),
    }))
    const b = gap / radius / 2,
      k = Math.sqrt((1 - b) * (1 + b))
    if (b <= 32 * Number.EPSILON * Math.max(1, distance / radius))
      return invalid('两岸间距在当前数值尺度下无法可靠区分。')
    const hits: Hit[] = []
    for (const sign of [-1, 1] as const) {
      const bankHits: Hit[] = []
      edges.forEach((edge, index) => {
        let points: (ComplexPoint & { unsafe?: boolean })[] = []
        if (edge.kind === 'line') {
          const dy = edge.end.im - edge.start.im
          if (Math.abs(dy) <= EPS * Math.hypot(edge.end.re - edge.start.re, dy)) {
            if (Math.abs(edge.start.im - sign * b) <= EPS) {
              const lo = Math.min(edge.start.re, edge.end.re),
                hi = Math.max(edge.start.re, edge.end.re)
              if (hi > k + EPS)
                points = [
                  { re: Math.max(lo, Math.min(hi, k + 2 * EPS)), im: sign * b, unsafe: true },
                ]
            }
          } else {
            const t = (sign * b - edge.start.im) / dy
            if (t >= -EPS && t <= 1 + EPS) points = [edgePointAt(edge, Math.max(0, Math.min(1, t)))]
          }
        } else {
          const { origin, scale, arc } = edgeArcFrame(edge)
          const cx = origin.re + arc.center.re * scale,
            cy = origin.im + arc.center.im * scale
          const r = arc.radius * scale,
            h = Math.abs(sign * b - cy)
          if (h <= r) {
            const a = Math.sqrt((r - h) * (r + h))
            points =
              a <= EPS * r
                ? [{ re: cx, im: sign * b, unsafe: true }]
                : [
                    { re: cx - a, im: sign * b },
                    { re: cx + a, im: sign * b },
                  ]
          }
        }
        for (const point of points) {
          let t = edgeParameter(edge, point)
          if (t < -EPS || t > 1 + EPS || point.re <= k + EPS) continue
          let i = index
          t = Math.max(0, Math.min(1, t))
          if (t >= 1 - EPS && (index + 1 < size || source.cyclic)) {
            i = (index + 1) % size
            t = 0
          }
          const existing = bankHits.find((hit) => hit.index === i && Math.abs(hit.t - t) <= EPS)
          if (existing) existing.unsafe ||= point.unsafe
          else bankHits.push({ index: i, t, x: point.re, sign, unsafe: point.unsafe })
        }
      })
      bankHits.sort((a, c) => a.x - c.x)
      if (!bankHits.length)
        return invalid('两岸必须分别与所选有限源路径相交，请调整接入位置、半径或间距。')
      if (bankHits[0].unsafe) return invalid('连接口与源路径相切、重合或过于接近，请调整接入位置。')
      if (bankHits.length > 1 && bankHits[1].x - bankHits[0].x <= EPS)
        return invalid('连接口存在歧义，请调整接入位置。')
      hits.push(bankHits[0])
    }
    const anchorPosition = (ai + at) % size
    let entry: Hit | undefined,
      exit: Hit | undefined,
      finish = 0
    for (const [a, c] of [
      [hits[0], hits[1]],
      [hits[1], hits[0]],
    ]) {
      const start = a.index + a.t
      let end = c.index + c.t,
        pos = anchorPosition
      if (source.cyclic) {
        if (end <= start) end += size
        if (pos < start) pos += size
      }
      if (
        end > start + EPS &&
        (!source.cyclic || end - start < size - EPS) &&
        pos > start + EPS &&
        pos < end - EPS
      ) {
        entry = a
        exit = c
        finish = end
        break
      }
    }
    if (!entry || !exit) return invalid('无法在同一有向源路径上确定包含接入位置的局部区间。')
    const trims: SourceInterval[] = []
    for (let i = entry.index; i < Math.ceil(finish); i++) {
      const index = i % size,
        edge = edges[index]
      const from = i === entry.index ? entry.t : 0,
        to = Math.min(1, finish - i)
      if (to - from <= EPS) continue
      const probes = [edgePointAt(edge, from), edgePointAt(edge, to)]
      if (edge.kind === 'arc') {
        const { origin, scale, arc } = edgeArcFrame(edge)
        probes.push(
          ...arcExtrema(arc)
            .map((v) => ({ re: origin.re + v.re * scale, im: origin.im + v.im * scale }))
            .filter((v) => {
              const t = edgeParameter(edge, v)
              return t >= from && t <= to
            }),
        )
      }
      if (probes.some((v) => Math.abs(v.im) > b + EPS || v.re <= k + EPS))
        return invalid('接入区间离开两岸通道或侵入避让圆，请调整接入位置。')
      trims.push({ sourceSegmentId: source.edges[index].id, startT: from, endT: to })
    }
    const entryBase = world(entry.x, entry.sign * b),
      entryPoint = world(k, entry.sign * b)
    const exitPoint = world(k, exit.sign * b),
      exitBase = world(exit.x, exit.sign * b)
    const through = world(-1, 0)
    const fitted = arcThrough(entryPoint, exitPoint, through)
    if (!fitted.ok) return invalid(fitted.error)
    const ulp =
      Number.EPSILON *
      Math.max(...[entryPoint, exitPoint, center].flatMap((v) => [Math.abs(v.re), Math.abs(v.im)]))
    if (
      Math.hypot(fitted.arc.center.re - center.re, fitted.arc.center.im - center.im) >
        EPS * radius + 8 * ulp ||
      Math.abs(fitted.arc.radius - radius) > EPS * radius + 8 * ulp
    )
      return invalid('无法可靠保持绕行圆心和半径。')
    return {
      ok: true,
      value: {
        geometry: {
          entryBase,
          entry: entryPoint,
          exit: exitPoint,
          exitBase,
          through,
          arc: { ...fitted.arc, center: { ...center }, radius },
        },
        trims,
        banks: {
          center: { ...center },
          direction: d,
          gap,
          entry: { start: entryBase, end: entryPoint, outward: entry.sign },
          exit: { start: exitPoint, end: exitBase, outward: exit.sign },
        },
      },
    }
  } catch (error) {
    return invalid(`连接绕行无法可靠构造：${error instanceof Error ? error.message : '数值无效。'}`)
  }
}
