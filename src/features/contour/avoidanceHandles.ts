import { toSvg, fromSvg, type ComplexPoint } from '../../lib/geometry'
import type { PathScreenMetric } from '../../lib/pathSnap'
import type { ResolvedScene } from './resolvedScene'
import type { AvoidancePart } from './avoidanceTypes'
import type { ContourState } from './model'
import { constructAvoidances } from './avoidanceConstructionTable'
import { editableAvoidance } from './avoidanceParameters'
import type { ParallelBanks } from '../../lib/connectedAvoidanceGeometry'

interface HandleBase {
  key: string
  avoidanceId: string
  part: AvoidancePart
  end: 'entry' | 'exit'
  point: ComplexPoint
  center: ComplexPoint
}
export type AvoidanceHandle = HandleBase &
  (
    | { kind: 'radius' }
    | { kind: 'port'; outward: -1 | 1 }
    | { kind: 'gap'; gap: number; normal: ComplexPoint; angle: number }
  )

/** Radius/port controls stay on real endpoints; only the separate spacing icon is offset. */
export function avoidanceHandles(document: ContourState, scene: ResolvedScene): AvoidanceHandle[] {
  const segments = [...scene.contourSegments, ...scene.connectionSegments]
  const handles: AvoidanceHandle[] = segments.flatMap((segment): AvoidanceHandle[] => {
    const origin = segment.origin
    if (
      origin.kind !== 'avoidance' ||
      !['arc', 'bank-entry', 'bank-exit'].includes(origin.part) ||
      !segment.resolvedArc
    )
      return []
    const common = {
      avoidanceId: origin.avoidanceId,
      part: origin.part,
      center: segment.resolvedArc.center,
      kind: 'radius' as const,
    }
    return [
      {
        ...common,
        key: `${segment.id}:entry`,
        end: 'entry',
        point: scene.points.get(segment.startId)!,
      },
      {
        ...common,
        key: `${segment.id}:exit`,
        end: 'exit',
        point: scene.points.get(segment.endId)!,
      },
    ]
  })
  const table = constructAvoidances(document)
  if (!table.ok) return handles
  const gapParents: { id: string; banks: ParallelBanks }[] = []
  for (const value of document.avoidances) {
    if (editableAvoidance(document, value).kind !== 'corridor') continue
    const banks = table.value.parents.get(value.id)?.bankPair
    if (!banks || !scene.partChains?.get(`avoid:${value.id}:arc`)?.length) continue
    gapParents.push({ id: value.id, banks })
    for (const end of ['entry', 'exit'] as const) {
      const chain = scene.partChains?.get(`avoid:${value.id}:${end}`)
      if (!chain?.length) continue
      const id = end === 'entry' ? chain[0].startId : chain.at(-1)!.endId
      handles.push({
        kind: 'port',
        key: `avoid:${value.id}:port:${end}`,
        avoidanceId: value.id,
        part: end,
        end,
        point: scene.points.get(id)!,
        center: banks.center,
        outward: banks[end].outward,
      })
    }
  }
  for (const { id, banks } of gapParents) {
    const normal = { re: -banks.direction.im, im: banks.direction.re }
    const base = toSvg(
      {
        re:
          (banks.entry.start.re + banks.entry.end.re + banks.exit.start.re + banks.exit.end.re) / 4,
        im:
          (banks.entry.start.im + banks.entry.end.im + banks.exit.start.im + banks.exit.end.im) / 4,
      },
      document.viewport,
    )
    const projected = {
      x: normal.re * document.viewport.scaleX,
      y: -normal.im * document.viewport.scaleY,
    }
    const length = Math.hypot(projected.x, projected.y)
    const n = { x: projected.x / length, y: projected.y / length }
    const obstacles = [
      ...document.vertices,
      ...document.markers,
      ...handles.map((h) => h.point),
    ].map((p) => toSvg(p, document.viewport))
    let position = base
    for (let step = 0; step < 128; step++) {
      const distance = 32 + (banks.gap * length) / 2 + Math.floor(step / 2) * 16
      const side = step % 2 ? -1 : 1
      position = { x: base.x + side * n.x * distance, y: base.y + side * n.y * distance }
      if (obstacles.every((p) => Math.hypot(p.x - position.x, p.y - position.y) >= 28)) break
    }
    handles.push({
      kind: 'gap',
      key: `avoid:${id}:gap`,
      avoidanceId: id,
      part: 'arc',
      end: 'entry',
      center: banks.center,
      point: fromSvg(position, document.viewport),
      gap: banks.gap,
      normal,
      angle: (Math.atan2(n.y, n.x) * 180) / Math.PI,
    })
  }
  return handles
}

type PointTarget = { kind: 'vertex' | 'marker'; id: string; point: ComplexPoint }

/** SVG paint order must not decide which of two close mathematical points moves.
 * Exact ties prefer the selected object, then a real point rather than a derived one. */
export function nearestAvoidanceTarget(
  state: ContourState,
  handles: readonly AvoidanceHandle[],
  point: ComplexPoint,
  metric: PathScreenMetric,
): AvoidanceHandle | PointTarget | null {
  const points: PointTarget[] = [
    ...state.vertices.map((p) => ({ kind: 'vertex' as const, id: p.id, point: p })),
    ...state.markers.map((p) => ({ kind: 'marker' as const, id: p.id, point: p })),
  ]
  const selection = state.selection
  const priority = (target: AvoidanceHandle | PointTarget) => {
    if ('avoidanceId' in target)
      return selection.kind === 'segment' &&
        selection.id === `avoid:${target.avoidanceId}:${target.part}`
        ? 4
        : 0
    return selection.kind === target.kind && 'id' in selection && selection.id === target.id ? 5 : 1
  }
  let best: AvoidanceHandle | PointTarget | null = null
  let bestDistance = Infinity
  for (const target of [...points, ...handles]) {
    const dx = target.point.re - point.re,
      dy = target.point.im - point.im
    const distance = Math.hypot(metric.a * dx + metric.c * dy, metric.b * dx + metric.d * dy)
    if (distance > ('avoidanceId' in target ? 12 : 16)) continue
    if (
      distance < bestDistance - 1e-6 ||
      (Math.abs(distance - bestDistance) <= 1e-6 && (!best || priority(target) > priority(best)))
    ) {
      best = target
      bestDistance = distance
    }
  }
  return best
}
