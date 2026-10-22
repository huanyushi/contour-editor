import { describe, expect, it, vi } from 'vitest'
import { createInitialState } from '../contour/model'
import { serializeProject } from './project'
import {
  commitCanvasWorkspace,
  readCanvasWorkspace,
  type CanvasDatabaseSnapshot,
} from './canvasStorage'

export function snapshot(count = 1): CanvasDatabaseSnapshot {
  return {
    workspace: {
      version: 1,
      order: Array.from({ length: count }, (_, i) => `c${i}`),
      activeId: `c${count - 1}`,
      revision: 1,
      legacyMigrated: false,
    },
    canvases: Array.from({ length: count }, (_, i) => ({
      id: `c${i}`,
      name: `作品 ${i}`,
      project: serializeProject({
        ...createInitialState(),
        viewport: { ...createInitialState().viewport, centerRe: i },
      }),
    })),
  }
}

describe('canvas database', () => {
  it('roundtrips ten projects with order, names, views and active ID', async () => {
    expect(await readCanvasWorkspace()).toBeNull()
    const value = snapshot(10)
    await commitCanvasWorkspace(value, null)
    expect((await readCanvasWorkspace())?.snapshot).toEqual(value)
  })

  it('rejects stale revisions without partially replacing any canvas', async () => {
    const first = snapshot(2)
    await commitCanvasWorkspace(first, null)
    const second = { ...first, workspace: { ...first.workspace, revision: 2, activeId: 'c0' } }
    await commitCanvasWorkspace(second, 1)
    const stale = snapshot(1)
    stale.workspace.revision = 2
    await expect(commitCanvasWorkspace(stale, 1)).rejects.toThrow(/其他标签页/)
    expect((await readCanvasWorkspace())?.snapshot).toEqual(second)
  })

  it('keeps the previous workspace when a transaction aborts after writes', async () => {
    await commitCanvasWorkspace(snapshot(2), null)
    const factory = indexedDB
    const original = factory.open.bind(factory)
    vi.spyOn(factory, 'open').mockImplementation((...args) => {
      const request = original(...args)
      request.addEventListener('success', () => {
        const db = request.result
        const transaction = db.transaction.bind(db)
        vi.spyOn(db, 'transaction').mockImplementation((...input) => {
          const tx = transaction(...input)
          if (input[1] === 'readwrite') {
            const store = tx.objectStore('workspace')
            const put = store.put.bind(store)
            vi.spyOn(store, 'put').mockImplementation((...values) => {
              const result = put(...values)
              tx.abort()
              return result
            })
            const objectStore = tx.objectStore.bind(tx)
            vi.spyOn(tx, 'objectStore').mockImplementation((name) =>
              name === 'workspace' ? store : objectStore(name),
            )
          }
          return tx
        })
      })
      return request
    })
    await expect(
      commitCanvasWorkspace(
        { ...snapshot(1), workspace: { ...snapshot(1).workspace, revision: 2 } },
        1,
      ),
    ).rejects.toThrow()
    vi.restoreAllMocks()
    expect((await readCanvasWorkspace())?.workspace.canvases).toHaveLength(2)
  })

  it('reports unavailable storage rather than treating it as an empty library', async () => {
    vi.stubGlobal('indexedDB', undefined)
    await expect(readCanvasWorkspace()).rejects.toThrow(/IndexedDB/)
  })

  it('reports corrupt records without silently replacing them', async () => {
    await commitCanvasWorkspace(snapshot(1), null)
    await new Promise<void>((resolve) => {
      const request = indexedDB.open('complex-contour-editor', 1)
      request.onsuccess = () => {
        const db = request.result
        const tx = db.transaction('canvases', 'readwrite')
        tx.objectStore('canvases').put({ id: 'c0', name: '损坏作品', project: '{broken' })
        tx.oncomplete = () => {
          db.close()
          resolve()
        }
      }
    })
    await expect(readCanvasWorkspace()).rejects.toThrow(/损坏作品.*无法恢复/)
    await expect(readCanvasWorkspace()).rejects.toThrow(/原始数据已保留/)
  })
})
