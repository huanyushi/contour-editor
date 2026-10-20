import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createInitialState, createSemicircleState } from '../contour/model'
import { parseProject, serializeProject } from './project'
import { DRAFT_KEY, readLocalDraft, useLocalDraft } from './useLocalDraft'

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  localStorage.clear()
})

describe('local draft recovery', () => {
  it('treats an empty stored value as damaged data rather than an absent draft', () => {
    localStorage.setItem(DRAFT_KEY, '')
    expect(readLocalDraft().error).toContain('JSON')
    expect(localStorage.getItem(DRAFT_KEY)).toBe('')
  })
  it('restores valid data and leaves malformed stored data untouched', () => {
    localStorage.setItem(DRAFT_KEY, serializeProject(createSemicircleState()))
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
    rerender({ state: createSemicircleState(), busy: true })
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(parseProject(localStorage.getItem(DRAFT_KEY)!).vertices).toHaveLength(4)
    rerender({ state: createSemicircleState(), busy: false })
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
