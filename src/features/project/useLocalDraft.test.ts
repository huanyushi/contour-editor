import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createInitialState } from '../contour/model'
import { createArcFixture } from '../../test/fixtures'
import { createAvoidanceFixture } from '../../test/avoidanceFixtures'
import { parseProject, serializeProject } from './project'
import { DRAFT_KEY, DRAFT_NAME_KEY, readLocalDraft, useLocalDraft } from './useLocalDraft'

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  localStorage.clear()
})

describe('local draft recovery', () => {
  it('saves name-only changes, restores names and clears both keys without recreating them', () => {
    vi.useFakeTimers()
    const initial = readLocalDraft()
    const { result, rerender } = renderHook(
      ({ name }) => useLocalDraft(initial.state, false, initial, name),
      { initialProps: { name: '第一个名称' } },
    )
    act(() => vi.advanceTimersByTime(500))
    const geometry = localStorage.getItem(DRAFT_KEY)
    expect(readLocalDraft().name).toBe('第一个名称')
    rerender({ name: '改名' })
    act(() => vi.advanceTimersByTime(500))
    expect(readLocalDraft().name).toBe('改名')
    expect(localStorage.getItem(DRAFT_KEY)).toBe(geometry)
    act(() => result.current.clear())
    act(() => {
      vi.advanceTimersByTime(1000)
      window.dispatchEvent(new Event('pagehide'))
    })
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull()
    expect(localStorage.getItem(DRAFT_NAME_KEY)).toBeNull()
  })

  it('uses default names for legacy or blank metadata and ignores orphan names', () => {
    localStorage.setItem(DRAFT_NAME_KEY, '旧名称')
    expect(readLocalDraft().name).toBe('Untitled')
    localStorage.setItem(DRAFT_KEY, serializeProject(createArcFixture()))
    localStorage.removeItem(DRAFT_NAME_KEY)
    expect(readLocalDraft().name).toBe('Untitled')
    localStorage.setItem(DRAFT_NAME_KEY, '   ')
    expect(readLocalDraft().name).toBe('Untitled')
    expect(readLocalDraft().state.segments[1].kind).toBe('arc')
  })

  it('retains restored geometry when reading name storage fails', () => {
    localStorage.setItem(DRAFT_KEY, serializeProject(createArcFixture()))
    const getItem = Storage.prototype.getItem
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key) {
      if (key === DRAFT_NAME_KEY) throw new Error('metadata unavailable')
      return getItem.call(this, key)
    })
    const initial = readLocalDraft()
    expect(initial.state.segments[1].kind).toBe('arc')
    expect(initial.recovered).toBe(true)
    expect(initial.name).toBe('Untitled')
    expect(initial.error).toContain('metadata unavailable')
    const { result } = renderHook(() => useLocalDraft(initial.state, false, initial))
    expect(result.current.status).toContain('项目名称无法恢复')
  })

  it('reports a name storage write failure and saves explicit loads with their name', () => {
    vi.useFakeTimers()
    const initial = readLocalDraft()
    localStorage.setItem(DRAFT_NAME_KEY, '过期名称')
    const setItem = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === DRAFT_NAME_KEY) throw new Error('name quota')
      setItem.call(this, key, value)
    })
    const { result } = renderHook(() => useLocalDraft(initial.state, false, initial, '新名称'))
    act(() => vi.advanceTimersByTime(500))
    expect(result.current.error).toContain('name quota')
    expect(readLocalDraft().name).toBe('Untitled')
    vi.restoreAllMocks()
    act(() => result.current.saveNow(createArcFixture(), '打开文件'))
    expect(readLocalDraft().name).toBe('打开文件')
    expect(readLocalDraft().state.segments[1].kind).toBe('arc')
  })

  it('saves an undone snapshot after a partially successful write', () => {
    vi.useFakeTimers()
    const initial = readLocalDraft()
    const { rerender } = renderHook(({ state }) => useLocalDraft(state, false, initial, '名称'), {
      initialProps: { state: initial.state },
    })
    act(() => vi.advanceTimersByTime(500))
    const setItem = Storage.prototype.setItem
    const fail = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key,
      value,
    ) {
      if (key === DRAFT_NAME_KEY) throw new Error('name quota')
      setItem.call(this, key, value)
    })
    rerender({ state: createArcFixture() })
    act(() => vi.advanceTimersByTime(500))
    expect(readLocalDraft().state.segments[1].kind).toBe('arc')
    fail.mockRestore()
    rerender({ state: initial.state })
    act(() => window.dispatchEvent(new Event('pagehide')))
    expect(readLocalDraft().state.vertices).toEqual(initial.state.vertices)
    expect(readLocalDraft().name).toBe('名称')
  })

  it('does not skip page-exit persistence after a partially failed clear', () => {
    vi.useFakeTimers()
    const initial = readLocalDraft()
    const { result } = renderHook(() => useLocalDraft(initial.state, false, initial, '名称'))
    act(() => vi.advanceTimersByTime(500))
    const removeItem = Storage.prototype.removeItem
    const fail = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (
      this: Storage,
      key,
    ) {
      if (key === DRAFT_NAME_KEY) throw new Error('metadata removal failed')
      removeItem.call(this, key)
    })
    act(() => result.current.clear())
    expect(result.current.error).toContain('metadata removal failed')
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull()
    fail.mockRestore()
    act(() => window.dispatchEvent(new Event('pagehide')))
    expect(readLocalDraft().recovered).toBe(true)
    expect(readLocalDraft().name).toBe('名称')
  })

  it('reports invalid v3 bindings and preserves the damaged draft on mount and exit', () => {
    vi.useFakeTimers()
    const source = createAvoidanceFixture()
    const file = JSON.parse(serializeProject(source))
    file.version = 3
    file.document.markers = source.markers
    file.document.avoidances = [{ ...source.avoidances[0], markerId: 'missing' }]
    const text = JSON.stringify(file)
    localStorage.setItem(DRAFT_KEY, text)
    const initial = readLocalDraft()
    expect(initial.error).toMatch(/avoid-1.*missing/)
    expect(initial.state.avoidances).toEqual([])
    renderHook(() => useLocalDraft(initial.state, false, initial))
    act(() => {
      vi.advanceTimersByTime(1000)
      window.dispatchEvent(new Event('pagehide'))
    })
    expect(localStorage.getItem(DRAFT_KEY)).toBe(text)
  })

  it('saves and restores applied v3 source declarations', () => {
    vi.useFakeTimers()
    const initial = readLocalDraft()
    const source = createAvoidanceFixture()
    renderHook(() => useLocalDraft(source, false, initial))
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(readLocalDraft().state.avoidances).toEqual(source.avoidances)
    expect(localStorage.getItem(DRAFT_KEY)).not.toContain('avoid:avoid-1:arc')
  })
  it('treats an empty stored value as damaged data rather than an absent draft', () => {
    localStorage.setItem(DRAFT_KEY, '')
    expect(readLocalDraft().error).toContain('JSON')
    expect(localStorage.getItem(DRAFT_KEY)).toBe('')
  })
  it('restores valid data and leaves malformed stored data untouched', () => {
    localStorage.setItem(DRAFT_KEY, serializeProject(createArcFixture()))
    expect(readLocalDraft().state.segments[1].kind).toBe('arc')
    localStorage.setItem(DRAFT_KEY, '{broken')
    const failed = readLocalDraft()
    expect(failed.error).toMatch(/JSON/)
    expect(failed.state.vertices).toHaveLength(4)
    expect(localStorage.getItem(DRAFT_KEY)).toBe('{broken')
  })
  it('debounces saving, waits during a gesture, and clears without immediately recreating the draft', () => {
    vi.useFakeTimers()
    const initial = readLocalDraft()
    const { result, rerender } = renderHook(
      ({ state, busy }) => useLocalDraft(state, busy, initial),
      { initialProps: { state: initial.state, busy: false } },
    )
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(parseProject(localStorage.getItem(DRAFT_KEY)!).vertices).toHaveLength(4)
    rerender({ state: createArcFixture(), busy: true })
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(parseProject(localStorage.getItem(DRAFT_KEY)!).vertices).toHaveLength(4)
    rerender({ state: createArcFixture(), busy: false })
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(parseProject(localStorage.getItem(DRAFT_KEY)!).vertices).toHaveLength(2)
    act(() => {
      result.current.clear()
    })
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull()
    rerender({ state: createInitialState(), busy: false })
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(parseProject(localStorage.getItem(DRAFT_KEY)!).vertices).toHaveLength(4)
  })
  it('does not overwrite a broken draft on initial mount or page exit', () => {
    vi.useFakeTimers()
    localStorage.setItem(DRAFT_KEY, '{broken')
    const initial = readLocalDraft()
    renderHook(() => useLocalDraft(initial.state, false, initial))
    act(() => {
      vi.advanceTimersByTime(1000)
      window.dispatchEvent(new Event('pagehide'))
    })
    expect(localStorage.getItem(DRAFT_KEY)).toBe('{broken')
  })
  it('does not overwrite a broken draft when only its fallback project name changes', () => {
    vi.useFakeTimers()
    localStorage.setItem(DRAFT_KEY, '{broken')
    const initial = readLocalDraft()
    const { result, rerender } = renderHook(
      ({ name }) => useLocalDraft(initial.state, false, initial, name),
      { initialProps: { name: initial.name } },
    )
    rerender({ name: '新名称' })
    act(() => {
      vi.advanceTimersByTime(1000)
      window.dispatchEvent(new Event('pagehide'))
    })
    expect(localStorage.getItem(DRAFT_KEY)).toBe('{broken')
    expect(result.current.error).toContain('本地草稿无法恢复')
    act(() => result.current.saveNow(initial.state, '新名称'))
    expect(readLocalDraft().name).toBe('新名称')
    expect(readLocalDraft().recovered).toBe(true)
  })
  it('allows explicit file loading to replace a broken draft even when the document matches the fallback', () => {
    vi.useFakeTimers()
    localStorage.setItem(DRAFT_KEY, '{broken')
    const initial = readLocalDraft()
    const { result } = renderHook(() => useLocalDraft(initial.state, false, initial))
    act(() => {
      result.current.saveNow(initial.state)
    })
    expect(parseProject(localStorage.getItem(DRAFT_KEY)!).vertices).toHaveLength(4)
    expect(result.current.error).toBe('')
  })
  it('reports storage failure without losing the current document', () => {
    vi.useFakeTimers()
    const initial = readLocalDraft()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    const { result } = renderHook(() => useLocalDraft(initial.state, false, initial))
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(result.current.error).toContain('quota')
    expect(initial.state.vertices).toHaveLength(4)
  })
})
