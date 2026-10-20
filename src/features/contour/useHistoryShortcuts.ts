import { useEffect, type Dispatch } from 'react'
import type { EditorAction } from './history'

export function useHistoryShortcuts(dispatch: Dispatch<EditorAction>, busy: boolean) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.altKey ||
        !(event.ctrlKey || event.metaKey)
      )
        return
      const target = event.target
      if (
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable) ||
        (target instanceof HTMLInputElement &&
          !['range', 'color', 'checkbox', 'radio', 'button', 'submit', 'reset'].includes(
            target.type,
          ))
      )
        return
      const key = event.key.toLowerCase()
      const action =
        key === 'z'
          ? event.shiftKey
            ? 'redo'
            : 'undo'
          : key === 'y' && event.ctrlKey && !event.shiftKey
            ? 'redo'
            : null
      if (!action) return
      event.preventDefault()
      if (!busy) dispatch({ type: action })
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [dispatch, busy])
}
