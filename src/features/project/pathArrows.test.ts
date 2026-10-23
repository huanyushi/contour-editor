import { expect, it } from 'vitest'
import { createInitialState, contourReducer } from '../contour/model'
import { createPathArrowFixture } from '../../test/pathArrowFixtures'
import { parseProject, serializeProject } from './project'

it('roundtrips own arrow positions and inherited/overridden appearance through version 7', () => {
  let state = createPathArrowFixture()
  for (const id of [
    'edge-b',
    'gap:edge-a:before:parent',
    'avoid:parent:arc',
    'avoid:clearance:bank-entry',
  ])
    state = contourReducer(state, { type: 'arrowPosition', id, position: 0.25 })
  state = contourReducer(state, { type: 'stroke', patch: { arrowShape: 'latex', arrowSize: 18 } })
  state = contourReducer(state, {
    type: 'stroke',
    id: 'avoid:parent:arc',
    patch: { arrowShape: 'open', arrowSize: 20 },
  })
  expect(state.error).toBe('')
  const text = serializeProject(state)
  expect(JSON.parse(text).version).toBe(7)
  const restored = parseProject(text)
  expect(restored.segments).toEqual(state.segments)
  expect(restored.avoidances).toEqual(state.avoidances)
  expect(restored.appearance).toEqual(state.appearance)
})

it('keeps the minimal old version for unchanged arrows and restores missing legacy defaults', () => {
  const file = JSON.parse(serializeProject(createInitialState()))
  expect(file.version).toBe(1)
  delete file.document.appearance.stroke.arrowShape
  delete file.document.appearance.stroke.arrowSize
  expect(parseProject(JSON.stringify(file)).appearance.stroke).toMatchObject({
    arrowShape: 'triangle',
    arrowSize: 10,
  })
})

it.each([
  ['arrowShape', 'bad'],
  ['arrowSize', 5],
  ['arrowSize', 21],
  ['arrowSize', '10'],
])('rejects invalid arrow style %s=%s', (key, value) => {
  const file = JSON.parse(serializeProject(createInitialState()))
  file.version = 7
  file.document.appearance.stroke[key] = value
  expect(() => parseProject(JSON.stringify(file))).toThrow()
})

it.each([-0.01, 1.01, '0.25', null])('rejects invalid saved positions %s', (position) => {
  const file = JSON.parse(serializeProject(createInitialState()))
  file.version = 7
  file.document.segments[0].arrowPosition = position
  expect(() => parseProject(JSON.stringify(file))).toThrow()
})

it.each(['position', 'shape', 'size'])(
  'does not accept new %s settings under an old version',
  (kind) => {
    const file = JSON.parse(serializeProject(createInitialState()))
    if (kind === 'position') file.document.segments[0].arrowPosition = 0.25
    if (kind === 'shape') file.document.appearance.stroke.arrowShape = 'open'
    if (kind === 'size') file.document.appearance.stroke.arrowSize = 20
    expect(() => parseProject(JSON.stringify(file))).toThrow(/版本 7/)
  },
)
