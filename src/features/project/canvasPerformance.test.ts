import { describe, expect, it, vi } from 'vitest'
import { createInitialState } from '../contour/model'
import { defaultLabel, defaultPointStyle } from '../contour/appearance'
import { canvasWorkspaceReducer, createCanvasEntry, type CanvasWorkspace } from './canvasWorkspace'
import { loadCanvasStartup, snapshotFromWorkspace } from './canvasMigration'
import { renderHook, waitFor } from '@testing-library/react'
import { useCanvasWorkspace } from './useCanvasWorkspace'
import { commitCanvasWorkspace, readCanvasWorkspace } from './canvasStorage'
import * as project from './project'

describe('incremental canvas saving', () => {
  it('restores each saved canvas with one complete parse rather than validating it twice', async () => {
    const canvases = Array.from({ length: 10 }, (_, i) =>
      createCanvasEntry(`restore-${i}`, `作品${i}`, createInitialState()),
    )
    await commitCanvasWorkspace(
      snapshotFromWorkspace({ canvases, activeId: canvases[3].id }, 1, true),
      null,
    )
    const parse = vi.spyOn(project, 'parseProject')
    try {
      const hook = renderHook(useCanvasWorkspace)
      await waitFor(() => expect(hook.result.current.ready).toBe(true))
      expect(hook.result.current.workspace.canvases).toHaveLength(10)
      expect(hook.result.current.active.name).toBe('作品3')
      expect(parse).toHaveBeenCalledTimes(10)
      hook.unmount()
      parse.mockClear()
      await loadCanvasStartup()
      expect(parse).toHaveBeenCalledTimes(10)
    } finally {
      parse.mockRestore()
    }
  })

  it('keeps only the latest serialization per canvas instead of retaining strings for all undo snapshots', () => {
    const original: CanvasWorkspace = {
      canvases: [createCanvasEntry('history-memory', 'A', createInitialState())],
      activeId: 'history-memory',
    }
    snapshotFromWorkspace(original, 1, false)
    const edited = canvasWorkspaceReducer(original, {
      type: 'edit',
      id: 'history-memory',
      action: { type: 'reverse' },
    })
    snapshotFromWorkspace(edited, 2, false)
    const serialize = vi.spyOn(project, 'serializeProject')
    try {
      // Undo keeps the old state alive. It must not also retain a full JSON
      // string for every one of the 100 history entries in each of 10 canvases.
      snapshotFromWorkspace(original, 3, false)
      expect(serialize).toHaveBeenCalledTimes(1)
    } finally {
      serialize.mockRestore()
    }
  })

  it('only serializes and validates changed documents, but fully validates database restoration', async () => {
    let ws: CanvasWorkspace = {
      // Exceed the math renderer's 300-entry cache across the workspace. Saving
      // one canvas must not force the other nine to re-typeset their formulas.
      canvases: Array.from({ length: 10 }, (_, i) => {
        const state = createInitialState()
        state.formulas = Array.from({ length: 32 }, (_, j) => ({
          id: `formula-${j}`,
          re: j % 8,
          im: Math.floor(j / 8),
          label: defaultLabel(`x_{${i},${j}}`),
          pointStyle: defaultPointStyle(),
        }))
        return createCanvasEntry(`canvas-${i}`, `作品${i}`, state)
      }),
      activeId: 'canvas-0',
    }
    await commitCanvasWorkspace(snapshotFromWorkspace(ws, 1, false), null)
    const serialize = vi.spyOn(project, 'serializeProject')
    const parse = vi.spyOn(project, 'parseProject')
    try {
      ws = canvasWorkspaceReducer(ws, { type: 'rename', id: 'canvas-0', name: '新名称' })
      await commitCanvasWorkspace(snapshotFromWorkspace(ws, 2, false), 1)
      expect(serialize).not.toHaveBeenCalled()
      expect(parse).not.toHaveBeenCalled()
      ws = canvasWorkspaceReducer(ws, {
        type: 'edit',
        id: 'canvas-0',
        action: {
          type: 'viewport',
          value: { ...ws.canvases[0].history.present.viewport, centerRe: 1 },
        },
      })
      await commitCanvasWorkspace(snapshotFromWorkspace(ws, 3, false), 2)
      expect(serialize).toHaveBeenCalledTimes(1)
      expect(parse).toHaveBeenCalledTimes(1)
      parse.mockClear()
      await readCanvasWorkspace()
      expect(parse).toHaveBeenCalledTimes(10)
    } finally {
      serialize.mockRestore()
      parse.mockRestore()
    }
  })
})
