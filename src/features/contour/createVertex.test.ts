import { expect, it } from 'vitest'
import { createInitialState } from './model'
import { createVertex } from './createVertex'

it('avoids restored vertex and retained edge IDs when creating new objects', () => {
  const state = createInitialState()
  state.vertices = Array.from({ length: 50 }, (_, index) => ({
    id: `vertex-${index}`,
    re: index,
    im: 0,
  }))
  state.segments = [{ kind: 'line', id: 'edge-vertex-50', startId: 'vertex-0', endId: 'vertex-1' }]
  const vertex = createVertex({ re: 0, im: 0 }, state)
  expect(state.vertices.some((point) => point.id === vertex.id)).toBe(false)
  expect(state.segments.some((segment) => segment.id === `edge-${vertex.id}`)).toBe(false)
})
