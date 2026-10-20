import type { SyntheticEvent } from 'react'

/** Lock an action during a gesture without borrowing the visual style of an unavailable feature. */
export function transientLock(locked: boolean) {
  return {
    'aria-disabled': locked || undefined,
    onClickCapture: (event: SyntheticEvent) => {
      if (!locked) return
      event.preventDefault()
      event.stopPropagation()
    },
  }
}
