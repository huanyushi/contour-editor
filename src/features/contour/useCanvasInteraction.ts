import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type PointerEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from 'react'
import { fromSvg, toSvg, type ComplexPoint, type SvgPoint } from '../../lib/geometry'
import { snapToGrid } from '../../lib/snap'
import { nearestPath, type PathScreenMetric } from '../../lib/pathSnap'
import { panViewport, type Viewport } from '../../lib/viewport'
import { LABEL_OFFSET_LIMIT, type LabelSettings, type SelectionItem } from './appearance'
import { createVertex } from './createVertex'
import type { DrawingTool } from './ContourCanvas'
import type { ContourState } from './model'
import type { EditorAction, GestureOwner } from './history'
import { itemsWithinRect, rectangle, type SelectionRect } from './selectionGeometry'
import { translationAnchor } from './selectionTransform'
import { findPoint, scenePoints } from './sceneObjects'
import type { AvoidanceWorkflow } from './useAvoidanceDraft'
import { captureMarkerPath, snapPathGrid, sourceSnapPaths, type SourceSnapPath } from './pathSnap'

type PointKind = 'vertex' | 'through' | 'marker' | 'formula'
type LabelKind = 'vertex' | 'segment' | 'marker'
interface Drag {
  pointerId: number
  kind: PointKind | 'label' | 'pan' | 'marquee' | 'selection' | 'avoidance-radius'
  id: string
  start: SvgPoint
  client: SvgPoint
  offset: ComplexPoint
  view: Viewport
  moved: boolean
  label?: LabelSettings
  labelKind?: LabelKind
  implicitLabel?: boolean
  end?: SvgPoint
  additive?: boolean
  selectionStart?: ContourState
  clickItem?: SelectionItem
  markerPaths?: SourceSnapPath[] | null
  radiusCenter?: ComplexPoint
}
interface Props {
  state: ContourState
  dispatch: Dispatch<EditorAction>
  tool: DrawingTool
  gestureOwner: GestureOwner | null
  svgRef: RefObject<SVGSVGElement | null>
  onArcPoint: (point: ComplexPoint) => void
  onPointerPosition?: (point: ComplexPoint | null) => void
  onInspect?: () => void
  avoidanceWorkflow?: AvoidanceWorkflow
}

export function useCanvasInteraction({
  state,
  dispatch,
  tool,
  gestureOwner,
  svgRef,
  onArcPoint,
  onPointerPosition,
  onInspect,
  avoidanceWorkflow,
}: Props) {
  const drag = useRef<Drag | null>(null)
  const hover = useRef(false)
  const space = useRef(false)
  const [spaceHeld, setSpaceHeld] = useState(false)
  const [panActive, setPanActive] = useState(false)
  const [pointerFocus, setPointerFocus] = useState(false)
  const [marquee, setMarquee] = useState<SelectionRect | null>(null)
  const [modifierHeld, setModifierHeld] = useState(false)
  const pickingTarget = avoidanceWorkflow?.draft.kind === 'pickTarget'

  const svgPoint = useCallback(
    (clientX: number, clientY: number): SvgPoint | null => {
      const svg = svgRef.current,
        matrix = svg?.getScreenCTM()
      if (!svg || !matrix) return null
      const point = svg.createSVGPoint()
      point.x = clientX
      point.y = clientY
      const result = point.matrixTransform(matrix.inverse())
      return { x: result.x, y: result.y }
    },
    [svgRef],
  )

  const finish = useCallback(
    (pointerId?: number, cancelled = false) => {
      const current = drag.current
      if (!current || (pointerId !== undefined && current.pointerId !== pointerId)) return
      drag.current = null
      setPanActive(false)
      setMarquee(null)
      let inspect = current.kind !== 'pan' && current.kind !== 'marquee'
      if (current.kind === 'marquee' && !cancelled) {
        if (!current.moved && current.clickItem) {
          dispatch({ type: 'toggleSelection', item: current.clickItem })
          inspect = true
        } else {
          const items = current.moved
            ? itemsWithinRect(state, rectangle(current.start, current.end ?? current.start))
            : []
          dispatch({ type: 'selectMany', items, additive: current.additive, source: 'marquee' })
          inspect = items.length > 0
        }
      }
      dispatch({ type: 'endGesture', owner: 'canvas' })
      if (svgRef.current?.hasPointerCapture(current.pointerId))
        svgRef.current.releasePointerCapture(current.pointerId)
      if (inspect) onInspect?.()
    },
    [dispatch, svgRef, onInspect, state],
  )

  const cancel = useCallback(() => {
    const current = drag.current
    if (!current) return
    drag.current = null
    setPanActive(false)
    setMarquee(null)
    dispatch({ type: 'cancelGesture', owner: 'canvas' })
    if (svgRef.current?.hasPointerCapture(current.pointerId))
      svgRef.current.releasePointerCapture(current.pointerId)
  }, [dispatch, svgRef])

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const wheel = (event: WheelEvent) => {
      event.preventDefault()
      if (drag.current || gestureOwner !== null) return
      const anchor = svgPoint(event.clientX, event.clientY)
      if (anchor)
        dispatch({
          type: 'zoomView',
          anchor,
          factor: Math.exp(
            -Math.max(-500, Math.min(500, event.deltaY * (event.deltaMode === 1 ? 16 : 1))) * 0.002,
          ),
        })
    }
    const down = (event: KeyboardEvent) => {
      if (event.key === 'Control' || event.key === 'Meta') setModifierHeld(true)
      if (
        event.code !== 'Space' ||
        event.isComposing ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey
      )
        return
      if (
        event.target instanceof Element &&
        event.target.closest('input,textarea,select,button,summary,[contenteditable="true"]')
      )
        return
      if (
        !(hover.current || document.activeElement === svg) ||
        (gestureOwner !== null && drag.current?.kind !== 'pan')
      )
        return
      event.preventDefault()
      space.current = true
      setSpaceHeld(true)
    }
    const up = (event: KeyboardEvent) => {
      if (event.key === 'Control' || event.key === 'Meta') setModifierHeld(false)
      if (event.code === 'Space') {
        space.current = false
        setSpaceHeld(false)
      }
    }
    const blur = () => {
      setModifierHeld(false)
      space.current = false
      setSpaceHeld(false)
      finish(undefined, true)
    }
    svg.addEventListener('wheel', wheel, { passive: false })
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      svg.removeEventListener('wheel', wheel)
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
    }
  }, [dispatch, gestureOwner, svgPoint, svgRef, finish])

  function pathMetric(view = state.viewport): PathScreenMetric {
    const matrix = svgRef.current!.getScreenCTM()!
    return {
      a: view.scaleX * matrix.a,
      b: view.scaleX * matrix.b,
      c: -view.scaleY * matrix.c,
      d: -view.scaleY * matrix.d,
    }
  }

  function snapped(
    point: SvgPoint,
    alt: boolean,
    view = state.viewport,
    offset = { re: 0, im: 0 },
  ) {
    const raw = fromSvg(point, view)
    const matrix = svgRef.current!.getScreenCTM()!
    return snapToGrid(
      { re: raw.re - offset.re, im: raw.im - offset.im },
      {
        x: view.scaleX * Math.hypot(matrix.a, matrix.b),
        y: view.scaleY * Math.hypot(matrix.c, matrix.d),
      },
      state.snap && !alt,
      view,
    )
  }
  function capture(
    event: PointerEvent<SVGElement>,
    kind: Drag['kind'],
    id: string,
    point?: ComplexPoint,
    label?: LabelSettings,
    labelKind?: LabelKind,
  ) {
    event.stopPropagation()
    if (!event.isPrimary || drag.current || gestureOwner !== null) {
      event.preventDefault()
      return
    }
    const start = svgPoint(event.clientX, event.clientY)
    if (!start) return
    event.preventDefault()
    svgRef.current?.focus({ preventScroll: true })
    if (kind === 'vertex') dispatch({ type: 'select', id })
    else if (kind === 'through') dispatch({ type: 'selectSegment', id })
    else if (kind === 'avoidance-radius') dispatch({ type: 'selectSegment', id: `avoid:${id}:arc` })
    else if (kind === 'label' && labelKind)
      dispatch({ type: 'selectObject', selection: { kind: labelKind, id, part: 'label' } })
    else if (kind === 'marker' || kind === 'formula')
      dispatch({ type: 'selectObject', selection: { kind, id } })
    const raw = fromSvg(start, state.viewport)
    drag.current = {
      kind,
      id,
      pointerId: event.pointerId,
      start,
      client: { x: event.clientX, y: event.clientY },
      offset: point ? { re: raw.re - point.re, im: raw.im - point.im } : { re: 0, im: 0 },
      view: state.viewport,
      moved: false,
      additive: event.ctrlKey || event.metaKey,
      label,
      labelKind,
      implicitLabel:
        labelKind === 'vertex' && !state.vertices.find((vertex) => vertex.id === id)?.label,
      selectionStart: kind === 'selection' ? state : undefined,
      markerPaths:
        kind === 'marker' && point
          ? captureMarkerPath(sourceSnapPaths(state, id), point, pathMetric())
          : undefined,
    }
    dispatch({ type: 'beginGesture', owner: 'canvas' })
    if (kind === 'pan') setPanActive(true)
    if (kind === 'marquee') setMarquee(rectangle(start, start))
    svgRef.current?.setPointerCapture(event.pointerId)
  }

  function toggle(event: PointerEvent<SVGElement>, item: SelectionItem): boolean {
    if (!(event.ctrlKey || event.metaKey)) return false
    event.preventDefault()
    event.stopPropagation()
    svgRef.current?.focus({ preventScroll: true })
    dispatch({ type: 'toggleSelection', item })
    onInspect?.()
    return true
  }

  function marqueeClick(event: PointerEvent<SVGElement>, item: SelectionItem) {
    capture(event, 'marquee', '')
    if (drag.current?.kind === 'marquee') drag.current.clickItem = item
  }

  function pointClick(event: PointerEvent<SVGElement>, id: string, kind: 'vertex' | 'marker') {
    event.preventDefault()
    event.stopPropagation()
    svgRef.current?.focus({ preventScroll: true })
    const start = state.selection
    if (
      (start.kind === 'vertex' || start.kind === 'marker') &&
      start.part !== 'label' &&
      start.id !== id
    )
      dispatch({ type: 'connectPoints', startId: start.id, endId: id })
    else dispatch({ type: 'selectObject', selection: { kind, id } })
    onInspect?.()
  }

  function nearby<T extends ComplexPoint>(objects: T[], location: SvgPoint): T | undefined {
    const matrix = svgRef.current?.getScreenCTM()
    if (!matrix) return undefined
    return objects.find((object) => {
      const p = toSvg(object, state.viewport)
      return (
        Math.hypot(
          (p.x - location.x) * Math.hypot(matrix.a, matrix.b),
          (p.y - location.y) * Math.hypot(matrix.c, matrix.d),
        ) <= 8
      )
    })
  }

  return {
    adding: tool !== 'select' && tool !== 'pan',
    panning: tool === 'pan' || spaceHeld || panActive,
    pointerFocus,
    marquee,
    showSelection: !pickingTarget && tool === 'marquee' && state.selectionSource === 'marquee',
    selectionDragEnabled: !modifierHeld,
    radiusHandlesInteractive:
      tool === 'select' && (!avoidanceWorkflow || avoidanceWorkflow.draft.kind === 'idle'),
    beginSelectionDrag: (event: PointerEvent<SVGRectElement>) => {
      if (tool === 'marquee' && event.button === 0 && !event.ctrlKey && !event.metaKey)
        capture(event, 'selection', '', translationAnchor(state))
    },
    deleteSelection: () => dispatch({ type: 'deleteSelection' }),
    clearSelection: () => dispatch({ type: 'clearSelection' }),
    inspectAvoidance: (id: string) => {
      if (gestureOwner !== null || tool !== 'select') return
      dispatch({ type: 'selectSegment', id: `avoid:${id}:arc` })
      onInspect?.()
    },
    beginAvoidanceRadiusDrag: (
      event: PointerEvent<SVGGElement>,
      id: string,
      point: ComplexPoint,
    ) => {
      // Derived endpoints are never targets for point/connection creation tools.
      event.stopPropagation()
      if (
        tool !== 'select' ||
        event.button !== 0 ||
        !event.isPrimary ||
        gestureOwner !== null ||
        (avoidanceWorkflow && avoidanceWorkflow.draft.kind !== 'idle')
      )
        return
      const avoidance = state.avoidances.find((item) => item.id === id)
      const center = avoidance && findPoint(state, avoidance.markerId)
      if (!center) return
      capture(event, 'avoidance-radius', id, point)
      if (drag.current?.kind === 'avoidance-radius')
        drag.current.radiusCenter = { re: center.re, im: center.im }
    },
    selectContour: (event: PointerEvent<SVGPathElement>) => {
      if (event.button !== 0 || !event.isPrimary || gestureOwner !== null) return
      if (pickingTarget) {
        event.preventDefault()
        event.stopPropagation()
        return
      }
      if (tool === 'marquee' && (event.ctrlKey || event.metaKey)) {
        marqueeClick(event, { kind: 'contour' })
        return
      }
      if (tool !== 'select') return
      if (toggle(event, { kind: 'contour' })) return
      event.stopPropagation()
      svgRef.current?.focus({ preventScroll: true })
      dispatch({ type: 'selectObject', selection: { kind: 'contour' } })
      onInspect?.()
    },
    selectSegment: (event: PointerEvent<SVGPathElement>, id: string) => {
      if (event.button !== 0 || !event.isPrimary || gestureOwner !== null) return
      if (pickingTarget) {
        event.preventDefault()
        event.stopPropagation()
        svgRef.current?.focus({ preventScroll: true })
        avoidanceWorkflow.pickTarget(id)
        return
      }
      if (tool === 'marquee' && (event.ctrlKey || event.metaKey)) {
        marqueeClick(event, { kind: 'segment', id })
        return
      }
      if (tool !== 'select' && tool !== 'line') return
      if (toggle(event, { kind: 'segment', id })) return
      event.stopPropagation()
      dispatch({ type: 'selectSegment', id })
      onInspect?.()
    },
    beginDrag: (
      event: PointerEvent<SVGGElement>,
      kind: PointKind,
      id: string,
      point: ComplexPoint,
    ) => {
      if (event.button !== 0 || !event.isPrimary || gestureOwner !== null) return
      if (pickingTarget) {
        event.preventDefault()
        event.stopPropagation()
        return
      }
      if (tool === 'line' && (kind === 'vertex' || kind === 'marker')) {
        pointClick(event, id, kind)
        return
      }
      if (tool === 'marquee' && (event.ctrlKey || event.metaKey)) {
        marqueeClick(event, { kind: kind === 'through' ? 'segment' : kind, id })
        return
      }
      if (
        tool === 'select' &&
        event.button === 0 &&
        event.isPrimary &&
        gestureOwner === null &&
        toggle(event, { kind: kind === 'through' ? 'segment' : kind, id })
      )
        return
      if (
        tool === 'select' ||
        tool === 'add' ||
        (tool === 'marker' && (kind === 'marker' || kind === 'vertex')) ||
        (tool === 'formula' && kind === 'formula')
      )
        capture(event, kind, id, point)
    },
    beginLabelDrag: (
      event: PointerEvent<SVGGElement>,
      kind: LabelKind,
      id: string,
      label: LabelSettings,
    ) => {
      if (pickingTarget) {
        event.preventDefault()
        event.stopPropagation()
        return
      }
      if (
        tool === 'marquee' &&
        event.button === 0 &&
        event.isPrimary &&
        gestureOwner === null &&
        (event.ctrlKey || event.metaKey)
      ) {
        marqueeClick(event, { kind, id, part: 'label' })
        return
      }
      if (
        tool === 'select' &&
        event.button === 0 &&
        event.isPrimary &&
        gestureOwner === null &&
        toggle(event, { kind, id, part: 'label' })
      )
        return
      if (tool === 'select' && event.button === 0)
        capture(event, 'label', id, undefined, label, kind)
    },
    handlers: {
      onBlur: () => setPointerFocus(false),
      onKeyDown: (event: ReactKeyboardEvent<SVGSVGElement>) => {
        if (
          event.key === 'Escape' &&
          avoidanceWorkflow?.draft.kind !== 'idle' &&
          avoidanceWorkflow
        ) {
          event.preventDefault()
          event.stopPropagation()
          cancel()
          avoidanceWorkflow.cancel()
          svgRef.current?.focus({ preventScroll: true })
          return
        }
        if (event.key === 'Tab') setPointerFocus(false)
        else if (event.key === 'Delete' || event.key === 'Backspace') setPointerFocus(true)
        if (event.key === 'Escape' && drag.current) {
          event.preventDefault()
          event.stopPropagation()
          cancel()
        }
      },
      onPointerEnter: () => {
        hover.current = true
      },
      onPointerLeave: () => {
        hover.current = false
        onPointerPosition?.(null)
      },
      onPointerDownCapture: (event: PointerEvent<SVGSVGElement>) => {
        if (event.target instanceof Element && event.target.closest('[data-selection-toolbar]'))
          return
        setPointerFocus(true)
        if ((event.button === 0 && (tool === 'pan' || space.current)) || event.button === 1)
          capture(event, 'pan', '')
      },
      onPointerDown: (event: PointerEvent<SVGSVGElement>) => {
        if (event.button !== 0 || !event.isPrimary || drag.current || gestureOwner !== null) return
        svgRef.current?.focus({ preventScroll: true })
        if (pickingTarget) {
          event.preventDefault()
          return
        }
        if (tool === 'select') return
        if (tool === 'marquee') {
          capture(event, 'marquee', '')
          return
        }
        const location = svgPoint(event.clientX, event.clientY)
        if (!location) return
        // Project the raw pointer first: grid snapping must not pull a hit off its path.
        const pathHit =
          tool === 'marker' && !event.altKey
            ? nearestPath(
                sourceSnapPaths(state),
                fromSvg(location, state.viewport),
                pathMetric(),
                8,
              )
            : null
        const point = pathHit
          ? snapPathGrid(
              fromSvg(location, state.viewport),
              pathHit,
              pathMetric(),
              state.snap,
              state.viewport,
            )
          : snapped(location, event.altKey)
        if (tool === 'line') {
          // Connection and free-point tools only reuse source points, never generated joints.
          const existing = nearby(scenePoints(state), location)
          if (existing)
            pointClick(
              event,
              existing.id,
              state.vertices.some((v) => v.id === existing.id) ? 'vertex' : 'marker',
            )
          return
        }
        if (tool === 'arc') onArcPoint(point)
        else if (tool === 'marker' || tool === 'formula') {
          const existing =
            tool === 'marker'
              ? nearby(scenePoints(state), location)
              : nearby(state.formulas, location)
          if (existing) {
            const kind =
              tool === 'formula'
                ? 'formula'
                : state.vertices.some((v) => v.id === existing.id)
                  ? 'vertex'
                  : 'marker'
            capture(event, kind, existing.id, existing)
            return
          }
          dispatch({
            type: tool === 'marker' ? 'addMarker' : 'addFormula',
            id: createVertex(point, state).id,
            point,
          })
          onInspect?.()
        } else if (tool === 'add') {
          dispatch({
            type: 'add',
            vertex: createVertex(point, state),
          })
          onInspect?.()
        }
      },
      onPointerMove: (event: PointerEvent<SVGSVGElement>) => {
        const location = svgPoint(event.clientX, event.clientY)
        if (location) onPointerPosition?.(fromSvg(location, state.viewport))
        const current = drag.current
        if (!current || current.pointerId !== event.pointerId) return
        if (
          !current.moved &&
          !event.altKey &&
          Math.hypot(event.clientX - current.client.x, event.clientY - current.client.y) < 3
        )
          return
        const point = svgPoint(event.clientX, event.clientY)
        if (!point) return
        current.moved = true
        if (current.kind === 'selection' && current.selectionStart) {
          const from = current.selectionStart
          const anchor = translationAnchor(from)
          const start = anchor ?? fromSvg(current.start, current.view)
          const target = anchor
            ? snapped(point, event.altKey, current.view, current.offset)
            : fromSvg(point, current.view)
          dispatch({
            type: 'translateSelection',
            from,
            delta: { re: target.re - start.re, im: target.im - start.im },
          })
          return
        }
        if (current.kind === 'marquee') {
          current.end = point
          setMarquee(rectangle(current.start, point))
          return
        }
        if (current.kind === 'pan') {
          dispatch({
            type: 'viewport',
            value: panViewport(current.view, point.x - current.start.x, point.y - current.start.y),
          })
          return
        }
        if (current.kind === 'label' && current.label && current.labelKind) {
          const clamp = (n: number) =>
            Math.max(-LABEL_OFFSET_LIMIT, Math.min(LABEL_OFFSET_LIMIT, n))
          const dx = Math.round((point.x - current.start.x) * 1000) / 1000
          const dy = Math.round((point.y - current.start.y) * 1000) / 1000
          if (current.implicitLabel && dx === 0 && dy === 0) {
            dispatch({ type: 'clearVertexLabel', id: current.id })
            return
          }
          dispatch({
            type: 'label',
            target: { kind: current.labelKind, id: current.id },
            label: {
              ...current.label,
              dx: clamp(current.label.dx + dx),
              dy: clamp(current.label.dy + dy),
            },
          })
          return
        }
        const raw = fromSvg(point, current.view)
        if (current.kind === 'avoidance-radius' && current.radiusCenter) {
          const radius = Math.hypot(
            raw.re - current.offset.re - current.radiusCenter.re,
            raw.im - current.offset.im - current.radiusCenter.im,
          )
          dispatch({ type: 'updateAvoidance', id: current.id, patch: { radius } })
          return
        }
        const pathHit =
          current.kind === 'marker' && current.markerPaths && !event.altKey
            ? nearestPath(
                current.markerPaths,
                { re: raw.re - current.offset.re, im: raw.im - current.offset.im },
                pathMetric(current.view),
              )
            : null
        const math = pathHit
          ? snapPathGrid(
              { re: raw.re - current.offset.re, im: raw.im - current.offset.im },
              pathHit,
              pathMetric(current.view),
              state.snap,
              current.view,
            )
          : snapped(point, event.altKey, current.view, current.offset)
        if (current.kind === 'vertex' || current.kind === 'through')
          dispatch({
            type: current.kind === 'vertex' ? 'move' : 'moveThrough',
            id: current.id,
            point: math,
          })
        else if (current.kind === 'marker' || current.kind === 'formula')
          dispatch({ type: 'moveObject', kind: current.kind, id: current.id, point: math })
      },
      onPointerUp: (event: PointerEvent<SVGSVGElement>) => finish(event.pointerId),
      onPointerCancel: (event: PointerEvent<SVGSVGElement>) => finish(event.pointerId, true),
      onLostPointerCapture: (event: PointerEvent<SVGSVGElement>) => finish(event.pointerId, true),
    },
  }
}
