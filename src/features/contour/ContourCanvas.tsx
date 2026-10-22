import { useRef, type Dispatch, type RefObject } from 'react'
import type { ComplexPoint } from '../../lib/geometry'
import type { CanvasSize } from '../../lib/viewport'
import type { ContourState } from './model'
import type { EditorAction, GestureOwner } from './history'
import { CanvasScene } from './scene/CanvasScene'
import { useCanvasInteraction } from './interaction/useCanvasInteraction'
import type { AvoidanceWorkflow } from './avoidance/useAvoidanceDraft'

export type DrawingTool =
  'select' | 'marquee' | 'add' | 'line' | 'arc' | 'marker' | 'formula' | 'pan'

interface Props {
  state: ContourState
  dispatch: Dispatch<EditorAction>
  gestureOwner: GestureOwner | null
  tool: DrawingTool
  onArcPoint: (point: ComplexPoint) => void
  canvasRef?: RefObject<SVGSVGElement | null>
  size?: CanvasSize
  onPointerPosition?: (point: ComplexPoint | null) => void
  onInspect?: () => void
  avoidanceWorkflow?: AvoidanceWorkflow
}

export function ContourCanvas({ canvasRef, size, ...props }: Props) {
  const internalRef = useRef<SVGSVGElement>(null)
  const svgRef = canvasRef ?? internalRef
  const interaction = useCanvasInteraction({ ...props, svgRef })
  return (
    <CanvasScene
      state={props.state}
      size={size}
      canvasRef={svgRef}
      interaction={interaction}
      avoidanceWorkflow={props.avoidanceWorkflow}
    />
  )
}
