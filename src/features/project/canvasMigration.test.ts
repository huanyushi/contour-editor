import { describe, expect, it, vi } from 'vitest'
import { createInitialState } from '../contour/model'
import { serializeProject } from './project'
import { DRAFT_KEY, DRAFT_NAME_KEY } from './legacyLocalDraft'
import { loadCanvasStartup } from './canvasMigration'
import { readCanvasWorkspace } from './canvasStorage'

describe('legacy canvas migration', () => {
  it('starts with the existing rectangle when no data exists', async () => {
    const startup = await loadCanvasStartup()
    expect(startup.persisted).toBe(true)
    expect(JSON.parse(startup.snapshot.canvases[0].project).document.vertices).toHaveLength(4)
    expect(startup.snapshot.canvases[0].name).toBe('Untitled')
  })

  it('migrates content and name once and only clears old data after persistence', async () => {
    const state = createInitialState()
    state.viewport.centerRe = 7
    localStorage.setItem(DRAFT_KEY, serializeProject(state))
    localStorage.setItem(DRAFT_NAME_KEY, '旧作品')
    const startup = await loadCanvasStartup()
    expect(startup.snapshot.canvases[0].name).toBe('旧作品')
    expect(startup.snapshot.canvases[0].project).toContain('7')
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull()
    expect((await readCanvasWorkspace())?.snapshot).toEqual(startup.snapshot)
    // Failed old-key cleanup must not cause a second import on the next visit.
    localStorage.setItem(DRAFT_KEY, serializeProject(createInitialState()))
    const again = await loadCanvasStartup()
    expect(again.snapshot).toEqual(startup.snapshot)
  })

  it('retains the legacy document and name when storage cannot be written', async () => {
    const text = serializeProject(createInitialState())
    localStorage.setItem(DRAFT_KEY, text)
    localStorage.setItem(DRAFT_NAME_KEY, '保留')
    vi.spyOn(indexedDB, 'open').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError')
    })
    const result = await loadCanvasStartup()
    expect(result.persisted).toBe(false)
    expect(result.warning).toMatch(/quota/)
    expect(result.snapshot.canvases[0].name).toBe('保留')
    expect(localStorage.getItem(DRAFT_KEY)).toBe(text)
    expect(localStorage.getItem(DRAFT_NAME_KEY)).toBe('保留')
    vi.restoreAllMocks()
  })

  it('keeps damaged legacy data and reports the recovery problem', async () => {
    localStorage.setItem(DRAFT_KEY, '{broken')
    const result = await loadCanvasStartup()
    expect(result.warning).toMatch(/无法恢复/)
    expect(localStorage.getItem(DRAFT_KEY)).toBe('{broken')
    const reopened = await loadCanvasStartup()
    expect(reopened.warning).toMatch(/无法恢复/)
  })

  it('retains the original name record if only name recovery fails', async () => {
    localStorage.setItem(DRAFT_KEY, serializeProject(createInitialState()))
    localStorage.setItem(DRAFT_NAME_KEY, '不能丢失的名称')
    const get = Storage.prototype.getItem
    const fail = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (
      this: Storage,
      key,
    ) {
      if (key === DRAFT_NAME_KEY) throw new Error('metadata denied')
      return get.call(this, key)
    })
    const result = await loadCanvasStartup()
    expect(result.persisted).toBe(true)
    expect(result.warning).toMatch(/名称无法恢复/)
    fail.mockRestore()
    expect(localStorage.getItem(DRAFT_NAME_KEY)).toBe('不能丢失的名称')
    expect(localStorage.getItem(DRAFT_KEY)).not.toBeNull()
  })
})
