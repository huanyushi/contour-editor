import { defaultLabel } from '../features/contour/appearance'
import { createInitialState, type ContourState } from '../features/contour/model'
import legacyTemplates from './fixtures/legacyTemplates.json'

type LegacyTemplateId = keyof typeof legacyTemplates
export const legacyTemplateIds = Object.keys(legacyTemplates) as LegacyTemplateId[]

/** Frozen pre-binding geometry for old-project and boundary regression tests. */
export function createLegacyTemplateFixture(id: LegacyTemplateId): ContourState {
  const legacy = legacyTemplates[id]
  const vertices = legacy.points.map(([re, im], i) => ({
    id: `v${i + 1}`,
    re,
    im,
    label: { ...defaultLabel(), visible: false },
  }))
  return {
    ...createInitialState(),
    vertices,
    segments: legacy.through.map((p, i) => ({
      id: `edge-${vertices[i].id}`,
      startId: vertices[i].id,
      endId: vertices[(i + 1) % vertices.length].id,
      ...(p ? { kind: 'arc', through: { re: p[0], im: p[1] } } : { kind: 'line' }),
    })),
    selectedId: vertices[0].id,
    selectedSegmentId: `edge-${vertices[0].id}`,
    selection: { kind: 'contour' },
  }
}
