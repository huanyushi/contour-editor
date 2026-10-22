import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useCanvasWorkspace } from './useCanvasWorkspace'
import { readCanvasWorkspace } from './canvasStorage'
import { createBlankCanvasState } from './canvasWorkspace'
import { parseProject } from './project'
import * as storage from './canvasStorage'

async function ready() {
  const hook = renderHook(useCanvasWorkspace)
  await waitFor(() => expect(hook.result.current.ready).toBe(true))
  return hook
}

describe('canvas autosaving', () => {
  it('keeps delayed writes bound to their ID and does not mark newer edits as saved', async () => {
    const { result } = await ready()
    const original = storage.commitCanvasWorkspace
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const write = vi
      .spyOn(storage, 'commitCanvasWorkspace')
      .mockImplementationOnce(async (...args) => {
        await gate
        return original(...args)
      })
    act(() => result.current.dispatch({ type: 'move', id: 'a', point: { re: -3, im: 0 } }))
    let pending!: Promise<boolean>
    act(() => {
      pending = result.current.flush()
    })
    await waitFor(() => expect(result.current.status).toMatch(/正在保存/))
    act(() => result.current.dispatch({ type: 'move', id: 'a', point: { re: -2, im: 0 } }))
    expect(result.current.status).not.toMatch(/已保存/)
    let switching!: Promise<boolean>
    act(() => {
      switching = result.current.add(createBlankCanvasState(), 'B')
    })
    expect(result.current.active.name).toBe('Untitled')
    await act(async () => {
      release()
      await pending
      await switching
    })
    expect(result.current.active.name).toBe('B')
    const saved = (await storage.readCanvasWorkspace())?.snapshot
    expect(parseProject(saved!.canvases[0].project).vertices[0].re).toBe(-2)
    expect(parseProject(saved!.canvases[1].project).vertices).toHaveLength(0)
    write.mockRestore()
  })

  it('saves the edited canvas before switching and retains per-canvas histories', async () => {
    const { result } = await ready()
    const a = result.current.active.id
    act(() => result.current.dispatch({ type: 'move', id: 'a', point: { re: -3, im: 0 } }))
    await act(async () => {
      expect(await result.current.add(createBlankCanvasState(), 'B')).toBe(true)
    })
    const b = result.current.active.id
    expect(result.current.active.history.past).toHaveLength(0)
    const stored = await readCanvasWorkspace()
    expect(stored?.workspace.activeId).toBe(b)
    expect(parseProject(stored!.snapshot.canvases[0].project).vertices[0].re).toBe(-3)
    await act(async () => {
      await result.current.activate(a)
    })
    act(() => result.current.dispatch({ type: 'undo' }))
    expect(result.current.active.history.present.vertices[0].re).toBe(-4)
    await act(async () => {
      await result.current.activate(b)
      await result.current.activate(a)
    })
    expect(result.current.active.history.future).toHaveLength(1)
  })

  it('never persists a drag position until the gesture is committed', async () => {
    const { result } = await ready()
    act(() => {
      result.current.dispatch({ type: 'beginGesture', owner: 'canvas' })
      result.current.dispatch({ type: 'move', id: 'a', point: { re: -2, im: 0 } })
    })
    await act(async () => {
      await result.current.flush()
    })
    expect(
      parseProject((await readCanvasWorkspace())!.snapshot.canvases[0].project).vertices[0].re,
    ).toBe(-4)
    act(() => result.current.dispatch({ type: 'endGesture', owner: 'canvas' }))
    await act(async () => {
      await result.current.flush()
    })
    expect(
      parseProject((await readCanvasWorkspace())!.snapshot.canvases[0].project).vertices[0].re,
    ).toBe(-2)
  })

  it('keeps failed edits in memory, blocks switching and supports retry', async () => {
    const { result } = await ready()
    const a = result.current.active.id
    const fail = vi.spyOn(indexedDB, 'open').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError')
    })
    act(() => result.current.dispatch({ type: 'reverse' }))
    await act(async () => {
      expect(await result.current.add(createBlankCanvasState(), 'B')).toBe(false)
    })
    expect(result.current.active.id).toBe(a)
    expect(result.current.active.history.past).toHaveLength(1)
    expect(result.current.status).toMatch(/失败/)
    expect(result.current.error).toMatch(/保存项目/)
    fail.mockRestore()
    await act(async () => {
      await result.current.retry()
    })
    expect(result.current.status).toMatch(/已保存/)
  })

  it('resumes automatic saving after retrying a failed collection operation with a clean document', async () => {
    const { result } = await ready()
    const fail = vi.spyOn(indexedDB, 'open').mockImplementation(() => {
      throw new Error('storage denied')
    })
    await act(async () => {
      expect(await result.current.add(createBlankCanvasState(), 'B')).toBe(false)
    })
    expect(result.current.status).toMatch(/失败/)
    fail.mockRestore()
    await act(async () => {
      await result.current.retry()
    })
    expect(result.current.status).toMatch(/已保存/)
    act(() => result.current.dispatch({ type: 'move', id: 'a', point: { re: -2, im: 0 } }))
    // No explicit flush: edits must again autosave without another manual retry.
    await waitFor(async () => {
      const saved = (await readCanvasWorkspace())?.snapshot
      expect(parseProject(saved!.canvases[0].project).vertices[0].re).toBe(-2)
    })
  })

  it('does not hide a revision conflict when retrying with a clean document', async () => {
    const { result } = await ready()
    const external = (await readCanvasWorkspace())!.snapshot
    await storage.commitCanvasWorkspace(
      { ...external, workspace: { ...external.workspace, revision: 2 } },
      1,
    )
    await act(async () => {
      expect(await result.current.add(createBlankCanvasState(), 'B')).toBe(false)
    })
    await act(async () => {
      expect(await result.current.retry()).toBe(false)
    })
    expect(result.current.error).toMatch(/其他标签页/)
    expect((await readCanvasWorkspace())!.snapshot.workspace.revision).toBe(2)
  })

  it('clears a transient startup storage error after a successful retry', async () => {
    const fail = vi.spyOn(indexedDB, 'open').mockImplementation(() => {
      throw new Error('temporarily unavailable')
    })
    const { result } = await ready()
    expect(result.current.error).toMatch(/temporarily unavailable/)
    fail.mockRestore()
    await act(async () => {
      expect(await result.current.retry()).toBe(true)
    })
    expect(result.current.status).toMatch(/已保存/)
    expect(result.current.error).toBe('')
  })

  it('selection changes do not create writes or dirty unload warnings', async () => {
    const { result } = await ready()
    const revision = (await readCanvasWorkspace())!.snapshot.workspace.revision
    act(() => result.current.dispatch({ type: 'select', id: 'b' }))
    await act(async () => {
      await result.current.flush()
    })
    expect((await readCanvasWorkspace())!.snapshot.workspace.revision).toBe(revision)
    const clean = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(clean)
    expect(clean.defaultPrevented).toBe(false)
    act(() => result.current.dispatch({ type: 'reverse' }))
    const dirty = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(dirty)
    expect(dirty.defaultPrevented).toBe(true)
    await act(async () => {
      await result.current.flush()
    })
  })
})
