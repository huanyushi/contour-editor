import { describe, expect, it } from 'vitest'
import { arcThrough, pointOnArc } from '../../lib/arc'
import type { ComplexPoint } from '../../lib/geometry'
import { parseProject, serializeProject } from '../project/project'
import type { ContourState } from './model'
import { contourReducer } from './model'
import { contourTemplates } from './templates'
import { resolveScene } from './resolvedScene'
import { createLegacyTemplateFixture } from '../../test/legacyTemplates'
import { defaultFill, defaultStroke } from './appearance'

const boundTemplates = ['indented-semicircle', 'keyhole', 'indented-keyhole', 'indented-bromwich']

function template(id: string) {
  return contourTemplates.find((item) => item.id === id)!.create()
}

function arcs(state: ContourState) {
  const scene = sceneFor(state)
  return scene.contourSegments.flatMap((segment) => {
    if (segment.kind !== 'arc') return []
    const result = arcThrough(
      scene.points.get(segment.startId)!,
      scene.points.get(segment.endId)!,
      segment.through,
    )
    if (!result.ok) throw new Error(result.error)
    return [result.arc]
  })
}

function sceneFor(state: ContourState) {
  const result = resolveScene(state)
  if (!result.ok) throw new Error(result.error)
  return result.scene
}

function boundary(state: ContourState): ComplexPoint[] {
  const scene = sceneFor(state)
  const outgoing = new Map(scene.contourSegments.map((s) => [s.startId, s]))
  const first = scene.contourSegments[0]
  let current = first
  const points: ComplexPoint[] = []
  const visited = new Set<string>()
  do {
    if (visited.has(current.id)) throw new Error('Boundary does not return to its initial segment')
    visited.add(current.id)
    const start = scene.points.get(current.startId)!
    if (current.kind === 'line') points.push(start)
    else {
      const result = arcThrough(start, scene.points.get(current.endId)!, current.through)
      if (!result.ok) throw new Error(result.error)
      points.push(...Array.from({ length: 512 }, (_, i) => pointOnArc(result.arc, i / 512)))
    }
    current = outgoing.get(current.endId)!
  } while (current && current !== first)
  return points
}

// Independently evaluate the nonzero fill rule on a finely sampled boundary.
function winding(state: ContourState, point: ComplexPoint): number {
  return boundaryWinding(boundary(state), point)
}

function boundaryWinding(boundary: ComplexPoint[], point: ComplexPoint): number {
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
      expect(loaded.avoidances, preset.id).toEqual(state.avoidances)
      expect(state.closed).toBe(true)
      expect(state.appearance.stroke.arrows).toBe(true)
      expect(contourReducer(state, { type: 'reverse' }).error).toBe('')
    }
  })

  it.each([
    ['indented-semicircle', 'isolated', 1],
    ['keyhole', 'branch', 1],
    ['indented-keyhole', 'branch', 2],
    ['indented-bromwich', 'branch', 1],
  ] as const)(
    '%s stores editable bindings rather than calculated detour vertices',
    (id, kind, count) => {
      const state = template(id)
      expect(state.vertices).toHaveLength(2)
      expect(state.segments).toHaveLength(2)
      expect(state.avoidances).toHaveLength(count)
      const parent = state.avoidances[0]
      expect(state.markers.find((m) => m.id === parent.markerId)).toMatchObject({
        re: 0,
        im: 0,
        mathematicalKind: kind,
      })
      expect(parent.kind).toBe(id === 'indented-semicircle' ? undefined : 'corridor')
      if (id === 'indented-keyhole') {
        expect(state.avoidances[1]).toMatchObject({
          kind: 'bank-clearance',
          parentAvoidanceId: parent.id,
        })
        expect(state.markers.find((m) => m.id === state.avoidances[1].markerId)).toMatchObject({
          mathematicalKind: 'isolated',
          re: 2,
          im: 0,
        })
      }
      const scene = sceneFor(state)
      const outgoing = new Map(scene.contourSegments.map((s) => [s.startId, s]))
      const visited = new Set<string>()
      let current = scene.contourSegments[0]
      while (!visited.has(current.id)) {
        visited.add(current.id)
        expect(outgoing.has(current.endId)).toBe(true)
        current = outgoing.get(current.endId)!
      }
      expect(current).toBe(scene.contourSegments[0])
      expect(visited.size).toBe(scene.contourSegments.length)
    },
  )

  it.each(['circle', 'semicircle', 'sector', 'rectangle', 'bromwich'])(
    '%s keeps its ordinary base geometry without artificial singularities',
    (id) => {
      expect(template(id).avoidances).toEqual([])
    },
  )

  it.each(contourTemplates)(
    '$id matches the old oriented region outside the allowed local radius/opening changes',
    (preset) => {
      // Frozen from the original nine templates before this refactor, not recomputed by the new builders.
      const old = createLegacyTemplateFixture(
        preset.id as Parameters<typeof createLegacyTemplateFixture>[0],
      )
      const before = boundary(old)
      const after = boundary(preset.create())
      let compared = 0
      for (let x = -5; x <= 5; x += 0.35) {
        for (let y = -5; y <= 5; y += 0.35) {
          const point = { re: x + 0.071, im: y + 0.113 }
          if (
            ['indented-semicircle', 'keyhole', 'indented-keyhole', 'indented-bromwich'].includes(
              preset.id,
            )
          ) {
            if (Math.hypot(point.re, point.im) < 0.7) continue
            if (preset.id === 'indented-keyhole' && Math.hypot(point.re - 2, point.im) < 0.6)
              continue
            if (preset.id.includes('keyhole') && point.re > 0 && Math.abs(point.im) < 0.2) continue
            if (preset.id === 'indented-bromwich' && point.re < 0 && Math.abs(point.im) < 0.2)
              continue
          }
          expect(boundaryWinding(after, point), `${preset.id} at (${point.re}, ${point.im})`).toBe(
            boundaryWinding(before, point),
          )
          compared++
        }
      }
      expect(compared).toBeGreaterThan(750)
    },
  )

  it('returns fresh objects so editing one loaded template cannot corrupt future loads', () => {
    const first = template('keyhole')
    first.vertices[0].re = 99
    first.appearance.fill.color = '#ff0000'
    first.vertices[0].label!.tex = 'changed'
    first.avoidances[0].radius = 9
    first.avoidances[0].partLabels!.arc!.tex = 'changed'
    const next = template('keyhole')
    expect(next.vertices[0].re).toBeLessThan(4)
    expect(next.vertices[0].label!.tex).not.toBe('changed')
    expect(next.appearance.fill.color).not.toBe('#ff0000')
    expect(next.avoidances[0].radius).toBe(0.5)
    expect(next.avoidances[0].partLabels!.arc!.tex).toBe('C_\\delta')
  })

  it.each([
    ['indented-semicircle', 0.4],
    ['keyhole', 0.5],
    ['indented-keyhole', 0.5],
    ['indented-bromwich', 0.5],
  ] as const)(
    '%s uses current drawing defaults including followable corridor parameters',
    (id, radius) => {
      const state = template(id)
      expect(state.appearance.stroke).toEqual(defaultStroke())
      expect(state.appearance.fill).toEqual(defaultFill())
      expect(state.avoidances[0].radius).toBe(radius)
      if (id !== 'indented-semicircle') {
        expect(state.avoidances[0]).toMatchObject({ gap: 0.3, alignment: { kind: 'normal' } })
      }
      expect(state.avoidances.every((a) => a.partStyles === undefined)).toBe(true)
    },
  )

  it.each(boundTemplates)(
    '%s remains editable through bindings, reverses direction and restores its source on removal',
    (id) => {
      const state = template(id)
      for (const a of state.avoidances) {
        const resized = contourReducer(state, {
          type: 'updateAvoidance',
          id: a.id,
          patch: { radius: a.radius * 1.1 },
        })
        expect(resized.error).toBe('')
        expect(resized.avoidances.find((item) => item.id === a.id)!.radius).toBeCloseTo(
          a.radius * 1.1,
        )
        expect(boundary(resized)).not.toEqual(boundary(state))
        expect(parseProject(serializeProject(resized)).avoidances).toEqual(resized.avoidances)
      }
      const parent = state.avoidances[0]
      if (parent.kind === 'corridor') {
        const resized = contourReducer(state, {
          type: 'updateAvoidance',
          id: parent.id,
          patch: { gap: 0.24 },
        })
        expect(resized.error).toBe('')
        expect(boundary(resized)).not.toEqual(boundary(state))
        expect(resized.avoidances).toHaveLength(state.avoidances.length)
      }
      for (const marker of state.markers) {
        // Normal following on the finite Bromwich arc is valid toward its left
        // side; the missing right-hand circle sector is not a source path.
        const re = marker.re + (id === 'indented-bromwich' ? -0.05 : 0.05)
        const moved = contourReducer(state, {
          type: 'moveObject',
          kind: 'marker',
          id: marker.id,
          point: { re, im: marker.im },
        })
        expect(moved.error).toBe('')
        expect(moved.markers.find((m) => m.id === marker.id)!.re).toBeCloseTo(re)
        expect(boundary(moved)).not.toEqual(boundary(state))
        expect(moved.avoidances).toHaveLength(state.avoidances.length)
      }
      const reversed = contourReducer(state, { type: 'reverse' })
      expect(reversed.error).toBe('')
      const inside = id.includes('keyhole') ? { re: -2, im: 1 } : { re: 0, im: 2 }
      expect(winding(state, inside)).toBe(1)
      expect(winding(reversed, inside)).toBe(-1)
      expect(winding(reversed, { re: 0, im: 0 })).toBe(0)
      expect(
        winding(reversed, {
          re: id.includes('keyhole') ? 2 : -2,
          im: id === 'indented-semicircle' ? -0.2 : 0,
        }),
      ).toBe(0)
      expect(reversed.avoidances).toHaveLength(state.avoidances.length)
      if (state.avoidances.length > 1) {
        const withoutChild = contourReducer(state, {
          type: 'removeAvoidance',
          id: state.avoidances[1].id,
        })
        expect(withoutChild.error).toBe('')
        expect(withoutChild.avoidances).toHaveLength(1)
        expect(winding(withoutChild, { re: 2, im: 0.2 })).toBe(1)
      }
      const restored = contourReducer(state, { type: 'removeAvoidance', id: parent.id })
      expect(restored.error).toBe('')
      expect(restored.avoidances).toEqual([])
      expect(sceneFor(restored).contourSegments).toHaveLength(2)
      expect(restored.markers).toEqual(state.markers)
    },
  )

  it('atomically rejects a Bromwich normal-follow move toward the missing circular sector', () => {
    const state = template('indented-bromwich')
    const next = contourReducer(state, {
      type: 'moveObject',
      kind: 'marker',
      id: 'origin',
      point: { re: 0.05, im: 0 },
    })
    expect(next.error).not.toBe('')
    expect(next.markers).toEqual(state.markers)
    expect(next.avoidances).toEqual(state.avoidances)
    expect(boundary(next)).toEqual(boundary(state))
  })

  it('uses a counterclockwise outer semicircle and a clockwise indentation excluding the pole', () => {
    const state = template('indented-semicircle')
    const all = arcs(state)
    const outer = all.find((arc) => arc.radius > 3)!
    const inner = all.find((arc) => arc.radius < 1)!
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
      const all = arcs(state)
      const outer = all.filter((arc) => arc.radius > 3)
      const inner = all.filter((arc) => arc.radius < 1)
      expect(outer.reduce((s, arc) => s + arc.sweep, 0)).toBeGreaterThan(Math.PI)
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
    expect(winding(state, { re: 2, im: 0.2 })).toBe(0)
    expect(winding(state, { re: 2, im: -0.2 })).toBe(0)
    expect(winding(state, { re: 2, im: 0.8 })).toBe(1)
    expect(winding(state, { re: 2, im: -0.8 })).toBe(1)
    expect(state.markers).toContainEqual(expect.objectContaining({ re: 2, im: 0 }))
  })

  it('uses the same half-unit radius for all three small arcs in the indented keyhole', () => {
    const state = template('indented-keyhole')
    expect(state.avoidances.map((a) => a.radius)).toEqual([0.5, 0.5])
    const smallArcs = arcs(state).filter((arc) => arc.radius < 1)
    expect(smallArcs).toHaveLength(3)
    for (const arc of smallArcs) expect(arc.radius).toBeCloseTo(0.5, 12)
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
    expect(
      arcs(indented)
        .map((arc) => Math.sign(arc.sweep))
        .sort(),
    ).toEqual([-1, 1, 1])
    expect(winding(indented, { re: 0, im: 0 })).toBe(0)
    expect(winding(indented, { re: -2, im: 0 })).toBe(0)
    expect(winding(indented, { re: -2, im: 1 })).toBe(1)
  })
})
