import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type PointerEvent,
  type RefObject,
} from 'react'
import { fromSvg, type ComplexPoint, type SvgPoint } from '../../lib/geometry'
import { snapToInteger } from '../../lib/snap'
import { panViewport, type Viewport } from '../../lib/viewport'
import { LABEL_OFFSET_LIMIT, type LabelSettings } from './appearance'
import { createVertex } from './createVertex'
import type { DrawingTool } from './ContourCanvas'
import type { ContourState } from './model'
import type { EditorAction, GestureOwner } from './history'

type PointKind = 'vertex' | 'through' | 'marker' | 'formula'
type LabelKind = 'vertex' | 'segment' | 'marker'
interface Drag {
  pointerId: number
  kind: PointKind | 'label' | 'pan'
  id: string
  start: SvgPoint
  client: SvgPoint
  offset: ComplexPoint
  view: Viewport
  moved: boolean
  label?: LabelSettings
  labelKind?: LabelKind
  implicitLabel?: boolean
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
}: Props) {
  const drag = useRef<Drag | null>(null)
  const hover = useRef(false)
  const space = useRef(false)
  const [spaceHeld, setSpaceHeld] = useState(false)
  const [panActive, setPanActive] = useState(false)

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
    (pointerId?: number) => {
      const current = drag.current
      if (!current || (pointerId !== undefined && current.pointerId !== pointerId)) return
      drag.current = null
      setPanActive(false)
      dispatch({ type: 'endGesture', owner: 'canvas' })
      if (svgRef.current?.hasPointerCapture(current.pointerId))
        svgRef.current.releasePointerCapture(current.pointerId)
      if (current.kind !== 'pan') onInspect?.()
    },
    [dispatch, svgRef, onInspect],
  )

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
      if (event.code === 'Space') {
        space.current = false
        setSpaceHeld(false)
      }
    }
    const blur = () => {
      space.current = false
      setSpaceHeld(false)
      finish()
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

  function snapped(
    point: SvgPoint,
    alt: boolean,
    view = state.viewport,
    offset = { re: 0, im: 0 },
  ) {
    const raw = fromSvg(point, view)
    const matrix = svgRef.current!.getScreenCTM()!
    return snapToInteger(
      { re: raw.re - offset.re, im: raw.im - offset.im },
      {
        x: view.scaleX * Math.hypot(matrix.a, matrix.b),
        y: view.scaleY * Math.hypot(matrix.c, matrix.d),
      },
      state.snap && !alt,
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
      label,
      labelKind,
      implicitLabel:
        labelKind === 'vertex' && !state.vertices.find((vertex) => vertex.id === id)?.label,
    }
    dispatch({ type: 'beginGesture', owner: 'canvas' })
    if (kind === 'pan') setPanActive(true)
    svgRef.current?.setPointerCapture(event.pointerId)
  }

  return {
    adding: tool !== 'select' && tool !== 'pan',
    panning: tool === 'pan' || spaceHeld || panActive,
    selectSegment: (event: PointerEvent<SVGPathElement>, id: string) => {
      if (tool !== 'select' || event.button !== 0 || !event.isPrimary || gestureOwner !== null)
        return
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
      if ((tool === 'select' || tool === 'add') && event.button === 0)
        capture(event, kind, id, point)
    },
    beginLabelDrag: (
      event: PointerEvent<SVGGElement>,
      kind: LabelKind,
      id: string,
      label: LabelSettings,
    ) => {
      if (tool === 'select' && event.button === 0)
        capture(event, 'label', id, undefined, label, kind)
    },
    handlers: {
      onPointerEnter: () => {
        hover.current = true
      },
      onPointerLeave: () => {
        hover.current = false
        onPointerPosition?.(null)
      },
      onPointerDownCapture: (event: PointerEvent<SVGSVGElement>) => {
        if ((event.button === 0 && (tool === 'pan' || space.current)) || event.button === 1)
          capture(event, 'pan', '')
      },
      onPointerDown: (event: PointerEvent<SVGSVGElement>) => {
        if (event.button !== 0 || !event.isPrimary || drag.current || gestureOwner !== null) return
        svgRef.current?.focus({ preventScroll: true })
        if (tool === 'select') {
          dispatch({ type: 'selectObject', selection: { kind: 'contour' } })
          onInspect?.()
          return
        }
        const location = svgPoint(event.clientX, event.clientY)
        if (!location) return
        const point = snapped(location, event.altKey)
        if (tool === 'arc') onArcPoint(point)
        else if (tool === 'marker' || tool === 'formula') {
          dispatch({
            type: tool === 'marker' ? 'addMarker' : 'addFormula',
            id: createVertex(point, state).id,
            point,
          })
          onInspect?.()
        } else if (tool === 'line' || tool === 'add') {
          dispatch({ type: 'add', vertex: createVertex(point, state) })
          if (tool === 'line')
            dispatch({ type: 'selectSegment', id: state.segments[state.segments.length - 1].id })
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
        const math = snapped(point, event.altKey, current.view, current.offset)
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
      onPointerCancel: (event: PointerEvent<SVGSVGElement>) => finish(event.pointerId),
      onLostPointerCapture: (event: PointerEvent<SVGSVGElement>) => finish(event.pointerId),
    },
  }
}
