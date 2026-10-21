/** Wait for selection navigation to replace the Inspector's focused control. */
export const focusInspector = () =>
  requestAnimationFrame(() =>
    document
      .querySelector<HTMLElement>('#properties-panel .panel-scroll')
      ?.focus({ preventScroll: true }),
  )
