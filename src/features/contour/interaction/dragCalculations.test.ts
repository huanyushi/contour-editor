import { expect, it } from 'vitest'
import { defaultLabel } from '../appearance'
import { labelDragEdit, draggedAvoidanceRadius, draggedAvoidanceGap } from './dragCalculations'

it('uses the starting label offset and clears an implicit label on returning to the start', () => {
  const input = {
    id: 'a',
    kind: 'vertex' as const,
    label: Object.freeze(defaultLabel('z_1')),
    start: Object.freeze({ x: 100, y: 100 }),
    current: Object.freeze({ x: 113.25, y: 91.5 }),
    implicit: true,
  }
  expect(labelDragEdit(input)).toMatchObject({
    type: 'label',
    target: { kind: 'vertex', id: 'a' },
    label: { dx: 25.25, dy: -32.5 },
  })
  expect(labelDragEdit({ ...input, current: input.start })).toEqual({
    type: 'clearVertexLabel',
    id: 'a',
  })
  expect(input.label).toEqual(defaultLabel('z_1'))
  expect(input.current).toEqual({ x: 113.25, y: 91.5 })
})

it('rounds pixel displacement before adding old offsets and clamps only the final offset', () => {
  const input = {
    id: 'L',
    kind: 'segment' as const,
    label: { ...defaultLabel('L'), dx: 1999.9996, dy: -1200 },
    start: { x: 0, y: 0 },
    current: { x: 0.0004, y: -900 },
    implicit: false,
  }
  expect(labelDragEdit(input)).toMatchObject({ type: 'label', label: { dx: 1999.9996, dy: -2000 } })
  expect(labelDragEdit({ ...input, current: { x: 1, y: 0 } })).toMatchObject({
    label: { dx: 2000, dy: -1200 },
  })
  expect(labelDragEdit({ ...input, current: input.start })).toMatchObject({
    type: 'label',
    label: { dx: 1999.9996, dy: -1200 },
  })
})

it('calculates gap from the drag start regardless of intervening events and ignores tangential motion', () => {
  const start = Object.freeze({ re: 2, im: 3 }),
    normal = Object.freeze({ re: 0, im: 1 })
  const values = [3.1, 3.2, 3.15].map((im) =>
    draggedAvoidanceGap(0.2, normal, start, { re: 9, im }),
  )
  expect(values[2]).toBeCloseTo(0.5, 12)
  expect(draggedAvoidanceGap(0.2, normal, start, { re: 9, im: 3.15 })).toBe(values[2])
  expect(draggedAvoidanceGap(0.2, normal, start, { re: 99, im: 3 })).toBe(0.2)
  expect(draggedAvoidanceGap(0.2, normal, start, { re: 2, im: 2 })).toBeCloseTo(-1.8, 12)
})

it('preserves the grab offset and is invariant under translation of the center and pointer', () => {
  const center = Object.freeze({ re: 1, im: 2 }),
    current = Object.freeze({ re: 5, im: 5 }),
    offset = Object.freeze({ re: 1, im: -1 })
  expect(draggedAvoidanceRadius(center, current, offset)).toBe(5)
  expect(draggedAvoidanceRadius({ re: 11, im: -8 }, { re: 15, im: -5 }, offset)).toBe(5)
  expect(center).toEqual({ re: 1, im: 2 })
  expect(current).toEqual({ re: 5, im: 5 })
})
