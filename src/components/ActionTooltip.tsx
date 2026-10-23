import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import './ActionTooltip.css'

/** One delegated tooltip for action controls, including controls mounted later. */
export function ActionTooltip() {
  const id = useId()
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const tooltip = ref.current!
    let active: HTMLElement | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    let pointerFocus = false

    const clearTimer = () => {
      clearTimeout(timer)
      timer = undefined
    }
    const hide = () => {
      clearTimer()
      if (active) {
        const descriptions = (active.getAttribute('aria-describedby') ?? '')
          .split(/\s+/)
          .filter((description) => description && description !== id)
        if (descriptions.length) active.setAttribute('aria-describedby', descriptions.join(' '))
        else active.removeAttribute('aria-describedby')
      }
      active = null
      tooltip.hidden = true
    }
    const target = (node: EventTarget | null) =>
      node instanceof Element ? node.closest<HTMLElement>('[data-tooltip]') : null

    const show = (control: HTMLElement) => {
      hide()
      const text = control.dataset.tooltip
      if (!text || !control.isConnected || control.closest('[inert], [hidden]')) return
      active = control
      tooltip.textContent = text
      tooltip.hidden = false
      const anchor = control.getBoundingClientRect()
      const bounds = tooltip.getBoundingClientRect()
      const margin = 8
      const gap = 10
      const width = document.documentElement.clientWidth
      const height = window.innerHeight
      let left = anchor.left + (anchor.width - bounds.width) / 2
      let top = anchor.bottom + gap
      if (control.closest('.tool-palette')) {
        left = anchor.right + gap
        if (left + bounds.width > width - margin) left = anchor.left - bounds.width - gap
        top = anchor.top + (anchor.height - bounds.height) / 2
      } else if (top + bounds.height > height - margin) {
        top = anchor.top - bounds.height - gap
      }
      tooltip.style.left = `${Math.max(margin, Math.min(left, width - bounds.width - margin))}px`
      tooltip.style.top = `${Math.max(margin, Math.min(top, height - bounds.height - margin))}px`
      const descriptions =
        control.getAttribute('aria-describedby')?.split(/\s+/).filter(Boolean) ?? []
      control.setAttribute('aria-describedby', [...descriptions, id].join(' '))
    }
    const over = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return
      const control = target(event.target)
      if (!control || control.contains(event.relatedTarget as Node | null)) return
      hide()
      timer = setTimeout(() => show(control), 400)
    }
    const out = (event: PointerEvent) => {
      const control = target(event.target)
      if (control && !control.contains(event.relatedTarget as Node | null)) hide()
    }
    const focus = (event: FocusEvent) => {
      const control = target(event.target)
      if (control && !pointerFocus) show(control)
    }
    const pointerDown = () => {
      pointerFocus = true
      hide()
    }
    const keyDown = (event: KeyboardEvent) => {
      pointerFocus = false
      if (event.key === 'Escape') hide()
    }
    const observer = new MutationObserver(() => {
      if (
        active &&
        (!active.isConnected ||
          active.closest('[inert], [hidden]') ||
          active.dataset.tooltip !== tooltip.textContent)
      )
        hide()
    })
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['data-tooltip', 'hidden', 'inert'],
    })
    document.addEventListener('pointerover', over, true)
    document.addEventListener('pointerout', out, true)
    document.addEventListener('focusin', focus, true)
    document.addEventListener('focusout', hide, true)
    document.addEventListener('pointerdown', pointerDown, true)
    document.addEventListener('click', hide, true)
    document.addEventListener('keydown', keyDown, true)
    document.addEventListener('scroll', hide, true)
    window.addEventListener('resize', hide)
    window.addEventListener('blur', hide)
    return () => {
      observer.disconnect()
      hide()
      document.removeEventListener('pointerover', over, true)
      document.removeEventListener('pointerout', out, true)
      document.removeEventListener('focusin', focus, true)
      document.removeEventListener('focusout', hide, true)
      document.removeEventListener('pointerdown', pointerDown, true)
      document.removeEventListener('click', hide, true)
      document.removeEventListener('keydown', keyDown, true)
      document.removeEventListener('scroll', hide, true)
      window.removeEventListener('resize', hide)
      window.removeEventListener('blur', hide)
    }
  }, [id])

  return createPortal(
    <div ref={ref} id={id} className="action-tooltip" role="tooltip" hidden />,
    document.body,
  )
}
