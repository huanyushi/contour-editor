import { expect, it } from 'vitest'
import { contourTemplates, createRectangleState } from './templates'
import { defaultLabel, defaultPointStyle } from './appearance'
import { makeAvoidanceTarget } from './avoidanceTarget'
import type { ContourState } from './model'

function target(state: ContourState, re: number, im: number) {
  state.markers = [
    {
      id: 'pole',
      re,
      im,
      mathematicalKind: 'isolated',
      label: defaultLabel(),
      pointStyle: defaultPointStyle(),
    },
  ]
  const result = makeAvoidanceTarget(state, 'pole', {
    renderedId: state.segments[0].id,
    point: { re: 0, im: 3 },
  })
  if (!result.ok) throw new Error(result.error)
  return result.value
}

it('uses a common mathematical radius on and off a source and independent of zoom', () => {
  const state = createRectangleState()
  const off = target(state, 0, 1)
  const on = target(state, 0, 0)
  state.viewport = { ...state.viewport, scaleX: 300, scaleY: 100 }
  expect(target(state, 0, 1).radius).toBe(off.radius)
  expect(on.radius).toBe(off.radius)
})

it('suggests about 0.4 at the center of the ordinary radius-three circle without template branching', () => {
  const state = contourTemplates.find((t) => t.id === 'circle')!.create()
  expect(target(state, 0, 0).radius).toBe(0.4)
  for (const p of state.vertices) {
    p.re *= 10
    p.im *= 10
  }
  state.segments = state.segments.map((s) =>
    s.kind === 'arc' ? { ...s, through: { re: s.through.re * 10, im: s.through.im * 10 } } : s,
  )
  expect(target(state, 0, 0).radius).toBe(4)
})

it('reuses the existing parent radius but does not copy a small child-clearance radius', () => {
  const state = createRectangleState()
  const first = target(state, -1, 1)
  first.radius = 0.55
  state.avoidances = [first]
  expect(target(state, 1, 1).radius).toBe(0.55)
})

it('does not shrink a fitting radius just because a different rectangle edge is shorter', () => {
  const state = createRectangleState()
  target(state, -4, 1.5)
  const result = makeAvoidanceTarget(state, 'pole', { renderedId: state.segments[3].id })
  expect(result).toMatchObject({ ok: true, value: { radius: 0.4 } })
})

it('shrinks only a default that cannot fit near an actual source endpoint', () => {
  const state = createRectangleState()
  const value = target(state, -3.9, 0)
  expect(value.radius).toBeLessThan(0.1)
  expect(value.radius).toBeGreaterThan(0)
})
