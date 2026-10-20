import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type KeyboardEvent,
  type PointerEvent,
} from 'react'
import type { EditorAction, GestureOwner } from './history'

const rangeKeys = new Set([
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
  'PageUp',
  'PageDown',
])
const isRange = (target: EventTarget | null): target is HTMLInputElement =>
  target instanceof HTMLInputElement && target.type === 'range'

export function useSliderHistory(dispatch: Dispatch<EditorAction>, owner: GestureOwner | null) {
  const pointer = useRef<number | null>(null)
  const keyboard = useRef<HTMLInputElement | null>(null)
  const finish = useCallback(() => {
    if (pointer.current === null && keyboard.current === null) return
    const gestureOwner = pointer.current !== null ? 'slider-pointer' : 'slider-keyboard'
    pointer.current = null
    keyboard.current = null
    dispatch({ type: 'endGesture', owner: gestureOwner })
  }, [dispatch])

  useEffect(() => {
    const pointerEnd = (event: globalThis.PointerEvent) => {
      if (event.pointerId === pointer.current) finish()
    }
    const keyEnd = (event: globalThis.KeyboardEvent) => {
      if (keyboard.current && rangeKeys.has(event.key)) finish()
    }
    window.addEventListener('pointerup', pointerEnd)
    window.addEventListener('pointercancel', pointerEnd)
    window.addEventListener('lostpointercapture', pointerEnd)
    window.addEventListener('keyup', keyEnd)
    window.addEventListener('blur', finish)
    return () => {
      window.removeEventListener('pointerup', pointerEnd)
      window.removeEventListener('pointercancel', pointerEnd)
      window.removeEventListener('lostpointercapture', pointerEnd)
      window.removeEventListener('keyup', keyEnd)
      window.removeEventListener('blur', finish)
    }
  }, [finish])

  return {
    onPointerDownCapture: (event: PointerEvent<HTMLElement>) => {
      if (owner || pointer.current !== null || keyboard.current) {
        event.preventDefault()
        event.stopPropagation()
        return
      }
      if (!isRange(event.target) || !event.isPrimary || event.button !== 0) return
      pointer.current = event.pointerId
      dispatch({ type: 'beginGesture', owner: 'slider-pointer' })
      event.target.setPointerCapture(event.pointerId)
    },
    onKeyDownCapture: (event: KeyboardEvent<HTMLElement>) => {
      if (pointer.current !== null && event.key === 'Tab') {
        event.preventDefault()
        return
      }
      if (
        isRange(event.target) &&
        rangeKeys.has(event.key) &&
        (pointer.current !== null || (owner !== null && owner !== 'slider-keyboard'))
      ) {
        event.preventDefault()
        return
      }
      if (!isRange(event.target) || !rangeKeys.has(event.key) || keyboard.current) return
      keyboard.current = event.target
      dispatch({ type: 'beginGesture', owner: 'slider-keyboard' })
    },
    onBlurCapture: () => {
      if (keyboard.current) finish()
    },
  }
}
