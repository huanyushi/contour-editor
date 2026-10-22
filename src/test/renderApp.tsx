import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect } from 'vitest'
import App from '../app/App'
import { readCanvasWorkspace } from '../features/project/canvasStorage'
import { parseProject } from '../features/project/project'

export async function renderApp() {
  const view = render(<App />)
  await screen.findByTestId('contour-canvas')
  return view
}

export async function savedCanvasState() {
  fireEvent(window, new Event('pagehide'))
  await waitFor(() => expect(screen.getByLabelText('画布保存状态')).toHaveTextContent('已保存'))
  const snapshot = (await readCanvasWorkspace())?.snapshot
  if (!snapshot) throw new Error('No saved canvas')
  return parseProject(
    snapshot.canvases.find((entry) => entry.id === snapshot.workspace.activeId)!.project,
  )
}
