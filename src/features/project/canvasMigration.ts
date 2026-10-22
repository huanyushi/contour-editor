import {
  createCanvasEntry,
  committedState,
  MAX_CANVASES,
  type CanvasWorkspace,
} from './canvasWorkspace'
import {
  CanvasRecoveryError,
  commitCanvasWorkspace,
  readCanvasWorkspace,
  readLocalRecovery,
  storageErrorMessage,
  type CanvasDatabaseSnapshot,
} from './canvasStorage'
import { serializeProject } from './project'
import type { ContourState } from '../contour/model'
import { DRAFT_KEY, DRAFT_NAME_KEY, readLocalDraft } from './legacyLocalDraft'
import { downloadBlob } from './download'

// Keep one serialization per canvas, not one per historical state: undo history
// deliberately keeps old state objects alive, and their JSON can be very large.
const serializedCanvases = new Map<string, { state: ContourState; text: string }>()
function serializedState(id: string, state: ContourState): string {
  const cached = serializedCanvases.get(id)
  if (cached?.state === state) return cached.text
  const text = serializeProject(state)
  serializedCanvases.delete(id)
  serializedCanvases.set(id, { state, text })
  if (serializedCanvases.size > MAX_CANVASES)
    serializedCanvases.delete(serializedCanvases.keys().next().value!)
  return text
}

export function snapshotFromWorkspace(
  ws: CanvasWorkspace,
  revision: number,
  legacyMigrated: boolean,
): CanvasDatabaseSnapshot {
  const ids = new Set(ws.canvases.map((entry) => entry.id))
  for (const id of serializedCanvases.keys()) if (!ids.has(id)) serializedCanvases.delete(id)
  return {
    workspace: {
      version: 1,
      order: ws.canvases.map((entry) => entry.id),
      activeId: ws.activeId,
      revision,
      legacyMigrated,
    },
    canvases: ws.canvases.map((entry) => ({
      id: entry.id,
      name: entry.name,
      project: serializedState(entry.id, committedState(entry.history)),
    })),
  }
}

export interface CanvasStartup {
  snapshot: CanvasDatabaseSnapshot
  workspace: CanvasWorkspace
  warning: string
  /** Recovery problems remain visible even after a later successful save. */
  persistentWarning: string
  persisted: boolean
  blocked: boolean
  recovered: boolean
}

export async function loadCanvasStartup(): Promise<CanvasStartup> {
  let readFailure: unknown
  try {
    const existing = await readCanvasWorkspace()
    if (existing) {
      const warning = existing.snapshot.workspace.legacyMigrated ? '' : readLocalDraft().error
      return {
        ...existing,
        warning,
        persistentWarning: warning,
        persisted: true,
        blocked: false,
        recovered: true,
      }
    }
  } catch (problem) {
    readFailure = problem
  }
  const legacy = readLocalDraft()
  const entry = createCanvasEntry(crypto.randomUUID(), legacy.name, legacy.state)
  const workspace = { canvases: [entry], activeId: entry.id }
  const snapshot = snapshotFromWorkspace(workspace, 1, legacy.recovered && !legacy.error)
  const fallback = {
    snapshot,
    workspace,
    warning: legacy.error,
    persistentWarning: legacy.error,
    persisted: false,
    blocked: readFailure instanceof CanvasRecoveryError,
    recovered: legacy.recovered,
  }
  if (readFailure)
    return {
      ...fallback,
      warning: [legacy.error, `本地画布无法恢复：${storageErrorMessage(readFailure)}`]
        .filter(Boolean)
        .join(' '),
    }
  try {
    await commitCanvasWorkspace(snapshot, null)
  } catch (problem) {
    return {
      ...fallback,
      warning: [legacy.error, `画布保存失败：${storageErrorMessage(problem)}`]
        .filter(Boolean)
        .join(' '),
    }
  }
  let warning = legacy.error
  if (snapshot.workspace.legacyMigrated) {
    try {
      localStorage.removeItem(DRAFT_KEY)
      localStorage.removeItem(DRAFT_NAME_KEY)
    } catch {
      warning = [warning, '旧草稿已迁移，但旧记录未能清理；新画布已安全保存。']
        .filter(Boolean)
        .join(' ')
    }
  }
  return { ...fallback, warning, persistentWarning: warning, persisted: true }
}

export async function downloadLocalRecovery(): Promise<void> {
  const raw = await readLocalRecovery()
  downloadBlob(
    new Blob([JSON.stringify(raw, null, 2)], { type: 'application/json' }),
    'contour-local-recovery.json',
  )
}
