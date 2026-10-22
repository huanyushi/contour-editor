import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { renderApp, savedCanvasState } from '../test/renderApp'
import { serializeProject } from '../features/project/project'
import { DRAFT_KEY } from '../features/project/legacyLocalDraft'
import { createAvoidanceFixture } from '../test/avoidanceFixtures'
import { selectObject } from '../test/navigation'

beforeEach(() => vi.stubGlobal('innerWidth', 1200))
afterEach(() => vi.unstubAllGlobals())

it.each(['pole', 'isolated'] as const)(
  'groups a legacy %s marker without rewriting its data or binding, including after undo',
  async (kind) => {
    const source = createAvoidanceFixture()
    source.markers[0].mathematicalKind = kind
    const original = serializeProject(source)
    localStorage.setItem(DRAFT_KEY, original)
    await renderApp()
    const user = userEvent.setup()
    await selectObject(user, '选择标记点 1')
    const type = screen.getByRole('combobox', { name: '数学类型' })
    expect(
      within(type)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['普通点', '孤立奇点', '支点'])
    expect(type).toHaveValue('isolated')
    expect(screen.getByRole('button', { name: '选择标记点 1' })).toHaveTextContent('孤立奇点')
    const path = screen.getByTestId('contour-path').getAttribute('d')
    await user.selectOptions(type, 'isolated')
    expect(serializeProject(await savedCanvasState())).toBe(original)
    expect(screen.getByRole('button', { name: '撤销' })).toBeDisabled()
    await user.selectOptions(type, 'branch')
    expect((await savedCanvasState()).markers[0].mathematicalKind).toBe('branch')
    expect((await savedCanvasState()).avoidances).toEqual(source.avoidances)
    expect(screen.getByTestId('contour-path')).toHaveAttribute('d', path)
    await user.click(screen.getByRole('button', { name: '撤销' }))
    expect(type).toHaveValue('isolated')
    expect(serializeProject(await savedCanvasState())).toBe(original)
  },
)

it.each(['pole', 'isolated'] as const)(
  'shows a legacy %s vertex in the same three-category UI without changing its stored kind',
  async (kind) => {
    const source = createAvoidanceFixture()
    source.vertices[1].mathematicalKind = kind
    localStorage.setItem(DRAFT_KEY, serializeProject(source))
    await renderApp()
    const user = userEvent.setup()
    await selectObject(user, '选择顶点 z2')
    const type = screen.getByRole('combobox', { name: '数学类型' })
    expect(type).toHaveValue('isolated')
    expect(within(type).getAllByRole('option')).toHaveLength(3)
    expect(screen.getByRole('button', { name: '选择顶点 z2' })).toHaveTextContent('孤立奇点')
    await user.selectOptions(type, 'isolated')
    expect((await savedCanvasState()).vertices[1].mathematicalKind).toBe(kind)
    expect((await savedCanvasState()).avoidances).toEqual(source.avoidances)
    expect(screen.getByRole('button', { name: '撤销' })).toBeDisabled()
  },
)

it('creates the generic isolated classification from an ordinary point and keeps branch separate', async () => {
  const source = createAvoidanceFixture()
  source.avoidances = []
  source.markers[0].mathematicalKind = 'ordinary'
  localStorage.setItem(DRAFT_KEY, serializeProject(source))
  await renderApp()
  const user = userEvent.setup()
  await selectObject(user, '选择标记点 1')
  const type = screen.getByRole('combobox', { name: '数学类型' })
  expect(type).toHaveDisplayValue('普通点')
  expect(screen.queryByRole('button', { name: '添加绕行' })).toBeNull()
  await user.selectOptions(type, 'isolated')
  expect((await savedCanvasState()).markers[0].mathematicalKind).toBe('isolated')
  expect(screen.getByRole('button', { name: '添加绕行' })).toBeEnabled()
  await user.selectOptions(type, 'branch')
  expect(type).toHaveDisplayValue('支点')
  expect((await savedCanvasState()).markers[0].mathematicalKind).toBe('branch')
  expect((await savedCanvasState()).avoidances).toEqual([])
})
