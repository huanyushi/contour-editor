import { expect, it } from 'vitest'
import { createRectangleConnectedFixture } from '../../test/connectedAvoidanceFixtures'
import { defaultLabel } from '../contour/appearance'
import { contourReducer } from '../contour/model'
import { sourcePieceId } from '../contour/sourcePieces'
import { serializeProject } from './format'
import { parseProject } from './project'

const boundary = { startAvoidanceId: null, endAvoidanceId: 'parent' }

it('writes independent retained-piece settings as v5 and reads them without loss', () => {
  let state = createRectangleConnectedFixture()
  const id = sourcePieceId('edge-a', boundary)
  state = contourReducer(state, { type: 'stroke', id, patch: { color: '#cc2233', arrows: false } })
  state = contourReducer(state, {
    type: 'label',
    target: { kind: 'segment', id },
    label: defaultLabel('C_1'),
  })
  expect(state.error).toBe('')
  const text = serializeProject(state)
  expect(JSON.parse(text).version).toBe(5)
  expect(parseProject(text).segments).toEqual(state.segments)
})

it.each(['duplicate', 'missing', 'style', 'legacy-version', 'count'] as const)(
  'rejects invalid retained-piece declarations: %s',
  (kind) => {
    const file = JSON.parse(serializeProject(createRectangleConnectedFixture()))
    file.version = kind === 'legacy-version' ? 4 : 5
    const piece = { ...boundary, style: { color: '#cc2233' } }
    file.document.segments[0].pieces = [piece]
    if (kind === 'duplicate') file.document.segments[0].pieces.push(piece)
    if (kind === 'missing') piece.endAvoidanceId = 'missing'
    if (kind === 'style') piece.style.color = 'not-a-color'
    if (kind === 'count')
      file.document.segments[0].pieces = Array.from({ length: 2002 }, () => piece)
    expect(() => parseProject(JSON.stringify(file))).toThrow(/片段|版本|样式|颜色|重复|最多/)
  },
)

it('preserves the old writer version when no retained-piece settings exist', () => {
  expect(JSON.parse(serializeProject(createRectangleConnectedFixture())).version).toBe(4)
})

it('reopens saved piece styles and labels unchanged after reversing the current document', () => {
  const id = sourcePieceId('edge-a', boundary)
  let state = contourReducer(createRectangleConnectedFixture(), {
    type: 'stroke',
    id,
    patch: { color: '#cc2233' },
  })
  state = contourReducer(state, {
    type: 'label',
    target: { kind: 'segment', id },
    label: defaultLabel('C_left'),
  })
  const text = serializeProject(state)
  const file = parseProject(text)
  const reversed = contourReducer(state, { type: 'reverse' })
  expect(reversed.error).toBe('')
  const loaded = contourReducer(reversed, { type: 'loadProject', state: file })
  expect(loaded.error).toBe('')
  expect(loaded.segments).toEqual(file.segments)
  expect(JSON.parse(serializeProject(loaded))).toEqual(JSON.parse(text))
})
