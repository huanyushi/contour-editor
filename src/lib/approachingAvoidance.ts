import { arcThrough } from './arc'
import {
  buildConnectedAvoidance,
  edgeParameter,
  edgePointAt,
  sourceAnchorParameter,
  type GeometryResult,
  type SourceAnchor,
  type SourceChain,
  type DetourGeometry,
  type SourceInterval,
  type ParallelBanks,
} from './connectedAvoidanceGeometry'
import { edgeArcFrame } from './edgeArcFrame'
import type { ComplexPoint } from './geometry'
import { intersectEdges, type GeometricEdge } from './geometryIntersections'
import { nearestPathPoint } from './pathSnap'

export interface ApproachingGeometry {
  geometry: DetourGeometry
  trims: readonly SourceInterval[]
  banks?: ParallelBanks
}
const EPS = 1e-9
const TAU = 2 * Math.PI
const positive = (x: number) => ((x % TAU) + TAU) % TAU

/** Boundary of the union of a pole disk and its parallel, outward corridor.
 * A source contact may lie on a bank or on the disk; this includes mixed joins. */
export function buildApproachingAvoidance(input: {
  source: SourceChain
  anchor: SourceAnchor
  center: ComplexPoint
  radius: number
  gap: number
  direction: ComplexPoint
}): GeometryResult<ApproachingGeometry> {
  const strict = buildConnectedAvoidance(input)
  const attached = input.source.edges.find((s) => s.id === input.anchor.segmentId)
  const nearest =
    attached && nearestPathPoint(attached.edge, input.center, { a: 1, b: 0, c: 0, d: 1 })
  if (!nearest || nearest.distance > input.radius * (1 + EPS)) return strict
  const invalid = (error: string): GeometryResult<ApproachingGeometry> => ({ ok: false, error })
  try {
    const { source, radius, gap } = input
    const center = { re: input.center.re, im: input.center.im }
    const length = Math.hypot(input.direction.re, input.direction.im)
    if (!(
      radius > 0 &&
      Number.isFinite(radius) &&
      gap > 0 &&
      gap < 2 * radius &&
      Number.isFinite(length) &&
      length > 0
    ))
      return strict
    const d = { re: input.direction.re / length, im: input.direction.im / length }
    const n = { re: -d.im, im: d.re }
    const local = (p: ComplexPoint): ComplexPoint => {
      const x = (p.re - center.re) / radius,
        y = (p.im - center.im) / radius
      return { re: x * d.re + y * d.im, im: x * n.re + y * n.im }
    }
    const world = (p: ComplexPoint): ComplexPoint => ({
      re: center.re + radius * (p.re * d.re + p.im * n.re),
      im: center.im + radius * (p.re * d.im + p.im * n.im),
    })
    const b = gap / radius / 2,
      k = Math.sqrt((1 - b) * (1 + b))
    const edges: GeometricEdge[] = source.edges.map(({ edge }) => ({
      ...edge,
      start: local(edge.start),
      end: local(edge.end),
      ...(edge.kind === 'arc' ? { through: local(edge.through) } : {}),
    }))
    const count = edges.length
    const anchorIndex = source.edges.findIndex((s) => s.id === input.anchor.segmentId)
    if (anchorIndex < 0) return invalid('接入源路径不存在。')
    const t = sourceAnchorParameter(input.anchor, source.edges[anchorIndex])
    if (!Number.isFinite(t) || t < 0 || t > 1)
      return invalid('接入锚点必须位于真实源路径的线段或顶点上。')
    const pos = anchorIndex + t
    // Expand only through shared joints that lie in the pole disk. Segment-index
    // distance is not geometric locality (a long remote edge may have index 0).
    const atIndex = (i: number) => ((i % count) + count) % count
    let first = anchorIndex,
      last = anchorIndex
    while (
      (source.cyclic || first > 0) &&
      last - first + 1 < count &&
      Math.hypot(edges[atIndex(first)].start.re, edges[atIndex(first)].start.im) <= 1 + EPS
    )
      first--
    while (
      (source.cyclic || last < count - 1) &&
      last - first + 1 < count &&
      Math.hypot(edges[atIndex(last)].end.re, edges[atIndex(last)].end.im) <= 1 + EPS
    )
      last++
    const localEdges = new Set(
      Array.from({ length: last - first + 1 }, (_, i) => atIndex(first + i)),
    )
    const inside = (p: ComplexPoint) =>
      Math.hypot(p.re, p.im) <= 1 + EPS || (p.re >= k - EPS && Math.abs(p.im) <= b + EPS)
    if (!inside(edgePointAt(edges[anchorIndex], t))) return strict
    type Contact = { pos: number; point: ComplexPoint; bank?: -1 | 1 }
    const contacts: Contact[] = []
    const add = (index: number, point: ComplexPoint, bank?: -1 | 1) => {
      const at = edgeParameter(edges[index], point)
      if (at < -EPS || at > 1 + EPS) return
      let position = index + Math.max(0, Math.min(1, at))
      if (source.cyclic && Math.abs(position - count) <= EPS) position = 0
      if (contacts.some((v) => Math.abs(v.pos - position) < EPS)) return
      contacts.push({ pos: position, point, bank })
    }
    edges.forEach((edge, index) => {
      for (const sign of [-1, 1] as const) {
        if (edge.kind === 'line') {
          const dy = edge.end.im - edge.start.im
          if (Math.abs(dy) <= EPS * Math.hypot(edge.end.re - edge.start.re, dy)) continue
          const at = (sign * b - edge.start.im) / dy
          if (at >= 0 && at <= 1) {
            const point = edgePointAt(edge, at)
            if (point.re >= k - EPS) add(index, point, sign)
          }
        } else {
          const frame = edgeArcFrame(edge)
          const cx = frame.origin.re + frame.scale * frame.arc.center.re
          const cy = frame.origin.im + frame.scale * frame.arc.center.im
          const r = frame.scale * frame.arc.radius
          const h = Math.abs(sign * b - cy)
          if (h < r) {
            const span = Math.sqrt((r - h) * (r + h))
            for (const x of [cx - span, cx + span])
              if (x >= k - EPS) add(index, { re: x, im: sign * b }, sign)
          }
        }
      }
      if (!localEdges.has(index)) return
      for (const sign of [-1, 1]) {
        const result = intersectEdges(edge, {
          kind: 'arc',
          start: { re: -1, im: 0 },
          end: { re: 1, im: 0 },
          through: { re: 0, im: sign },
        })
        if (result.kind === 'overlap') throw new Error('源路径与绕行圆重合，无法确定局部裁剪。')
        if (result.kind === 'points')
          for (const p of result.points) if (p.re <= k + EPS) add(index, p)
      }
    })
    contacts.sort((a, b) => a.pos - b.pos)
    const expanded = source.cyclic
      ? contacts
          .flatMap((c) => [-count, 0, count].map((shift) => ({ ...c, pos: c.pos + shift })))
          .sort((a, b) => a.pos - b.pos)
      : contacts
    let entry = expanded.filter((c) => c.pos < pos - EPS).at(-1)
    let exit = expanded.find((c) => c.pos > pos + EPS)
    // An oblique corridor can first touch the disk outside its narrow opening.
    // Include those disk contacts in the same local trim, avoiding a second
    // tangency or an isolated source sliver between the disk and the opening.
    const disk = expanded.filter((c) => !c.bank && c.pos >= first - EPS && c.pos <= last + 1 + EPS)
    for (const c of disk) {
      if (c.pos < pos - EPS && (!entry || c.pos < entry.pos)) entry = c
      if (c.pos > pos + EPS && (!exit || c.pos > exit.pos)) exit = c
    }
    if (!entry || !exit || (exit.pos - entry.pos >= count - EPS && source.cyclic))
      return invalid('绕行需要同一有限源链上的两个不同裁剪交点。')
    // Only the disk and the bounded bridges to actual bank contacts may be
    // removed. Disk-contained joints do not make a remote major arc local.
    const bridges = [entry, exit]
      .filter((c) => c.bank && Math.hypot(c.point.re, c.point.im) > 1 + EPS)
      .map(({ point }) => {
        const length = Math.hypot(point.re, point.im)
        const u = { re: point.re / length, im: point.im / length }
        const h = Math.sqrt(1 - 1 / (length * length))
        return { point, length, u, h }
      })
    const corridorEnd = Math.max(1, entry.point.re, exit.point.re)
    const inTrim = (p: ComplexPoint) =>
      Math.hypot(p.re, p.im) <= 1 + EPS ||
      (p.re >= k - EPS && p.re <= corridorEnd + EPS && Math.abs(p.im) <= b + EPS) ||
      bridges.some(({ length, u, h }) => {
        const a = p.re * u.re + p.im * u.im
        const cross = p.im * u.re - p.re * u.im
        return (
          a >= 1 / length - EPS &&
          a <= length + EPS &&
          Math.abs(cross) <= (h * (length - a)) / (length - 1 / length) + EPS
        )
      })
    const boundaries: GeometricEdge[] = [-1, 1].map((sign) => ({
      kind: 'arc',
      start: { re: -1, im: 0 },
      end: { re: 1, im: 0 },
      through: { re: 0, im: sign },
    }))
    const corners = [
      { re: k, im: -b },
      { re: corridorEnd, im: -b },
      { re: corridorEnd, im: b },
      { re: k, im: b },
    ]
    corners.forEach((start, i) =>
      boundaries.push({ kind: 'line', start, end: corners[(i + 1) % 4] }),
    )
    for (const { point, length, u, h } of bridges)
      for (const sign of [-1, 1])
        boundaries.push({
          kind: 'line',
          start: point,
          end: { re: u.re / length - sign * h * u.im, im: u.im / length + sign * h * u.re },
        })
    const trims: SourceInterval[] = []
    for (let i = Math.floor(entry.pos); i < Math.ceil(exit.pos); i++) {
      const index = ((i % count) + count) % count
      const from = Math.max(0, entry.pos - i),
        to = Math.min(1, exit.pos - i)
      if (to - from <= EPS) continue
      // Partition at every boundary crossing, then check each whole connected
      // interval by its midpoint. This also catches short excursions on arcs.
      const cuts = [from, to]
      for (const boundary of boundaries) {
        const hits = intersectEdges(edges[index], boundary)
        if (hits.kind === 'points')
          for (const p of hits.points) {
            const at = edgeParameter(edges[index], p)
            if (at > from && at < to) cuts.push(at)
          }
      }
      cuts.sort((a, b) => a - b)
      if (
        !cuts.every(
          (at, j) =>
            inTrim(edgePointAt(edges[index], at)) &&
            (j === 0 || inTrim(edgePointAt(edges[index], (cuts[j - 1] + at) / 2))),
        )
      )
        return invalid('裁剪区间离开绕行圆与通道，请调整接入位置。')
      trims.push({ sourceSegmentId: source.edges[index].id, startT: from, endT: to })
    }
    const a = entry.bank ? { re: k, im: entry.bank * b } : entry.point
    const z = exit.bank ? { re: k, im: exit.bank * b } : exit.point
    const startAngle = Math.atan2(a.im, a.re),
      endAngle = Math.atan2(z.im, z.re)
    let sweep = positive(endAngle - startAngle)
    if (positive(Math.PI - startAngle) > sweep + EPS) sweep -= TAU
    if (Math.abs(sweep) <= EPS || Math.abs(sweep) >= TAU - EPS)
      return invalid('绕行圆弧需要不同的接合点。')
    const through = world({
      re: Math.cos(startAngle + sweep / 2),
      im: Math.sin(startAngle + sweep / 2),
    })
    const entryBase = world(entry.point),
      exitBase = world(exit.point)
    const entryPoint = entry.bank ? world(a) : entryBase
    const exitPoint = exit.bank ? world(z) : exitBase
    const fit = arcThrough(entryPoint, exitPoint, through)
    if (!fit.ok) return invalid(fit.error)
    return {
      ok: true,
      value: {
        trims,
        ...(entry.bank &&
        exit.bank &&
        entry.bank !== exit.bank &&
        Math.hypot(entryBase.re - entryPoint.re, entryBase.im - entryPoint.im) > EPS * radius &&
        Math.hypot(exitBase.re - exitPoint.re, exitBase.im - exitPoint.im) > EPS * radius
          ? {
              banks: {
                center,
                direction: d,
                gap,
                entry: { start: entryBase, end: entryPoint, outward: entry.bank },
                exit: { start: exitPoint, end: exitBase, outward: exit.bank },
              },
            }
          : {}),
        geometry: {
          entryBase,
          entry: entryPoint,
          exit: exitPoint,
          exitBase,
          through,
          arc: { ...fit.arc, center: { ...center }, radius },
        },
      },
    }
  } catch (error) {
    return invalid(error instanceof Error ? error.message : '无法构造边界过渡。')
  }
}
