import { useCallback, useEffect, useRef, useState } from 'react'
import type { EditorAction } from '../contour/history'
import { createInitialState, type ContourState } from '../contour/model'
import {
  canvasWorkspaceReducer,
  committedState,
  createBlankCanvasState,
  createCanvasEntry,
  CANVAS_LIMIT_MESSAGE,
  MAX_CANVASES,
  type CanvasWorkspace,
  type CanvasWorkspaceAction,
} from './canvasWorkspace'
import { loadCanvasStartup, snapshotFromWorkspace } from './canvasMigration'
import { commitCanvasWorkspace, storageErrorMessage } from './canvasStorage'
import { parseProject, serializeProject } from './project'
import { DRAFT_KEY, DRAFT_NAME_KEY } from './legacyLocalDraft'

function sameSavedFields(a: ContourState, b: ContourState): boolean {
  return (
    [
      'vertices',
      'segments',
      'connections',
      'avoidances',
      'markers',
      'formulas',
      'appearance',
      'closed',
      'snap',
      'grid',
      'handles',
      'viewport',
      'axes',
    ] as const
  ).every((key) => a[key] === b[key])
}

export function useCanvasWorkspace() {
  const [workspace, setWorkspace] = useState<CanvasWorkspace>(() => {
    const entry = createCanvasEntry('loading', 'Untitled', createInitialState())
    return { canvases: [entry], activeId: entry.id }
  })
  const [ready, setReady] = useState(false)
  const [working, setWorking] = useState(false)
  const [status, setStatus] = useState('正在恢复画布…')
  const [error, setError] = useState('')
  const [warning, setWarning] = useState('')
  const current = useRef(workspace)
  const control = useRef({
    ready: false,
    locked: false,
    blocked: false,
    revision: null as number | null,
    legacyMigrated: false,
    cleanupLegacy: false,
    version: 0,
    saved: -1,
    failed: false,
  })
  const queue = useRef<Promise<boolean>>(Promise.resolve(true))
  const mounted = useRef(false)
  const startup = useRef<ReturnType<typeof loadCanvasStartup> | null>(null)
  const publish = useCallback((next: CanvasWorkspace) => {
    current.current = next
    if (mounted.current) setWorkspace(next)
  }, [])
  const failure = useCallback((problem: unknown) => {
    control.current.failed = true
    if (mounted.current) {
      setStatus('画布保存失败')
      setError(
        `画布保存失败：${storageErrorMessage(problem)}。作品仍在本页，请使用“保存项目”下载当前项目备份。`,
      )
    }
  }, [])

  const flush = useCallback((): Promise<boolean> => {
    const run = async () => {
      const c = control.current
      if (!c.ready) return false
      if (c.blocked) {
        failure('本地数据损坏，为保留原始数据已停止自动写入，请先下载本地数据备份')
        return false
      }
      // A failed collection transaction may leave the current document clean.
      // Retry still verifies a real transaction before re-enabling autosaving.
      while (c.saved !== c.version || c.failed) {
        const version = c.version
        // Capture the complete immutable workspace, including IDs, before awaiting.
        if (mounted.current) setStatus('正在保存画布…')
        try {
          const snapshot = snapshotFromWorkspace(
            current.current,
            (c.revision ?? 0) + 1,
            c.legacyMigrated,
          )
          await commitCanvasWorkspace(snapshot, c.revision)
          c.revision = snapshot.workspace.revision
          c.saved = version
          c.failed = false
          if (c.cleanupLegacy) {
            // Retried migrations must obey the same write-before-cleanup ordering.
            try {
              localStorage.removeItem(DRAFT_KEY)
              localStorage.removeItem(DRAFT_NAME_KEY)
            } catch {
              /* The database remains authoritative. */
            }
            c.cleanupLegacy = false
          }
        } catch (problem) {
          failure(problem)
          return false
        }
      }
      if (mounted.current) {
        setError('')
        setStatus('画布已保存')
      }
      return true
    }
    queue.current = queue.current.then(run, run)
    return queue.current
  }, [failure])

  useEffect(() => {
    mounted.current = true
    // Reuse the startup promise when StrictMode replays the effect.
    startup.current ??= loadCanvasStartup()
    let active = true
    void startup.current.then((result) => {
      if (!active) return
      const c = control.current
      c.ready = true
      c.blocked = result.blocked
      c.revision = result.persisted ? result.snapshot.workspace.revision : null
      c.legacyMigrated = result.snapshot.workspace.legacyMigrated
      c.cleanupLegacy = !result.persisted && result.snapshot.workspace.legacyMigrated
      c.saved = result.persisted ? 0 : -1
      c.failed = !result.persisted
      const restored = result.workspace
      if (!result.recovered) {
        const first = restored.canvases[0].history.present
        if (first.vertices[0]) first.selection = { kind: 'vertex', id: first.vertices[0].id }
      }
      publish(restored)
      setWarning(result.persistentWarning)
      setReady(true)
      setStatus(
        result.persisted
          ? result.recovered
            ? '已恢复画布，画布已保存'
            : '画布已保存'
          : '画布保存失败',
      )
      if (!result.persisted)
        setError(
          `${result.warning}。自动保存尚不可用。作品仍在本页，可使用“保存项目”下载备份，或重试保存。`,
        )
    })
    return () => {
      active = false
      mounted.current = false
    }
  }, [publish])

  const markDirty = useCallback(() => {
    control.current.version++
    if (mounted.current) setStatus(control.current.failed ? '画布保存失败' : '画布待保存')
    if (!control.current.failed) void flush()
  }, [flush])
  const id = workspace.activeId
  const dispatch = useCallback(
    (action: EditorAction) => {
      if (!control.current.ready || control.current.locked || current.current.activeId !== id)
        return
      const before = current.current
      const next = canvasWorkspaceReducer(before, { type: 'edit', id, action })
      if (next === before) return
      const a = before.canvases.find((entry) => entry.id === id)!
      const b = next.canvases.find((entry) => entry.id === id)!
      publish(next)
      if (!sameSavedFields(committedState(a.history), committedState(b.history))) markDirty()
    },
    [id, publish, markDirty],
  )

  useEffect(() => {
    const hidden = () => {
      if (document.visibilityState === 'hidden') void flush()
    }
    const pagehide = () => {
      void flush()
    }
    const leaving = (event: BeforeUnloadEvent) => {
      if (control.current.ready && control.current.saved !== control.current.version) {
        event.preventDefault()
        event.returnValue = ''
        void flush()
      }
    }
    document.addEventListener('visibilitychange', hidden)
    window.addEventListener('pagehide', pagehide)
    window.addEventListener('beforeunload', leaving)
    return () => {
      document.removeEventListener('visibilitychange', hidden)
      window.removeEventListener('pagehide', pagehide)
      window.removeEventListener('beforeunload', leaving)
    }
  }, [flush])

  const transition = useCallback(
    async (action: CanvasWorkspaceAction): Promise<boolean> => {
      const c = control.current
      if (!c.ready || c.locked) return false
      c.locked = true
      setWorking(true)
      try {
        if (!(await flush())) return false
        const next = canvasWorkspaceReducer(current.current, action)
        if (next === current.current) return true
        const snapshot = snapshotFromWorkspace(next, (c.revision ?? 0) + 1, c.legacyMigrated)
        setStatus('正在保存画布…')
        await commitCanvasWorkspace(snapshot, c.revision)
        c.revision = snapshot.workspace.revision
        c.failed = false
        publish(next)
        setError('')
        setStatus('画布已保存')
        return true
      } catch (problem) {
        failure(problem)
        return false
      } finally {
        c.locked = false
        if (mounted.current) setWorking(false)
      }
    },
    [flush, publish, failure],
  )
  const activate = (nextId: string) => transition({ type: 'activate', id: nextId })
  const add = async (state: ContourState, name: string) => {
    if (current.current.canvases.length >= MAX_CANVASES) {
      setError(CANVAS_LIMIT_MESSAGE)
      return false
    }
    return transition({ type: 'add', entry: createCanvasEntry(crypto.randomUUID(), name, state) })
  }
  const rename = (entryId: string, name: string) => {
    if (control.current.locked || !control.current.ready) return
    const entry = current.current.canvases.find((item) => item.id === entryId)
    const next = canvasWorkspaceReducer(current.current, { type: 'rename', id: entryId, name })
    if (entry?.name === next.canvases.find((item) => item.id === entryId)?.name) return
    publish(next)
    markDirty()
  }
  const duplicate = async (entryId: string) => {
    const source = current.current.canvases.find((entry) => entry.id === entryId)
    if (!source) return false
    return add(
      parseProject(serializeProject(committedState(source.history))),
      `${source.name.slice(0, 97)} 副本`,
    )
  }
  const remove = (entryId: string) =>
    transition({
      type: 'remove',
      id: entryId,
      replacement: createCanvasEntry(crypto.randomUUID(), 'Untitled', createBlankCanvasState()),
    })
  return {
    workspace,
    active: workspace.canvases.find((entry) => entry.id === workspace.activeId)!,
    dispatch,
    ready,
    working,
    status,
    error: [warning, error].filter(Boolean).join(' '),
    activate,
    add,
    rename,
    duplicate,
    remove,
    flush,
    retry: flush,
  }
}

export type CanvasWorkspaceManager = ReturnType<typeof useCanvasWorkspace>
