import type { ContourState } from '../features/contour/model'
import { createWorkspaceState } from '../features/contour/workspace'

/** A radius-2 mixed path for geometry tests, independent of application presets. */
export function createArcFixture(): ContourState {
  return {
    ...createWorkspaceState(),
    selection: { kind: 'segment', id: 'edge-b' },
    vertices: [
      { id: 'a', re: -2, im: 0 },
      { id: 'b', re: 2, im: 0 },
    ],
    segments: [
      { id: 'edge-a', kind: 'line', startId: 'a', endId: 'b' },
      { id: 'edge-b', kind: 'arc', startId: 'b', endId: 'a', through: { re: 0, im: 2 } },
    ],
    selectedId: 'a',
    selectedSegmentId: 'edge-b',
    closed: true,
    error: '',
  }
}
