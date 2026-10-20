import { useLayoutEffect, useState, type RefObject } from 'react'
import { exportSize, type CanvasSize } from '../../lib/viewport'

export function useCanvasSize(ref: RefObject<HTMLDivElement | null>): CanvasSize {
  const [size, setSize] = useState(exportSize)
  useLayoutEffect(() => {
    const element = ref.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const update = (width: number, height: number) => {
      if (width <= 0 || height <= 0) return
      setSize((previous) =>
        previous.width === width && previous.height === height ? previous : { width, height },
      )
    }
    update(element.clientWidth, element.clientHeight)
    const observer = new ResizeObserver(([entry]) => {
      update(entry.contentRect.width, entry.contentRect.height)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])
  return size
}
