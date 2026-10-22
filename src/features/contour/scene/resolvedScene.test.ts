import { describe, expect, it } from 'vitest'
import { createAvoidanceFixture } from '../../../test/avoidanceFixtures'
import { defaultLabel } from '../appearance'
import type { ContourState } from '../model'
import { resolveScene } from './resolvedScene'
import { createLegacyTemplateFixture, legacyTemplateIds } from '../../../test/legacyTemplates'
import { sourcePieceId } from '../sourcePieces'
import {
  findPoint,
  findResolvedSegment,
  findSegment,
  resolvedScene,
  scenePoints,
  sceneSegments,
  segmentOrigin,
  visibleSceneSegments,
} from './sceneObjects'

function resolve(state: ContourState) {
  const result = resolveScene(state)
  if (!result.ok) throw new Error(result.error)
  return result.scene
}

describe('source scene resolution', () => {
  it('replaces the source line without adding generated objects to the source document', () => {
    const state = createAvoidanceFixture()
    const snapshot = JSON.stringify(state)
    const scene = resolve(state)
    expect(scene.contourSegments).toHaveLength(6)
    const chain = scene.chains.get('edge-a')!
    expect(chain.map((s) => s.kind)).toEqual(['line', 'arc', 'line'])
    expect(chain[0].startId).toBe('a')
    expect(chain[0].endId).toBe(chain[1].startId)
    expect(chain[1].endId).toBe(chain[2].startId)
    expect(chain[2].endId).toBe('b')
    expect(scene.points.get(chain[1].startId)).toMatchObject({ re: -0.5, im: 0 })
    expect(scene.points.get(chain[1].endId)).toMatchObject({ re: 0.5, im: 0 })
    expect(chain[1]).toMatchObject({ id: 'avoid:avoid-1:arc', through: { re: 0, im: 0.5 } })
    expect(scene.connectionSegments).toHaveLength(0)
    expect(JSON.stringify(state)).toBe(snapshot)
    expect(state.vertices).toHaveLength(4)
    expect(state.segments).toHaveLength(4)
    expect(scene.points.size).toBe(7)
    expect(new Set(scene.contourSegments.map((s) => s.id)).size).toBe(6)
  })

  it('orders unordered bindings along the directed source, including reversed sources', () => {
    const state = createAvoidanceFixture()
    state.markers = [
      { ...state.markers[0], id: 'right', re: 2 },
      { ...state.markers[0], id: 'left', re: -2 },
    ]
    state.avoidances = [
      { ...state.avoidances[0], id: 'right-binding', markerId: 'right' },
      { ...state.avoidances[0], id: 'left-binding', markerId: 'left' },
    ]
    for (const reversed of [false, true]) {
      if (reversed) {
        state.segments = state.segments.map((s) => ({ ...s, startId: s.endId, endId: s.startId }))
      }
      const chain = resolve(state).chains.get('edge-a')!
      expect(chain).toHaveLength(5)
      expect(chain.filter((s) => s.kind === 'arc').map((s) => s.id)).toEqual(
        reversed
          ? ['avoid:right-binding:arc', 'avoid:left-binding:arc']
          : ['avoid:left-binding:arc', 'avoid:right-binding:arc'],
      )
      for (let i = 1; i < chain.length; i++) expect(chain[i].startId).toBe(chain[i - 1].endId)
    }
  })

  it('expands independent connections separately and excludes formulas from endpoints', () => {
    const state = createAvoidanceFixture()
    state.connections = [{ id: 'chord', kind: 'line', startId: 'a', endId: 'c' }]
    state.markers[0].im = 1.5
    state.avoidances[0].targetSegmentId = 'chord'
    state.formulas = [{ ...state.markers[0], id: 'formula' }]
    const scene = resolve(state)
    expect(scene.contourSegments.map((s) => s.id)).toEqual(['edge-a', 'edge-b', 'edge-c', 'edge-d'])
    expect(scene.connectionSegments).toHaveLength(3)
    expect(scene.connectionSegments.every((s) => s.origin.collection === 'connection')).toBe(true)
    expect(scene.chains.get('chord')).toEqual(scene.connectionSegments)
    expect(scene.points.has('formula')).toBe(false)
    expect(scene.points.has('pole')).toBe(true)
  })

  it('determines active source edges before expansion but validates hidden bindings', () => {
    const state = createAvoidanceFixture()
    state.closed = false
    state.markers[0] = { ...state.markers[0], re: -4, im: 1.5 }
    state.segments[3].label = defaultLabel('hidden')
    state.avoidances[0].targetSegmentId = 'edge-d'
    const scene = resolve(state)
    expect(scene.contourSegments.map((s) => s.id)).toEqual(['edge-a', 'edge-b', 'edge-c'])
    expect(scene.chains.has('edge-d')).toBe(false)
    expect([...scene.points.keys()].some((id) => id.includes(':'))).toBe(false)
    expect(scene.labels).toHaveLength(0)
    expect(scene.origins.get('edge-d')).toMatchObject({ kind: 'source', collection: 'contour' })
    expect(resolve({ ...state, closed: true }).contourSegments).toHaveLength(6)
    state.avoidances[0].radius = 2
    expect(resolveScene(state)).toMatchObject({
      ok: false,
      error: expect.stringContaining('avoid-1'),
    })
  })

  it('keeps all surviving edges of disconnected source chains regardless of array order', () => {
    const state = createAvoidanceFixture()
    state.segments = [state.segments[2], state.segments[0]]
    state.closed = false
    const scene = resolve(state)
    expect(scene.contourSegments).toHaveLength(4)
    expect(scene.chains.get('edge-c')).toHaveLength(1)
    expect(scene.chains.get('edge-a')).toHaveLength(3)
  })

  it.each(legacyTemplateIds)(
    'preserves the old unbound %s geometry and source IDs without migrating it',
    (id) => {
      const state = createLegacyTemplateFixture(id)
      const snapshot = JSON.stringify(state)
      expect(state.avoidances).toEqual([])
      const scene = resolve(state)
      expect(scene.contourSegments).toHaveLength(state.segments.length)
      expect(scene.contourSegments).toMatchObject(state.segments)
      expect([...scene.points.values()]).toEqual([...state.vertices, ...state.markers])
      expect(scene.chains.size).toBe(state.segments.length)
      expect(JSON.stringify(state)).toBe(snapshot)
    },
  )
})

describe('resolved origins, styles and labels', () => {
  it('records source, gap and part origins, including omitted connectors', () => {
    const scene = resolve(createAvoidanceFixture())
    const chain = scene.chains.get('edge-a')!
    expect(chain.map((s) => s.origin.kind)).toEqual(['gap', 'avoidance', 'gap'])
    expect(scene.origins.get('edge-a')).toEqual({
      kind: 'source',
      sourceSegmentId: 'edge-a',
      collection: 'contour',
    })
    for (const part of ['entry', 'arc', 'exit']) {
      expect(scene.origins.get(`avoid:avoid-1:${part}`)).toEqual({
        kind: 'avoidance',
        sourceSegmentId: 'edge-a',
        collection: 'contour',
        avoidanceId: 'avoid-1',
        part,
      })
    }
    for (const s of scene.contourSegments) expect(scene.origins.get(s.id)).toEqual(s.origin)
  })

  it('inherits final source styles and applies overrides only to the corresponding part', () => {
    const state = createAvoidanceFixture()
    state.markers[0].im = 2
    state.appearance.stroke.width = 3
    state.segments[0].style = { color: '#123456', dash: 'dashed' }
    state.avoidances[0].partStyles = { arc: { color: '#abcdef' }, exit: { width: 5 } }
    const chain = resolve(state).chains.get('edge-a')!
    expect(chain).toHaveLength(5)
    expect(chain[1]).toMatchObject({
      id: 'avoid:avoid-1:entry',
      style: { color: '#123456', width: 3, dash: 'dashed' },
    })
    expect(chain[2]).toMatchObject({ style: { color: '#abcdef', width: 3, dash: 'dashed' } })
    expect(chain[3]).toMatchObject({
      id: 'avoid:avoid-1:exit',
      style: { color: '#123456', width: 5 },
    })
  })

  it('keeps one inherited source label on the first retained object, separate from the detour label', () => {
    const state = createAvoidanceFixture()
    state.segments[0].label = defaultLabel('C')
    state.avoidances[0].partLabels = { arc: defaultLabel('C_r') }
    const scene = resolve(state)
    expect(scene.labels).toHaveLength(2)
    const id = sourcePieceId('edge-a', { startAvoidanceId: null, endAvoidanceId: 'avoid-1' })
    const source = scene.labels.find((label) => label.target.id === id)!
    expect(source.target).toEqual({ kind: 'segment', id, part: 'label' })
    expect(source.value).toEqual(defaultLabel('C'))
    expect(source.anchor.re).toBeCloseTo(-2.25)
    expect(source.anchor.im).toBeCloseTo(0)
    const arcAnchor = scene.labels.find((label) => label.target.id === 'avoid:avoid-1:arc')!.anchor
    expect(arcAnchor.re).toBeCloseTo(0, 12)
    expect(arcAnchor.im).toBeCloseTo(0.5, 12)
    expect(scene.chains.get('edge-a')!.filter((s) => s.label?.tex === 'C')).toHaveLength(0)
  })

  it('does not move an inherited retained-piece label onto the expanded detour', () => {
    const state = createAvoidanceFixture()
    state.markers[0].re = -2
    state.segments[0].label = defaultLabel('C')
    const anchor = resolve(state).labels[0].anchor
    expect(anchor.re).toBeCloseTo(-3.25)
    expect(anchor.im).toBe(0)
  })

  it('hides vanished connector labels without changing settings and restores them when nonzero', () => {
    const state = createAvoidanceFixture()
    state.markers[0].im = 0.1
    state.avoidances[0].partLabels = {
      entry: defaultLabel('in'),
      arc: defaultLabel('arc'),
      exit: defaultLabel('out'),
    }
    const snapshot = JSON.stringify(state)
    const vanished = resolve(state)
    expect(vanished.chains.get('edge-a')).toHaveLength(3)
    expect(vanished.labels.map((l) => l.target.id)).toEqual(['avoid:avoid-1:arc'])
    expect(vanished.points.size).toBe(7)
    expect(JSON.stringify(state)).toBe(snapshot)
    const restored = resolve({ ...state, markers: [{ ...state.markers[0], im: 2 }] })
    expect(restored.labels.map((l) => l.target.id)).toEqual([
      'avoid:avoid-1:entry',
      'avoid:avoid-1:arc',
      'avoid:avoid-1:exit',
    ])
    expect(restored.labels[0].anchor.re).toBeCloseTo(-0.25)
    expect(restored.labels[0].anchor.im).toBeCloseTo((2 - Math.sqrt(3) / 4) / 2)
  })
})

describe('source validation before expansion', () => {
  const invalidSources: [string, (state: ContourState) => void, RegExp][] = [
    [
      'duplicate object IDs across collections',
      (s) => {
        s.formulas = [{ ...s.markers[0], id: 'a' }]
      },
      /a/,
    ],
    [
      'binding IDs colliding with source objects',
      (s) => {
        s.avoidances[0].id = 'pole'
      },
      /pole/,
    ],
    [
      'duplicate binding IDs',
      (s) => {
        s.avoidances.push({ ...s.avoidances[0] })
      },
      /avoid-1/,
    ],
    [
      'reserved derived namespaces in source IDs',
      (s) => {
        s.formulas = [{ ...s.markers[0], id: 'avoid:bad' }]
      },
      /avoid:bad/,
    ],
    [
      'reserved namespaces in binding IDs',
      (s) => {
        s.avoidances[0].id = 'bad:id'
      },
      /bad:id/,
    ],
    [
      'missing bound markers',
      (s) => {
        s.avoidances[0].markerId = 'missing'
      },
      /missing/,
    ],
    [
      'formulas used as bound markers',
      (s) => {
        s.formulas = [{ ...s.markers[0], id: 'formula' }]
        s.avoidances[0].markerId = 'formula'
      },
      /formula/,
    ],
    [
      'ordinary bound markers',
      (s) => {
        s.markers[0].mathematicalKind = 'ordinary'
      },
      /pole/,
    ],
    [
      'legacy untyped bound markers',
      (s) => {
        delete s.markers[0].mathematicalKind
      },
      /pole/,
    ],
    [
      'missing target segments',
      (s) => {
        s.avoidances[0].targetSegmentId = 'missing'
      },
      /missing/,
    ],
    [
      'arc targets',
      (s) => {
        s.segments[0] = { ...s.segments[0], kind: 'arc', through: { re: 0, im: 1 } }
      },
      /edge-a/,
    ],
    [
      'duplicate marker-target pairs',
      (s) => {
        s.avoidances.push({ ...s.avoidances[0], id: 'duplicate' })
      },
      /duplicate/,
    ],
    [
      'missing hidden source endpoints',
      (s) => {
        s.closed = false
        s.segments[3].endId = 'missing'
      },
      /edge-d/,
    ],
    [
      'formula connection endpoints',
      (s) => {
        s.formulas = [{ ...s.markers[0], id: 'formula' }]
        s.connections = [{ id: 'link', kind: 'line', startId: 'a', endId: 'formula' }]
      },
      /link/,
    ],
    [
      'branched contour topology',
      (s) => {
        s.segments[1].startId = 'a'
      },
      /拓扑|分叉/,
    ],
    [
      'invalid unbound arcs',
      (s) => {
        s.segments[1] = { ...s.segments[1], kind: 'arc', through: { re: 4, im: 1 } }
      },
      /edge-b/,
    ],
    [
      'nonfinite source coordinates',
      (s) => {
        s.markers[0].re = Infinity
      },
      /pole/,
    ],
    [
      'invalid binding parameters',
      (s) => {
        s.avoidances[0].radius = 0
      },
      /avoid-1/,
    ],
  ]
  it.each(invalidSources)(
    'rejects %s with context without mutating the candidate',
    (_name, mutate, error) => {
      const state = createAvoidanceFixture()
      mutate(state)
      const snapshot = JSON.stringify(state)
      expect(resolveScene(state)).toMatchObject({ ok: false, error: expect.stringMatching(error) })
      expect(JSON.stringify(state)).toBe(snapshot)
    },
  )
})

describe('accepted-state queries', () => {
  it('keeps source queries unchanged while resolving derived points, parts and source origins separately', () => {
    const state = { ...createAvoidanceFixture(), closed: false }
    const scene = resolvedScene(state)
    const arc = findResolvedSegment(state, 'avoid:avoid-1:arc')!
    expect(arc.kind).toBe('arc')
    expect(scene.points.get(arc.startId)).toMatchObject({ re: -0.5, im: 0 })
    expect(scene.points.get('pole')).toBe(state.markers[0])
    expect(findResolvedSegment(state, 'edge-a')).toBeUndefined()
    expect(findResolvedSegment(state, 'edge-d')).toBeUndefined()
    expect(findResolvedSegment(state, 'missing')).toBeUndefined()
    expect(scene.points.get('missing')).toBeUndefined()
    expect(segmentOrigin(state, arc.id)).toEqual(arc.origin)
    expect(segmentOrigin(state, 'avoid:avoid-1:entry')).toMatchObject({
      avoidanceId: 'avoid-1',
      part: 'entry',
    })
    expect(segmentOrigin(state, 'edge-a')).toMatchObject({
      kind: 'source',
      sourceSegmentId: 'edge-a',
    })
    expect(segmentOrigin(state, 'edge-d')).toMatchObject({
      kind: 'source',
      sourceSegmentId: 'edge-d',
    })
    expect(segmentOrigin(state, 'missing')).toBeUndefined()
    expect(findSegment(state, 'edge-a')).toBe(state.segments[0])
    expect(findSegment(state, 'edge-d')).toBe(state.segments[3])
    expect(findSegment(state, arc.id)).toBeUndefined()
    expect(findPoint(state, arc.startId)).toBeUndefined()
    expect(scenePoints(state).map((p) => p.id)).toEqual(['a', 'b', 'c', 'd', 'pole'])
    expect(sceneSegments(state)).toEqual(state.segments)
    expect(visibleSceneSegments(state)).toEqual(state.segments.slice(0, -1))
    expect(resolvedScene(state)).toBe(scene)
    expect(findResolvedSegment(state, arc.id)).toBe(arc)
    expect(state).not.toHaveProperty('resolvedScene')
    const next = { ...state, markers: [{ ...state.markers[0], im: 2 }] }
    expect(resolvedScene(next)).not.toBe(scene)
    expect(resolvedScene(next).chains.get('edge-a')).toHaveLength(5)
    expect(resolvedScene(state).chains.get('edge-a')).toHaveLength(3)
  })

  it('returns a reason for candidates but throws a contextual invariant for invalid accepted states', () => {
    const state = createAvoidanceFixture()
    state.avoidances[0].radius = 0
    expect(resolveScene(state)).toMatchObject({ ok: false })
    expect(() => resolvedScene(state)).toThrow(/invariant.*avoid-1.*半径/)
  })
})
