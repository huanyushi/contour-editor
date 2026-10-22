import { createCanvasEntry, MAX_CANVASES, type CanvasWorkspace } from './canvasWorkspace'
import type { ContourState } from '../contour/model'
import { parseProject } from './project'
import { normalizeProjectName } from './projectName'
import { DRAFT_KEY, DRAFT_NAME_KEY } from './legacyLocalDraft'

const DATABASE = 'complex-contour-editor'
export interface StoredCanvas {
  id: string
  name: string
  project: string
}
export interface StoredWorkspace {
  version: 1
  order: string[]
  activeId: string
  revision: number
  legacyMigrated: boolean
}
export interface CanvasDatabaseSnapshot {
  workspace: StoredWorkspace
  canvases: StoredCanvas[]
}

export class CanvasRecoveryError extends Error {}

// At most one immutable validated project string per canvas. Reads from disk are
// always revalidated; only unchanged writes reuse this bounded in-session cache.
const validatedProjects = new Map<string, string>()

export function storageErrorMessage(problem: unknown): string {
  return problem && typeof problem === 'object' && 'message' in problem
    ? String(problem.message)
    : String(problem ?? '存储不可用')
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error('IndexedDB 不可用'))
      return
    }
    const request = indexedDB.open(DATABASE, 1)
    let blocked = false
    request.onupgradeneeded = () => {
      const db = request.result
      db.createObjectStore('canvases', { keyPath: 'id' })
      db.createObjectStore('workspace')
    }
    request.onerror = () => reject(request.error ?? new Error('无法打开本地数据库'))
    request.onblocked = () => {
      blocked = true
      reject(new Error('本地数据库正在升级，请关闭其他编辑器标签页后重试'))
    }
    request.onsuccess = () => {
      if (blocked) {
        request.result.close()
        return
      }
      request.result.onversionchange = () => request.result.close()
      resolve(request.result)
    }
  })
}

function validateSnapshot(value: CanvasDatabaseSnapshot, fresh = true): Map<string, ContourState> {
  const { workspace: meta, canvases } = value
  if (
    !meta ||
    meta.version !== 1 ||
    !Array.isArray(meta.order) ||
    !Array.isArray(canvases) ||
    meta.order.length < 1 ||
    meta.order.length > MAX_CANVASES ||
    new Set(meta.order).size !== meta.order.length ||
    !meta.order.includes(meta.activeId) ||
    !Number.isSafeInteger(meta.revision) ||
    meta.revision < 1 ||
    typeof meta.legacyMigrated !== 'boolean' ||
    canvases.length !== meta.order.length
  )
    throw new CanvasRecoveryError('本地画布索引损坏，原始数据已保留，请下载本地数据备份。')
  const ids = new Set<string>()
  const states = new Map<string, ContourState>()
  for (const entry of canvases) {
    if (
      !entry ||
      typeof entry.id !== 'string' ||
      !entry.id ||
      entry.id.length > 100 ||
      ids.has(entry.id) ||
      !meta.order.includes(entry.id) ||
      typeof entry.name !== 'string' ||
      normalizeProjectName(entry.name) !== entry.name ||
      typeof entry.project !== 'string'
    )
      throw new CanvasRecoveryError('本地画布记录损坏，原始数据已保留，请下载本地数据备份。')
    ids.add(entry.id)
    if (!fresh && validatedProjects.get(entry.id) === entry.project) continue
    try {
      states.set(entry.id, parseProject(entry.project))
      validatedProjects.delete(entry.id)
      validatedProjects.set(entry.id, entry.project)
      if (validatedProjects.size > MAX_CANVASES)
        validatedProjects.delete(validatedProjects.keys().next().value!)
    } catch (problem) {
      throw new CanvasRecoveryError(
        `画布“${entry.name}”无法恢复：${problem instanceof Error ? problem.message : '数据损坏'}。原始数据已保留。`,
      )
    }
  }
  return states
}

async function readRaw(): Promise<{
  workspace: StoredWorkspace | undefined
  canvases: StoredCanvas[]
}> {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['workspace', 'canvases'], 'readonly')
    const meta = tx.objectStore('workspace').get('current')
    const entries = tx.objectStore('canvases').getAll()
    tx.oncomplete = () => {
      db.close()
      resolve({ workspace: meta.result, canvases: entries.result })
    }
    tx.onabort = tx.onerror = () => {
      db.close()
      reject(tx.error ?? new Error('读取本地画布失败'))
    }
  })
}

export async function readCanvasWorkspace(): Promise<{
  snapshot: CanvasDatabaseSnapshot
  workspace: CanvasWorkspace
} | null> {
  const raw = await readRaw()
  if (!raw.workspace && raw.canvases.length === 0) return null
  const snapshot = raw as CanvasDatabaseSnapshot
  const states = validateSnapshot(snapshot)
  const canvases = snapshot.workspace.order.map((id) =>
    snapshot.canvases.find((entry) => entry.id === id)!,
  )
  return {
    snapshot: { ...snapshot, canvases },
    workspace: {
      activeId: snapshot.workspace.activeId,
      canvases: canvases.map((entry) =>
        createCanvasEntry(entry.id, entry.name, states.get(entry.id)!),
      ),
    },
  }
}

/** Resolve only on transaction completion, not on a successful individual put. */
export async function commitCanvasWorkspace(
  snapshot: CanvasDatabaseSnapshot,
  expectedRevision: number | null,
): Promise<void> {
  validateSnapshot(snapshot, false)
  if (snapshot.workspace.revision !== (expectedRevision ?? 0) + 1)
    throw new Error('画布保存版本无效')
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['workspace', 'canvases'], 'readwrite')
    const metadata = tx.objectStore('workspace')
    const records = tx.objectStore('canvases')
    let failure: Error | null = null
    metadata.get('current').onsuccess = (event) => {
      const current = (event.target as IDBRequest<StoredWorkspace | undefined>).result
      if ((current?.revision ?? null) !== expectedRevision) {
        failure = new Error(
          '其他标签页已修改画布。请先保存项目备份，再刷新此页；本页未覆盖其他标签页的作品。',
        )
        tx.abort()
        return
      }
      records.getAll().onsuccess = (read) => {
        const previous = (read.target as IDBRequest<StoredCanvas[]>).result
        for (const old of previous)
          if (!snapshot.workspace.order.includes(old.id)) records.delete(old.id)
        for (const entry of snapshot.canvases) {
          const old = previous.find((item) => item.id === entry.id)
          if (!old || old.name !== entry.name || old.project !== entry.project) records.put(entry)
        }
        metadata.put(snapshot.workspace, 'current')
      }
    }
    tx.oncomplete = () => {
      db.close()
      resolve()
    }
    tx.onabort = tx.onerror = () => {
      db.close()
      reject(failure ?? tx.error ?? new Error('画布保存事务已中止'))
    }
  })
}

export async function readLocalRecovery(): Promise<unknown> {
  let legacy: unknown
  try {
    legacy = {
      project: localStorage.getItem(DRAFT_KEY),
      name: localStorage.getItem(DRAFT_NAME_KEY),
    }
  } catch (problem) {
    legacy = { error: String(problem) }
  }
  let database: unknown
  try {
    database = await readRaw()
  } catch (problem) {
    database = { error: String(problem) }
  }
  return { format: 'complex-contour-editor-local-recovery', legacy, database }
}
