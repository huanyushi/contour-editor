import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createInitialState } from '../contour/model'
import { createArcFixture } from '../../test/fixtures'
import { createAvoidanceFixture } from '../../test/avoidanceFixtures'
import { parseProject, serializeProject } from './project'
import { DRAFT_KEY, readLocalDraft, useLocalDraft } from './useLocalDraft'

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  localStorage.clear()
})

describe('local draft recovery', () => {
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
