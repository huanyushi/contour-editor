import { describe, expect, it } from 'vitest'
import { createCustomPaletteStore, CUSTOM_PALETTE_KEY } from './customPalette'

describe('custom palette persistence', () => {
  it('persists canonical chosen colors for a fresh store without duplicates or invalid entries', () => {
    const store = createCustomPaletteStore()
    store.remember('#ABCDEF')
    store.remember('#abcdef')
    for (const invalid of ['red', '#abc', '#12345678', '#gggggg', ' #123456']) {
      store.remember(invalid)
    }
    expect(store.getSnapshot()).toEqual(['#abcdef'])
    expect(createCustomPaletteStore().getSnapshot()).toEqual(['#abcdef'])
    expect(JSON.parse(localStorage.getItem(CUSTOM_PALETTE_KEY)!)).toEqual(['#abcdef'])
  })

  it('refuses a ninth addition but replaces any existing slot even when full', () => {
    const store = createCustomPaletteStore()
    for (const color of [
      '#111111',
      '#222222',
      '#333333',
      '#444444',
      '#555555',
      '#666666',
      '#777777',
      '#888888',
      '#999999',
    ]) {
      store.remember(color)
    }
    expect(store.getSnapshot()).toEqual([
      '#111111',
      '#222222',
      '#333333',
      '#444444',
      '#555555',
      '#666666',
      '#777777',
      '#888888',
    ])
    store.remember('#ABCDEF', '#444444')
    expect(createCustomPaletteStore().getSnapshot()).toEqual([
      '#111111',
      '#222222',
      '#333333',
      '#abcdef',
      '#555555',
      '#666666',
      '#777777',
      '#888888',
    ])
    store.remember('#222222', '#ABCDEF')
    expect(store.getSnapshot()).toEqual([
      '#111111',
      '#222222',
      '#333333',
      '#555555',
      '#666666',
      '#777777',
      '#888888',
    ])
  })

  it('does not claim an existing duplicate as the chooser session replacement slot', () => {
    const store = createCustomPaletteStore()
    store.remember('#abcdef')
    let slot = store.remember('#111111')
    slot = store.remember('#ABCDEF', slot)
    slot = store.remember('#222222', slot)
    expect(store.getSnapshot()).toEqual(['#abcdef', '#222222'])
    expect(slot).toBe('#222222')
  })

  it('persists canonical deletion and frees one slot while keeping the eight-color limit', () => {
    const store = createCustomPaletteStore()
    for (const color of [
      '#abcdef',
      '#111111',
      '#222222',
      '#333333',
      '#444444',
      '#555555',
      '#666666',
      '#777777',
    ]) {
      store.remember(color)
    }
    store.remove('#ABCDEF')
    expect(createCustomPaletteStore().getSnapshot()).toEqual([
      '#111111',
      '#222222',
      '#333333',
      '#444444',
      '#555555',
      '#666666',
      '#777777',
    ])
    store.remove('invalid')
    store.remove('#abcdef')
    store.remember('#888888')
    store.remember('#999999')
    expect(createCustomPaletteStore().getSnapshot()).toEqual([
      '#111111',
      '#222222',
      '#333333',
      '#444444',
      '#555555',
      '#666666',
      '#777777',
      '#888888',
    ])
  })

  it.each(['{broken', 'null', '{}', '42'])(
    'recovers from corrupt storage %s and accepts the next choice',
    (raw) => {
      localStorage.setItem(CUSTOM_PALETTE_KEY, raw)
      const store = createCustomPaletteStore()
      expect(store.getSnapshot()).toEqual([])
      store.remember('#123456')
      expect(createCustomPaletteStore().getSnapshot()).toEqual(['#123456'])
    },
  )

  it('sanitizes persisted colors before enforcing the eight-slot limit', () => {
    localStorage.setItem(
      CUSTOM_PALETTE_KEY,
      JSON.stringify([
        null,
        '#ABCDEF',
        '#abcdef',
        'red',
        123,
        '#111111',
        '#222222',
        '#333333',
        '#444444',
        '#555555',
        '#666666',
        '#777777',
        '#888888',
      ]),
    )
    expect(createCustomPaletteStore().getSnapshot()).toEqual([
      '#abcdef',
      '#111111',
      '#222222',
      '#333333',
      '#444444',
      '#555555',
      '#666666',
      '#777777',
    ])
  })

  it('keeps the shared in-memory palette when storage access is unavailable', () => {
    const store = createCustomPaletteStore(() => {
      throw new DOMException('Storage blocked', 'SecurityError')
    })
    store.remember('#ABCDEF')
    store.remember('#abcdef')
    expect(store.getSnapshot()).toEqual(['#abcdef'])
    store.remember('#123456', '#abcdef')
    expect(store.getSnapshot()).toEqual(['#123456'])
    store.remove('#123456')
    expect(store.getSnapshot()).toEqual([])
  })

  it('retains memory after quota failure even when old storage can still be read', () => {
    localStorage.setItem(CUSTOM_PALETTE_KEY, '["#111111"]')
    const store = createCustomPaletteStore(() => ({
      getItem: (key) => localStorage.getItem(key),
      setItem: () => {
        throw new DOMException('Storage full', 'QuotaExceededError')
      },
    }))
    store.remember('#222222')
    expect(store.getSnapshot()).toEqual(['#111111', '#222222'])
    store.remember('#333333', '#222222')
    expect(store.getSnapshot()).toEqual(['#111111', '#333333'])
    store.remove('#111111')
    expect(store.getSnapshot()).toEqual(['#333333'])
  })
})
