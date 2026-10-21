import { describe, expect, it } from 'vitest'
import { createAvoidanceFixture } from '../../test/avoidanceFixtures'
import { toSvg } from '../../lib/geometry'
import { contourReducer, createInitialState } from '../contour/model'
import { defaultLabel } from '../contour/appearance'
import { resolveScene } from '../contour/resolvedScene'
import { canProjectScene } from '../contour/sceneView'
import { projectCapacityError } from './format'
import { MAX_PROJECT_BYTES, parseProject, serializeProject, type ProjectFile } from './project'

interface RawFile {
  version: number
  document: Omit<ProjectFile['document'], 'avoidances' | 'markers'> & {
    avoidances: Record<string, unknown>[]
    markers: Record<string, unknown>[]
  }
}

function rawFixture(): RawFile {
  // Deliberately untrusted JSON: each mutation exercises the actual file boundary.
  const source = createAvoidanceFixture()
  const file = JSON.parse(serializeProject(source))
  file.version = 3
  file.document.avoidances = structuredClone(source.avoidances)
  file.document.markers = structuredClone(source.markers)
  return file
}

describe('version 3 source documents', () => {
  it('round-trips declarations, mathematical kinds and local appearance without generated objects', () => {
    const source = createAvoidanceFixture()
    source.avoidances[0].partStyles = { entry: {}, arc: { color: '#112233', arrows: false } }
    source.avoidances[0].partLabels = { arc: defaultLabel('C_\\epsilon') }
    const text = serializeProject(source)
    const file = JSON.parse(text) as ProjectFile
    expect(file.version).toBe(3)
    expect(file.document.vertices).toHaveLength(4)
    expect(file.document.segments).toHaveLength(4)
    expect(text).not.toContain('avoid:avoid-1:arc')
    const restored = parseProject(text)
    expect(restored.avoidances).toEqual(source.avoidances)
    expect(restored.markers[0].mathematicalKind).toBe('pole')
    expect(resolveScene(restored)).toEqual(resolveScene(source))
  })

  it.each(['pole', 'isolated', 'branch'] as const)(
    'preserves a standalone %s without bindings',
    (kind) => {
      const source = createAvoidanceFixture()
      source.avoidances = []
      source.markers[0].mathematicalKind = kind
      const text = serializeProject(source)
      expect(JSON.parse(text).version).toBe(3)
      expect(parseProject(text).markers[0].mathematicalKind).toBe(kind)
    },
  )

  it.each([1, 2])('keeps legacy version %i and omits empty/default metadata', (version) => {
    const source = createAvoidanceFixture()
    source.avoidances = []
    source.markers[0].mathematicalKind = 'ordinary'
    if (version === 2)
      source.connections = [{ id: 'connection', kind: 'line', startId: 'a', endId: 'c' }]
    const file = JSON.parse(serializeProject(source))
    expect(file.version).toBe(version)
    expect(file.document).not.toHaveProperty('avoidances')
    expect(file.document.markers[0]).not.toHaveProperty('mathematicalKind')
    const restored = parseProject(JSON.stringify(file))
    expect(restored.avoidances).toEqual([])
    expect(restored.markers[0].mathematicalKind ?? 'ordinary').toBe('ordinary')
    expect(restored.markers[0].id).toBe('pole')
  })

  it.each([1, 2])('rejects semantic data in legacy version %i', (version) => {
    const file = rawFixture()
    file.version = version
    expect(() => parseProject(JSON.stringify(file))).toThrow(/版本 3/)
    file.document.avoidances = []
    expect(() => parseProject(JSON.stringify(file))).toThrow(/版本 3/)
    file.document.markers[0].mathematicalKind = 'ordinary'
    expect(() => parseProject(JSON.stringify(file))).not.toThrow()
  })

  it.each<[string, (file: RawFile) => void, RegExp]>([
    [
      'missing marker',
      (f) => {
        f.document.avoidances[0].markerId = 'missing'
      },
      /avoid-1.*missing/,
    ],
    [
      'missing segment',
      (f) => {
        f.document.avoidances[0].targetSegmentId = 'missing'
      },
      /avoid-1.*missing/,
    ],
    [
      'ordinary marker',
      (f) => {
        delete f.document.markers[0].mathematicalKind
      },
      /非普通/,
    ],
    [
      'arc target without two intersections',
      (f) => {
        f.document.segments[0] = {
          ...f.document.segments[0],
          kind: 'arc',
          through: { re: 0, im: -2 },
        }
      },
      /两个不同.*交点/,
    ],
    [
      'duplicate binding',
      (f) => {
        f.document.avoidances.push({ ...f.document.avoidances[0], id: 'duplicate' })
      },
      /重复/,
    ],
    [
      'global duplicate ID',
      (f) => {
        f.document.avoidances[0].id = 'a'
      },
      /重复/,
    ],
    [
      'unsafe reference ID',
      (f) => {
        f.document.avoidances[0].markerId = 'bad:id'
      },
      /ID/,
    ],
    [
      'invalid kind',
      (f) => {
        f.document.markers[0].mathematicalKind = 'zero'
      },
      /数学类型/,
    ],
    [
      'null kind',
      (f) => {
        f.document.markers[0].mathematicalKind = null
      },
      /数学类型/,
    ],
    [
      'invalid side',
      (f) => {
        f.document.avoidances[0].side = 'up'
      },
      /side|方向/,
    ],
    [
      'zero radius',
      (f) => {
        f.document.avoidances[0].radius = 0
      },
      /半径|radius/,
    ],
    [
      'string radius',
      (f) => {
        f.document.avoidances[0].radius = '0.5'
      },
      /有限数值/,
    ],
    [
      'null ratio',
      (f) => {
        f.document.avoidances[0].openingRatio = null
      },
      /有限数值/,
    ],
    [
      'non-finite radius',
      (f) => {
        f.document.avoidances[0].radius = Infinity
      },
      /有限数值/,
    ],
    [
      'out of range ratio',
      (f) => {
        f.document.avoidances[0].openingRatio = 1.01
      },
      /张角|比例|openingRatio/,
    ],
    [
      'array styles',
      (f) => {
        f.document.avoidances[0].partStyles = []
      },
      /样式|partStyles/,
    ],
    [
      'unknown part',
      (f) => {
        f.document.avoidances[0].partStyles = { bogus: {} }
      },
      /部件|bogus/,
    ],
    [
      'invalid width',
      (f) => {
        f.document.avoidances[0].partStyles = { arc: { width: 999 } }
      },
      /样式/,
    ],
    [
      'invalid color',
      (f) => {
        f.document.avoidances[0].partStyles = { entry: { color: 'red' } }
      },
      /颜色/,
    ],
    [
      'invalid dash',
      (f) => {
        f.document.avoidances[0].partStyles = { exit: { dash: 'none' } }
      },
      /线型/,
    ],
    [
      'invalid arrows',
      (f) => {
        f.document.avoidances[0].partStyles = { arc: { arrows: 1 } }
      },
      /布尔值/,
    ],
    [
      'missing label fields',
      (f) => {
        f.document.avoidances[0].partLabels = { arc: { tex: 'C' } }
      },
      /有限数值/,
    ],
    [
      'bad TeX',
      (f) => {
        f.document.avoidances[0].partLabels = { arc: defaultLabel('\\unknownCommand') }
      },
      /公式/,
    ],
    [
      'label offset',
      (f) => {
        f.document.avoidances[0].partLabels = { exit: { ...defaultLabel('C'), dx: 1e10 } }
      },
      /范围/,
    ],
    [
      'label visibility',
      (f) => {
        f.document.avoidances[0].partLabels = { entry: { ...defaultLabel('C'), visible: null } }
      },
      /布尔值/,
    ],
    [
      'label size',
      (f) => {
        f.document.avoidances[0].partLabels = {
          arc: { ...defaultLabel('C'), size: 100 },
        }
      },
      /范围/,
    ],
    [
      'label color',
      (f) => {
        f.document.avoidances[0].partLabels = {
          arc: { ...defaultLabel('C'), color: 'red' },
        }
      },
      /颜色/,
    ],
  ])('rejects malformed %s with a specific error', (_name, mutate, error) => {
    const file = rawFixture()
    mutate(file)
    expect(() => parseProject(JSON.stringify(file))).toThrow(error)
  })

  it('reads into fresh source objects and discards derived caches and unknown metadata', () => {
    const file = rawFixture()
    file.document.avoidances[0].generatedEndpoints = [{ re: 123, im: 456 }]
    const state = parseProject(JSON.stringify(file))
    expect(state.avoidances[0]).toEqual(createAvoidanceFixture().avoidances[0])
    state.avoidances[0].radius = 0.75
    expect(file.document.avoidances[0].radius).toBe(0.5)
    expect(serializeProject(state)).not.toContain('generatedEndpoints')
  })

  it('serializes only declaration fields even if a caller retains a derived cache', () => {
    const source = createAvoidanceFixture()
    Object.assign(source.avoidances[0], { generatedEndpoints: ['avoid:avoid-1:entry-point'] })
    expect(serializeProject(source)).not.toContain('generatedEndpoints')
    expect(serializeProject(source)).not.toContain('avoid:avoid-1:entry-point')
  })

  it('rejects generated intersections rather than loading a different scene', () => {
    const file = rawFixture()
    file.document.markers.push(
      { ...file.document.markers[0], id: 'low', re: 0.25, im: -1, mathematicalKind: 'ordinary' },
      { ...file.document.markers[0], id: 'high', re: 0.25, im: 1, mathematicalKind: 'ordinary' },
    )
    file.document.connections = [{ id: 'crossing', kind: 'line', startId: 'low', endId: 'high' }]
    expect(() => parseProject(JSON.stringify(file))).toThrow(/相交|相切|重叠/)
  })

  it('enforces the binding count at the reader boundary', () => {
    const file = rawFixture()
    file.document.avoidances = Array.from({ length: 1001 }, (_, i) => ({
      ...file.document.avoidances[0],
      id: `avoid-${i}`,
    }))
    expect(() => parseProject(JSON.stringify(file))).toThrow(/1000/)
  })

  it('accepts 1000 disjoint off-line bindings without counting generated points as source vertices', () => {
    const source = createAvoidanceFixture()
    source.closed = false
    source.vertices[3] = { ...source.vertices[3], re: 4, im: 0 }
    source.markers = Array.from({ length: 1000 }, (_, index) => ({
      ...source.markers[0],
      id: `pole-${index}`,
      re: -3 + index * 0.006,
      im: 0.1,
    }))
    source.avoidances = source.markers.map((marker, index) => ({
      ...source.avoidances[0],
      id: `avoid-${index}`,
      markerId: marker.id,
      radius: 0.001,
    }))
    expect(projectCapacityError(source)).toBe('')
    const restored = parseProject(serializeProject(source))
    expect(restored.vertices).toHaveLength(4)
    expect(restored.avoidances).toHaveLength(1000)
    const resolution = resolveScene(restored)
    expect(resolution.ok).toBe(true)
    if (!resolution.ok) throw new Error(resolution.error)
    expect(resolution.scene.points.size).toBe(5004)
    expect(resolution.scene.contourSegments).toHaveLength(4003)
    // A second target can reuse the first marker. This retained closing edge is
    // hidden, so the 1001st declaration is geometrically valid but over capacity.
    source.avoidances.push({ ...source.avoidances[0], id: 'extra', targetSegmentId: 'edge-d' })
    expect(projectCapacityError(source)).toMatch(/1000/)
    const rejected = contourReducer(restored, { type: 'loadProject', state: source })
    expect(rejected.avoidances).toBe(restored.avoidances)
    expect(rejected.error).toMatch(/1000/)
  })

  it('checks derived geometry projection even when all source coordinates project safely', () => {
    const source = createAvoidanceFixture()
    source.closed = false
    source.vertices = [
      { id: 'a', re: -4e304, im: 0 },
      { id: 'b', re: 4e304, im: 0 },
    ]
    source.segments = [{ id: 'edge-a', kind: 'line', startId: 'a', endId: 'b' }]
    source.markers[0].im = 3e304
    source.avoidances[0].radius = 3e304
    source.viewport = { ...source.viewport, scaleX: 4000, scaleY: 4000 }
    expect(
      [...source.vertices, ...source.markers].every((point) =>
        Object.values(toSvg(point, source.viewport)).every(Number.isFinite),
      ),
    ).toBe(true)
    // Projection safety includes generated geometry, not just source coordinates.
    expect(canProjectScene(source, source.viewport)).toBe(false)
    expect(resolveScene(source).ok).toBe(true)
    expect(() => parseProject(serializeProject(source))).toThrow(/安全绘制/)
    const original = createInitialState()
    const rejected = contourReducer(original, { type: 'loadProject', state: source })
    expect(rejected.vertices).toBe(original.vertices)
    expect(rejected.error).toMatch(/安全绘制/)
  })

  it('applies the UTF-8 2 MB budget to v3 source metadata and rejects oversize edits', () => {
    const source = createAvoidanceFixture()
    source.formulas = Array.from({ length: 200 }, (_, i) => ({
      ...source.markers[0],
      id: `formula-${i}`,
      label: defaultLabel('\u00a0'.repeat(1999) + 'z'),
    }))
    source.avoidances[0].partLabels = { arc: defaultLabel(' '.repeat(1999) + 'C') }
    const text = serializeProject(source)
    const padded = text + ' '.repeat(MAX_PROJECT_BYTES - new TextEncoder().encode(text).length)
    expect(() => parseProject(padded)).not.toThrow()
    expect(() => parseProject(padded + ' ')).toThrow(/2 MB/)
    source.markers = Array.from({ length: 600 }, (_, i) => ({
      ...source.markers[0],
      id: i === 0 ? 'pole' : `point-${i}`,
      label: defaultLabel('\u00a0'.repeat(1999) + 'z'),
    }))
    expect(serializeProject(source).length).toBeLessThan(MAX_PROJECT_BYTES)
    expect(new TextEncoder().encode(serializeProject(source)).length).toBeGreaterThan(
      MAX_PROJECT_BYTES,
    )
    expect(() => parseProject(serializeProject(source))).toThrow(/2 MB/)
    expect(projectCapacityError(source)).toMatch(/2 MB/)
  })

  it('validates invalid bindings before attempting scene capacity/projection queries', () => {
    const source = createAvoidanceFixture()
    source.avoidances[0].targetSegmentId = 'missing'
    expect(projectCapacityError(source)).toMatch(/avoid-1.*missing/)
    expect(projectCapacityError(createInitialState())).toBe('')
  })
})
