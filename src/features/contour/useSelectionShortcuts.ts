import { useEffect, type Dispatch } from 'react'
import type { Selection } from './appearance'
import type { EditorAction } from './history'
import { selectionItems } from './selectionModel'

export function useSelectionShortcuts(
  dispatch: Dispatch<EditorAction>,
  selection: Selection,
  busy: boolean,
) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        (event.key !== 'Backspace' && event.key !== 'Delete') ||
        !selectionItems(selection).length
      )
        return
      const target = event.target
      if (
        target instanceof Element &&
        (target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"])') ||
          (target instanceof HTMLElement && target.isContentEditable))
      )
        return
      event.preventDefault()
      if (!busy) dispatch({ type: 'deleteSelection' })
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [dispatch, selection, busy])
}
