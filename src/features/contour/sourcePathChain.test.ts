import { expect, it } from 'vitest'
import { contourTemplates } from './templates'
import { canonicalSourceAnchor, sourceChainForSegment } from './sourcePathChain'

it('uses stable endpoints rather than array order to find a source component', () => {
  const state = contourTemplates.find((t) => t.id === 'rectangle')!.create()
  state.segments = [state.segments[2], state.segments[0], state.segments[3], state.segments[1]]
  const result = sourceChainForSegment(state, 'edge-a')
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(result.error)
  expect(result.value.cyclic).toBe(true)
  for (let i = 0; i < result.value.edges.length; i++) {
    expect(result.value.edges[i].endId).toBe(result.value.edges[(i + 1) % 4].startId)
  }
  expect(canonicalSourceAnchor(result.value, 'edge-a', 0)).toEqual({
    ok: true,
    value: { kind: 'vertex', vertexId: 'a', segmentId: 'edge-a' },
  })
})

it('does not merge disconnected paths whose endpoint coordinates coincide', () => {
  const state = contourTemplates.find((t) => t.id === 'rectangle')!.create()
  state.segments = [state.segments[0], state.segments[2]]
  const result = sourceChainForSegment(state, 'edge-a')
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(result.error)
  expect(result.value.edges.map((s) => s.id)).toEqual(['edge-a'])
  expect(result.value.cyclic).toBe(false)
})

it('keeps an independent connection separate from the contour at shared IDs', () => {
  const state = contourTemplates.find((t) => t.id === 'rectangle')!.create()
  state.connections = [{ id: 'diagonal', kind: 'line', startId: 'a', endId: 'c' }]
  const result = sourceChainForSegment(state, 'diagonal')
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(result.error)
  expect(result.value.edges.map((s) => s.id)).toEqual(['diagonal'])
  expect(result.value.cyclic).toBe(false)
})
