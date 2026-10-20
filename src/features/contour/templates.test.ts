import { describe, expect, it } from 'vitest'
import { arcThrough, pointOnArc } from '../../lib/arc'
import type { ComplexPoint } from '../../lib/geometry'
import { parseProject, serializeProject } from '../project/project'
import type { ContourState } from './model'
import { contourReducer } from './model'
import { contourTemplates } from './templates'

function template(id: string) {
  return contourTemplates.find((item) => item.id === id)!.create()
}

function arcs(state: ContourState) {
  return state.segments.flatMap((segment, index) => {
    if (segment.kind !== 'arc') return []
    const result = arcThrough(
      state.vertices[index],
      state.vertices[(index + 1) % state.vertices.length],
      segment.through,
    )
    if (!result.ok) throw new Error(result.error)
    return [result.arc]
  })
}

// Independently evaluate the nonzero fill rule on a finely sampled boundary.
function winding(state: ContourState, point: ComplexPoint): number {
  const boundary = state.segments.flatMap((segment, index) => {
    const start = state.vertices[index]
    if (segment.kind === 'line') return [start]
    const result = arcThrough(
      start,
      state.vertices[(index + 1) % state.vertices.length],
      segment.through,
    )
    if (!result.ok) throw new Error(result.error)
    return Array.from({ length: 512 }, (_, i) => pointOnArc(result.arc, i / 512))
  })
  let turns = 0
  boundary.forEach((a, index) => {
    const b = boundary[(index + 1) % boundary.length]
    const cross = (b.re - a.re) * (point.im - a.im) - (point.re - a.re) * (b.im - a.im)
    if (a.im <= point.im && b.im > point.im && cross > 0) turns++
    if (a.im > point.im && b.im <= point.im && cross < 0) turns--
  })
  return turns
}

describe('editable contour templates', () => {
  it('creates valid connected geometry that round-trips through the existing project format', () => {
    expect(contourTemplates).toHaveLength(9)
    for (const preset of contourTemplates) {
      const state = preset.create()
      const loaded = parseProject(serializeProject(state))
      expect(loaded.vertices, preset.id).toEqual(state.vertices)
      expect(loaded.segments, preset.id).toEqual(state.segments)
      expect(loaded.markers, preset.id).toEqual(state.markers)
      expect(state.closed).toBe(true)
      expect(state.appearance.stroke.arrows).toBe(true)
      expect(contourReducer(state, { type: 'reverse' }).error).toBe('')
    }
  })

  it('returns fresh objects so editing one loaded template cannot corrupt future loads', () => {
    const first = template('keyhole')
    first.vertices[0].re = 99
    first.appearance.fill.color = '#ff0000'
    first.vertices[0].label!.tex = 'changed'
    const next = template('keyhole')
    expect(next.vertices[0].re).toBeLessThan(4)
    expect(next.vertices[0].label!.tex).not.toBe('changed')
    expect(next.appearance.fill.color).not.toBe('#ff0000')
  })

  it('uses a counterclockwise outer semicircle and a clockwise indentation excluding the pole', () => {
    const state = template('indented-semicircle')
    const [outer, inner] = arcs(state)
    expect(outer.sweep).toBeCloseTo(Math.PI)
    expect(inner.sweep).toBeCloseTo(-Math.PI)
    expect(winding(state, { re: 0, im: 2 })).toBe(1)
    expect(winding(state, { re: 0, im: 0.2 })).toBe(0)
    expect(winding(state, { re: 0, im: -0.2 })).toBe(0)
  })

  it.each(['keyhole', 'indented-keyhole'])(
    '%s excludes the inner disk and both sides of the branch cut from the fill',
    (id) => {
      const state = template(id)
      const [outer, ...inner] = arcs(state)
      expect(outer.sweep).toBeGreaterThan(Math.PI)
      expect(inner.every((arc) => arc.sweep < 0)).toBe(true)
      for (const point of [
        { re: -2, im: 0 },
        { re: 1, im: 1 },
        { re: 1, im: -1 },
      ])
        expect(winding(state, point)).toBe(1)
      for (const point of [
        { re: 0, im: 0 },
        { re: 1, im: 0 },
        { re: 2.8, im: 0 },
      ])
        expect(winding(state, point)).toBe(0)
    },
  )

  it('excludes a pole above and below the indented keyhole cut without disconnecting the path', () => {
    const state = template('indented-keyhole')
    expect(winding(state, { re: 2, im: 0.3 })).toBe(0)
    expect(winding(state, { re: 2, im: -0.3 })).toBe(0)
    expect(winding(state, { re: 2, im: 0.8 })).toBe(1)
    expect(winding(state, { re: 2, im: -0.8 })).toBe(1)
    expect(state.markers).toEqual([expect.objectContaining({ re: 2, im: 0 })])
  })

  it('runs upward on the Bromwich line and excludes the negative-real cut in its variant', () => {
    for (const id of ['bromwich', 'indented-bromwich']) {
      const state = template(id)
      const last = state.vertices.at(-1)!
      expect(last.re).toBeCloseTo(state.vertices[0].re)
      expect(last.im).toBeLessThan(state.vertices[0].im)
      expect(winding(state, { re: 1, im: 0 })).toBe(1)
    }
    const indented = template('indented-bromwich')
    expect(arcs(indented).map((arc) => Math.sign(arc.sweep))).toEqual([1, -1, 1])
    expect(winding(indented, { re: 0, im: 0 })).toBe(0)
    expect(winding(indented, { re: -2, im: 0 })).toBe(0)
    expect(winding(indented, { re: -2, im: 1 })).toBe(1)
  })
})
