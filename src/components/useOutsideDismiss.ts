import { useEffect, useRef } from 'react'

export function useOutsideDismiss<T extends HTMLElement>(
  open: boolean,
  setOpen: (open: boolean) => void,
) {
  const ref = useRef<T>(null)
  useEffect(() => {
    if (!open) return
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !ref.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', dismiss, true)
    return () => document.removeEventListener('pointerdown', dismiss, true)
  }, [open, setOpen])
  return ref
}
