import { arcExtrema, arcThrough, pointOnArc } from '../../../lib/arc'
import { toSvg, type SvgPoint } from '../../../lib/geometry'
import { renderMath } from '../../../lib/math'
import type { MathRenderer } from '../../../lib/mathRenderingScope'
import {
  defaultLabel,
  defaultPointStyle,
  type LabelSettings,
  type SelectionItem,
} from '../appearance'
import type { ContourState, PathSegment } from '../model'
import { activeSegments } from '../pathTopology'
import {
  findSegment,
  findResolvedSegment,
  resolvedScene,
  logicalSegmentId,
} from '../scene/sceneObjects'
import type { ResolvedScene } from '../scene/resolvedScene'
import { buildSceneGeometry } from '../scene/pathGeometry'

interface BoundsContext {
  scene: ResolvedScene
  arrows: ReadonlyMap<string, SelectionRect>
}

function boundsContext(state: ContourState): BoundsContext {
  const scene = resolvedScene(state)
  const geometry = buildSceneGeometry(scene, state)
  return {
    scene,
    arrows: new Map(
      geometry.segments.flatMap((s) => (s.arrow ? [[s.segment.id, s.arrow.bounds] as const] : [])),
    ),
  }
}

export interface SelectionRect {
  left: number
  top: number
  right: number
  bottom: number
}
export function rectangle(a: SvgPoint, b: SvgPoint): SelectionRect {
  return {
    left: Math.min(a.x, b.x),
    right: Math.max(a.x, b.x),
    top: Math.min(a.y, b.y),
    bottom: Math.max(a.y, b.y),
  }
}
function union(bounds: SelectionRect[]): SelectionRect | null {
  return bounds.length
    ? {
        left: Math.min(...bounds.map((b) => b.left)),
        right: Math.max(...bounds.map((b) => b.right)),
        top: Math.min(...bounds.map((b) => b.top)),
        bottom: Math.max(...bounds.map((b) => b.bottom)),
      }
    : null
}
function labelBounds(
  point: SvgPoint,
  label: LabelSettings | undefined,
  mathRenderer: MathRenderer,
): SelectionRect | null {
  if (!label?.visible || !label.tex.trim()) return null
  const math = mathRenderer(label.tex)
  return {
    left: point.x + label.dx,
    top: point.y + label.dy,
    right: point.x + label.dx + Math.max(10, (math.width * label.size) / 16),
    bottom: point.y + label.dy + Math.max(10, (math.height * label.size) / 16),
  }
}
function segmentBounds(state: ContourState, segment: PathSegment, scene: ResolvedScene) {
  const start = scene.points.get(segment.startId)!
  const end = scene.points.get(segment.endId)!
  let points = [toSvg(start, state.viewport), toSvg(end, state.viewport)]
  let middle = { x: points[0].x / 2 + points[1].x / 2, y: points[0].y / 2 + points[1].y / 2 }
  if (segment.kind === 'arc') {
    const result = arcThrough(start, end, segment.through)
    if (result.ok) {
      points = arcExtrema(result.arc).map((p) => toSvg(p, state.viewport))
      middle = toSvg(pointOnArc(result.arc, 0.5), state.viewport)
    }
  }
  const pad = (segment.style?.width ?? state.appearance.stroke.width) / 2
  const bounds = {
    left: Math.min(...points.map((p) => p.x)) - pad,
    right: Math.max(...points.map((p) => p.x)) + pad,
    top: Math.min(...points.map((p) => p.y)) - pad,
    bottom: Math.max(...points.map((p) => p.y)) + pad,
  }
  return { bounds, anchor: middle }
}

function segmentChain(state: ContourState, id: string, scene: ResolvedScene) {
  const logicalId = logicalSegmentId(state, id)
  const parts = scene.partChains?.get(logicalId)
  // A parent's traversal chain also contains independently editable child arcs.
  // Its selection includes only fragments actually owned by that logical part.
  return parts
    ? parts.filter((segment) => logicalSegmentId(state, segment.id) === logicalId)
    : (scene.chains.get(id) ??
        [...scene.contourSegments, ...scene.connectionSegments].filter((s) => s.id === id))
}

export function itemAnchor(
  state: ContourState,
  item: SelectionItem,
  scene: ResolvedScene = resolvedScene(state),
): SvgPoint | null {
  if (item.kind === 'contour') return null
  if (item.kind === 'segment') {
    const label = scene.labels.find((l) => l.target.id === item.id)
    if (label) return toSvg(label.anchor, state.viewport)
    const segment = findResolvedSegment(state, item.id) ?? findSegment(state, item.id)
    if (segment) return segmentBounds(state, segment, scene).anchor
    const bounds = union(
      segmentChain(state, item.id, scene).map((s) => segmentBounds(state, s, scene).bounds),
    )
    return bounds
      ? { x: bounds.left / 2 + bounds.right / 2, y: bounds.top / 2 + bounds.bottom / 2 }
      : null
  }
  const object = (
    item.kind === 'vertex'
      ? state.vertices
      : item.kind === 'marker'
        ? state.markers
        : state.formulas
  ).find((p) => p.id === item.id)
  return object ? toSvg(object, state.viewport) : null
}

function itemBounds(
  state: ContourState,
  item: SelectionItem,
  includeLabels: boolean,
  mathRenderer: MathRenderer = renderMath,
  context: BoundsContext = boundsContext(state),
): SelectionRect | null {
  if (item.kind === 'contour') {
    const members: SelectionItem[] = [
      ...state.vertices.map((v): SelectionItem => ({ kind: 'vertex', id: v.id })),
      ...activeSegments(state).map((s): SelectionItem => ({ kind: 'segment', id: s.id })),
    ]
    return union(
      members
        .map((member) => itemBounds(state, member, includeLabels, mathRenderer, context))
        .filter((b): b is SelectionRect => b !== null),
    )
  }
  if (item.kind === 'segment') {
    const { scene } = context
    const chain = segmentChain(state, item.id, scene)
    const hiddenSource = !chain.length ? findSegment(state, item.id) : undefined
    const geometry = union(
      (hiddenSource ? [hiddenSource] : chain).flatMap((s) => {
        const arrow = context.arrows.get(s.id)
        return [segmentBounds(state, s, scene).bounds, ...(arrow ? [arrow] : [])]
      }),
    )
    const labels = scene.labels.filter(
      (l) =>
        l.target.id === item.id ||
        (item.part !== 'label' &&
          includeLabels &&
          chain.some((s) => logicalSegmentId(state, s.id) === l.target.id)),
    )
    const text = union(
      labels
        .map((l) => labelBounds(toSvg(l.anchor, state.viewport), l.value, mathRenderer))
        .filter((b): b is SelectionRect => b !== null),
    )
    return item.part === 'label'
      ? text
      : union(
          [geometry, ...(includeLabels ? [text] : [])].filter(
            (b): b is SelectionRect => b !== null,
          ),
        )
  }
  const index = (
    item.kind === 'vertex'
      ? state.vertices
      : item.kind === 'marker'
        ? state.markers
        : state.formulas
  ).findIndex((p) => p.id === item.id)
  if (index < 0) return null
  const object = (
    item.kind === 'vertex'
      ? state.vertices
      : item.kind === 'marker'
        ? state.markers
        : state.formulas
  )[index]
  const p = toSvg(object, state.viewport)
  const label = labelBounds(p, object.label ?? defaultLabel(`z_{${index + 1}}`), mathRenderer)
  if (item.kind === 'formula' || item.part === 'label') return label
  const radius = object.pointStyle?.radius ?? defaultPointStyle().radius
  const bounds = {
    left: p.x - radius,
    right: p.x + radius,
    top: p.y - radius,
    bottom: p.y + radius,
  }
  return includeLabels && label ? union([bounds, label]) : bounds
}

export function itemsWithinRect(state: ContourState, rect: SelectionRect): SelectionItem[] {
  const context = boundsContext(state),
    { scene } = context
  const candidates: SelectionItem[] = [
    ...state.vertices
      .filter((v) => state.handles || (v.mathematicalKind ?? 'ordinary') !== 'ordinary')
      .map((v): SelectionItem => ({ kind: 'vertex', id: v.id })),
    ...[
      ...new Set(
        [...scene.contourSegments, ...scene.connectionSegments].map((s) =>
          logicalSegmentId(state, s.id),
        ),
      ),
    ].map((id): SelectionItem => ({
      kind: 'segment',
      id,
    })),
    ...state.markers.map((m): SelectionItem => ({ kind: 'marker', id: m.id })),
    ...state.formulas.map((f): SelectionItem => ({ kind: 'formula', id: f.id })),
  ]
  const contains = (item: SelectionItem) => {
    const b = itemBounds(state, item, false, renderMath, context)
    return (
      b &&
      b.left >= rect.left - 1e-6 &&
      b.right <= rect.right + 1e-6 &&
      b.top >= rect.top - 1e-6 &&
      b.bottom <= rect.bottom + 1e-6
    )
  }
  const selected = candidates.filter(contains)
  const labels: SelectionItem[] = [
    ...state.vertices.map((v): SelectionItem => ({ kind: 'vertex', id: v.id, part: 'label' })),
    ...scene.labels.map((l): SelectionItem => l.target),
    ...state.markers.map((m): SelectionItem => ({ kind: 'marker', id: m.id, part: 'label' })),
  ]
  return [
    ...selected,
    ...labels.filter(
      (label) =>
        label.kind !== 'contour' &&
        !selected.some((owner) => owner.kind === label.kind && owner.id === label.id) &&
        contains(label),
    ),
  ]
}

export function selectionBounds(
  state: ContourState,
  items: SelectionItem[],
  mathRenderer: MathRenderer = renderMath,
): SelectionRect | null {
  const context = boundsContext(state)
  return union(
    items
      .map((item) => itemBounds(state, item, true, mathRenderer, context))
      .filter((b): b is SelectionRect => b !== null),
  )
}
