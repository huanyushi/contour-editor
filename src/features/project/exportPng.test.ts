import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderPng } from './export'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('PNG allocation limits', () => {
  it.each([
    [0, 100, 1],
    [Infinity, 100, 1],
    [6000, 100, 3],
    [4000, 4000, 3],
  ] as const)(
    'rejects unsafe natural dimensions %s×%s at %s× before allocating a canvas',
    async (width, height, scale) => {
      // jsdom cannot decode images. Simulate only that browser boundary; the real
      // export path must reject dimensions before touching Canvas or its context.
      vi.stubGlobal(
        'Image',
        class {
          naturalWidth = width
          naturalHeight = height
          onload: (() => void) | null = null
          onerror: (() => void) | null = null
          set src(_url: string) {
            queueMicrotask(() => this.onload?.())
          }
        },
      )
      const revoke = vi.fn()
      vi.stubGlobal('URL', { createObjectURL: () => 'blob:test', revokeObjectURL: revoke })
      const create = vi.spyOn(document, 'createElement')
      await expect(renderPng('<svg/>', scale)).rejects.toThrow(/PNG.*尺寸|PNG.*范围/)
      expect(create).not.toHaveBeenCalledWith('canvas')
      expect(revoke).toHaveBeenCalledWith('blob:test')
    },
  )
})
