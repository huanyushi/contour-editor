import { describe, expect, it, vi } from 'vitest'
import { createArcFixture } from '../../test/fixtures'
import { createAvoidanceFixture } from '../../test/avoidanceFixtures'
import { serializeProject } from './project'
import { DRAFT_KEY, DRAFT_NAME_KEY, readLocalDraft } from './legacyLocalDraft'

describe('read-only legacy draft recovery', () => {
  it('uses the default rectangle and ignores an orphan name without creating storage', () => {
    localStorage.setItem(DRAFT_NAME_KEY, '旧名称')
    const result = readLocalDraft()
    expect(result.name).toBe('Untitled')
    expect(result.state.vertices).toHaveLength(4)
    expect(result.recovered).toBe(false)
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull()
    expect(localStorage.getItem(DRAFT_NAME_KEY)).toBe('旧名称')
  })

  it('reads geometry and normalizes the stored name without changing either record', () => {
    const text = serializeProject(createArcFixture())
    localStorage.setItem(DRAFT_KEY, text)
    localStorage.setItem(DRAFT_NAME_KEY, '  旧作品  ')
    const result = readLocalDraft()
    expect(result.state.segments[1].kind).toBe('arc')
    expect(result.name).toBe('旧作品')
    expect(result.recovered).toBe(true)
    expect(result.error).toBe('')
    expect(localStorage.getItem(DRAFT_KEY)).toBe(text)
    expect(localStorage.getItem(DRAFT_NAME_KEY)).toBe('  旧作品  ')
  })

  it.each([null, '   '])('uses the default name for missing or blank metadata: %s', (name) => {
    localStorage.setItem(DRAFT_KEY, serializeProject(createArcFixture()))
    if (name !== null) localStorage.setItem(DRAFT_NAME_KEY, name)
    expect(readLocalDraft().name).toBe('Untitled')
  })

  it('keeps geometry recoverable when the name record cannot be read', () => {
    localStorage.setItem(DRAFT_KEY, serializeProject(createArcFixture()))
    const get = Storage.prototype.getItem
    const fail = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (
      this: Storage,
      key,
    ) {
      if (key === DRAFT_NAME_KEY) throw new Error('metadata unavailable')
      return get.call(this, key)
    })
    const result = readLocalDraft()
    fail.mockRestore()
    expect(result.state.segments[1].kind).toBe('arc')
    expect(result.recovered).toBe(true)
    expect(result.name).toBe('Untitled')
    expect(result.error).toContain('metadata unavailable')
  })

  it.each(['', '{broken'])('reports malformed data without replacing it: %s', (text) => {
    localStorage.setItem(DRAFT_KEY, text)
    const result = readLocalDraft()
    expect(result.error).toMatch(/JSON/)
    expect(result.recovered).toBe(false)
    expect(localStorage.getItem(DRAFT_KEY)).toBe(text)
  })

  it('rejects invalid avoidance bindings and preserves their original JSON', () => {
    const file = JSON.parse(serializeProject(createAvoidanceFixture()))
    file.document.avoidances[0].markerId = 'missing'
    const text = JSON.stringify(file)
    localStorage.setItem(DRAFT_KEY, text)
    expect(readLocalDraft().error).toMatch(/avoid-1.*missing/)
    expect(localStorage.getItem(DRAFT_KEY)).toBe(text)
  })

  it('reports denied storage access while keeping the fallback document usable', () => {
    const fail = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage denied')
    })
    const result = readLocalDraft()
    fail.mockRestore()
    expect(result.error).toContain('storage denied')
    expect(result.recovered).toBe(false)
    expect(result.state.vertices).toHaveLength(4)
  })
})
