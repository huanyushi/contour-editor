import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderApp } from '../test/renderApp'
import { serializeProject } from '../features/project/format'
import { DRAFT_KEY } from '../features/project/legacyLocalDraft'
import { createAvoidanceFixture } from '../test/avoidanceFixtures'
import { openSection, selectObject } from '../test/navigation'
import { sourcePieceId } from '../features/contour/sourcePieces'

const firstPiece = sourcePieceId('edge-a', { startAvoidanceId: null, endAvoidanceId: 'avoid-1' })

beforeEach(() => {
  vi.stubGlobal('innerWidth', 1200)
  vi.stubGlobal(
    'PointerEvent',
    class extends MouseEvent {
      isPrimary = true
      pointerId = 1
    },
  )
})
afterEach(() => vi.unstubAllGlobals())

async function mount({ bound = true, im = 0 } = {}) {
  const state = createAvoidanceFixture()
  state.markers[0].im = im
  if (!bound) state.avoidances = []
  localStorage.setItem(DRAFT_KEY, serializeProject(state))
  return renderApp()
}
function pick(selector = '.segment-hit[data-source-segment-id="edge-a"]') {
  const node = document.querySelector(selector)!
  fireEvent.pointerDown(
    node.matches('.segment-hit') ? node : node.parentElement!.querySelector('.segment-hit')!,
    { button: 0 },
  )
}
function part(role = 'arc', id = 'avoid-1') {
  pick(`[data-testid="segment-avoid:${id}:${role}"]`)
}
async function edit(user: ReturnType<typeof userEvent.setup>, name: string, value: string) {
  const field = screen.getByLabelText(name)
  await user.clear(field)
  await user.type(field, `${value}{Enter}`)
}

describe('user-facing avoidance Inspector', () => {
  it('creates through mathematical kind, target picking and preview without history until apply', async () => {
    const user = userEvent.setup()
    await mount({ bound: false })
    await selectObject(user, '选择标记点 1')
    await user.selectOptions(screen.getByLabelText('数学类型'), 'ordinary')
    expect(screen.queryByRole('button', { name: '添加绕行' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '撤销' }))
    expect(screen.getByRole('button', { name: '撤销' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: '添加绕行' }))
    pick()
    expect(screen.getByLabelText('绕行半径')).toHaveValue('0.4')
    expect(screen.getByLabelText('可用半径范围')).toHaveTextContent('0 < r < 4')
    expect(screen.queryByLabelText('经过点实部 Re')).not.toBeInTheDocument()
    await edit(user, '绕行半径', '4')
    expect(screen.getByRole('button', { name: '应用绕行' })).toBeDisabled()
    expect(screen.getAllByRole('alert')[0]).toHaveTextContent(/半径|端点/)
    await edit(user, '绕行半径', '0.75')
    expect(screen.getByTestId('avoidance-preview')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '撤销' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: '应用绕行' }))
    expect(screen.queryByTestId('avoidance-preview')).not.toBeInTheDocument()
    expect(screen.getByLabelText('绕行半径')).toHaveValue('0.75')
    expect(screen.getByRole('button', { name: '撤销' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: '撤销' }))
    expect(screen.getByTestId('segment-edge-a')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '撤销' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: '重做' }))
    await user.click(screen.getByRole('button', { name: '取消绕行' }))
    expect(screen.getByTestId('segment-edge-a')).toBeInTheDocument()
  })

  it('edits existing parameters in one undo step and routes gap/source separately from parts', async () => {
    const user = userEvent.setup()
    await mount({ im: 2 })
    part('entry')
    expect(screen.getByLabelText('绕行半径')).toHaveValue('0.5')
    expect(screen.queryByLabelText('实部 Re')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('经过点实部 Re')).not.toBeInTheDocument()
    const before = screen.getByTestId('segment-avoid:avoid-1:arc').getAttribute('d')
    await edit(user, '绕行半径', '0.625')
    expect(screen.getByTestId('segment-avoid:avoid-1:arc').getAttribute('d')).not.toBe(before)
    part('arc')
    expect(screen.getByLabelText('绕行半径')).toHaveValue('0.625')
    await user.click(screen.getByRole('button', { name: '撤销' }))
    expect(screen.getByLabelText('绕行半径')).toHaveValue('0.5')
    expect(screen.getByRole('button', { name: '撤销' })).toBeDisabled()
    pick('[data-testid="segment-gap:edge-a:before:avoid-1"]')
    expect(screen.queryByLabelText('绕行半径')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('经过点实部 Re')).not.toBeInTheDocument()
    expect(screen.getByLabelText('线条粗细')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '编辑绕行 1' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '编辑绕行 1' }))
    await user.click(screen.getByRole('button', { name: '定位奇点' }))
    expect(screen.getByLabelText('数学类型')).toHaveValue('isolated')
    await user.selectOptions(screen.getByLabelText('数学类型'), 'ordinary')
    expect(screen.getByRole('alert')).toHaveTextContent(/先取消/)
    expect(screen.getByLabelText('数学类型')).toHaveValue('isolated')
    expect(screen.getByRole('button', { name: '撤销' })).toBeDisabled()
  })

  it('keeps part overrides and submitted labels distinct from inherited source appearance', async () => {
    const user = userEvent.setup()
    await mount({ im: 2 })
    part('entry')
    await user.selectOptions(screen.getByLabelText('线型'), 'dashed')
    await user.click(screen.getByRole('button', { name: '线条颜色：蓝色' }))
    expect(screen.getByTestId('segment-avoid:avoid-1:entry')).toHaveAttribute('stroke-dasharray')
    expect(screen.getByTestId('segment-avoid:avoid-1:entry')).toHaveAttribute('stroke', '#2563eb')
    expect(screen.getByTestId('segment-avoid:avoid-1:arc')).toHaveAttribute('stroke', '#263238')
    expect(screen.getByTestId('segment-avoid:avoid-1:arc')).not.toHaveAttribute('stroke-dasharray')
    await user.type(screen.getByLabelText('LaTeX 标签'), 'a+b')
    await user.click(screen.getByRole('button', { name: '标签颜色：红色' }))
    expect(screen.getByLabelText('LaTeX 标签')).toHaveValue('a+b')
    expect(screen.queryByTestId('label-avoid:avoid-1:entry')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '应用标签' }))
    expect(screen.getByTestId('label-avoid:avoid-1:entry')).toHaveAttribute('aria-label', 'a+b')
    await user.click(screen.getByRole('button', { name: '定位原路径' }))
    await openSection(user, '外观')
    await user.selectOptions(screen.getByLabelText('线型'), 'dotted')
    expect(screen.getByTestId('segment-avoid:avoid-1:entry')).toHaveAttribute(
      'stroke-dasharray',
      '8 6',
    )
    expect(screen.getByTestId('segment-avoid:avoid-1:arc')).toHaveAttribute(
      'stroke-dasharray',
      '0 6',
    )
    await selectObject(user, '选择标记点 1')
    const list = screen.getByRole('complementary', { name: '对象列表' })
    expect(within(list).getByRole('button', { name: '选择标记点 1' })).toHaveTextContent('孤立奇点')
    expect(within(list).getByRole('button', { name: '选择路径段 1 的保留段 1' })).toHaveTextContent(
      '保留段 1',
    )
    expect(
      within(list).getByRole('button', { name: '选择绕行 1 的进入连接段' }),
    ).toBeInTheDocument()
    expect(within(list).queryByText(/entry-base|entry-point/)).not.toBeInTheDocument()
  })

  it.each([390, 1200])(
    'uses real creation controls at width %i and restores canvas focus on immediate Escape',
    async (width) => {
      const user = userEvent.setup()
      vi.stubGlobal('innerWidth', width)
      await mount({ bound: false })
      await selectObject(user, '选择标记点 1')
      await waitFor(() => expect(screen.getByLabelText('属性面板内容')).toHaveFocus())
      const trigger = screen.getByRole('button', { name: '添加绕行' })
      trigger.focus()
      await user.keyboard('{Enter}')
      expect(screen.getByTestId('contour-canvas')).toHaveFocus()
      if (width <= 700) expect(document.getElementById('properties-panel')).not.toBeVisible()
      await user.keyboard('{Escape}')
      expect(screen.queryByRole('button', { name: '取消选择目标' })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: '撤销' })).toBeDisabled()
      await selectObject(user, '选择标记点 1')
      await user.click(screen.getByRole('button', { name: '添加绕行' }))
      pick()
      await waitFor(() => expect(screen.getByLabelText('属性面板内容')).toHaveFocus())
      await user.keyboard('{Escape}')
      await waitFor(() => expect(screen.getByTestId('contour-canvas')).toHaveFocus())
      expect(screen.queryByTestId('avoidance-preview')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: '撤销' })).toBeDisabled()
    },
  )

  it('refuses to apply a creation form with invalid uncommitted text', async () => {
    const user = userEvent.setup()
    await mount({ bound: false })
    await selectObject(user, '选择标记点 1')
    await user.click(screen.getByRole('button', { name: '添加绕行' }))
    pick()
    await user.clear(screen.getByLabelText('绕行半径'))
    await user.type(screen.getByLabelText('绕行半径'), '-')
    await user.click(screen.getByRole('button', { name: '应用绕行' }))
    expect(screen.getByTestId('avoidance-preview')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '撤销' })).toBeDisabled()
    expect(screen.getByLabelText('绕行半径')).toHaveFocus()
  })

  it('leaves accepted geometry and history intact for text and geometric errors, then recovers', async () => {
    const user = userEvent.setup()
    await mount()
    part()
    const before = screen.getByTestId('segment-avoid:avoid-1:arc').getAttribute('d')
    await edit(user, '绕行半径', '-')
    expect(screen.getByLabelText('绕行半径')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByTestId('segment-avoid:avoid-1:arc')).toHaveAttribute('d', before)
    expect(screen.getByRole('button', { name: '撤销' })).toBeDisabled()
    await edit(user, '绕行半径', '4')
    expect(screen.getByRole('alert')).toHaveTextContent(/半径|端点/)
    expect(screen.getByTestId('segment-avoid:avoid-1:arc')).toHaveAttribute('d', before)
    expect(screen.getByRole('button', { name: '撤销' })).toBeDisabled()
    expect(screen.getByLabelText('绕行半径')).toHaveValue('0.5')
    await user.selectOptions(screen.getByLabelText('绕行侧'), 'right')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByLabelText('绕行半径')).toHaveValue('0.5')
    const right = screen.getByTestId('segment-avoid:avoid-1:arc').getAttribute('d')
    await user.selectOptions(screen.getByLabelText('线型'), 'dashed')
    expect(screen.getByLabelText('绕行半径')).toHaveValue('0.5')
    expect(screen.getByLabelText('绕行半径')).toHaveAttribute('aria-invalid', 'false')
    await user.click(screen.getByLabelText('绕行半径'))
    await user.keyboard('{Enter}')
    await edit(user, '绕行半径', '0.75')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '撤销' }))
    expect(screen.getByLabelText('绕行半径')).toHaveValue('0.5')
    expect(screen.getByTestId('segment-avoid:avoid-1:arc')).toHaveAttribute('d', right)
    expect(screen.getByTestId('segment-avoid:avoid-1:arc')).toHaveAttribute(
      'stroke-dasharray',
      '8 6',
    )
    await user.click(screen.getByRole('button', { name: '撤销' }))
    expect(screen.getByTestId('segment-avoid:avoid-1:arc')).not.toHaveAttribute('stroke-dasharray')
    await user.click(screen.getByRole('button', { name: '撤销' }))
    expect(screen.getByTestId('segment-avoid:avoid-1:arc')).toHaveAttribute('d', before)
    expect(screen.getByRole('button', { name: '撤销' })).toBeDisabled()
  })

  it('preserves and edits a dormant connector using its origin, then restores its label and style', async () => {
    const user = userEvent.setup()
    await mount()
    part()
    await user.selectOptions(screen.getByLabelText('绕行部件'), 'entry')
    expect(screen.getByLabelText('绕行半径')).toHaveValue('0.5')
    expect(screen.queryByLabelText('经过点实部 Re')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('实部 Re')).not.toBeInTheDocument()
    expect(screen.getByText(/当前连接段长度为零/)).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('线型'), 'dashed')
    await user.type(screen.getByLabelText('LaTeX 标签'), 'L')
    await user.click(screen.getByRole('button', { name: '应用标签' }))
    expect(screen.queryByTestId('label-avoid:avoid-1:entry')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '定位奇点' }))
    await user.clear(screen.getByLabelText('虚部 Im'))
    await user.type(screen.getByLabelText('虚部 Im'), '2{Enter}')
    expect(screen.getByTestId('segment-avoid:avoid-1:entry')).toHaveAttribute(
      'stroke-dasharray',
      '8 6',
    )
    expect(screen.getByTestId('label-avoid:avoid-1:entry')).toHaveAttribute('aria-label', 'L')
  })

  it('converts a preferred width to a saved ratio and keeps that ratio when radius changes', async () => {
    const user = userEvent.setup()
    await mount({ im: 0.1 })
    part()
    expect(screen.getByLabelText('实际开口宽度')).toHaveTextContent('0.979796')
    await edit(user, '偏好开口宽度', '0.25')
    expect(screen.getByLabelText('偏好开口宽度')).toHaveValue('0.25')
    expect(screen.getByLabelText('实际开口宽度')).toHaveTextContent('0.979796')
    await edit(user, '绕行半径', '1')
    expect(screen.getByLabelText('偏好开口宽度')).toHaveValue('0.5')
    expect(screen.getByLabelText('实际开口宽度')).toHaveTextContent('1.989975')
    await user.click(screen.getByRole('button', { name: '撤销' }))
    expect(screen.getByLabelText('偏好开口宽度')).toHaveValue('0.25')
    await user.click(screen.getByRole('button', { name: '撤销' }))
    expect(screen.getByLabelText('偏好开口宽度')).toHaveValue('0.5')
    expect(screen.getByRole('button', { name: '撤销' })).toBeDisabled()
  })

  it('returns to the marker after explicit preview cancellation without adding history', async () => {
    const user = userEvent.setup()
    await mount({ bound: false })
    await selectObject(user, '选择标记点 1')
    await user.click(screen.getByRole('button', { name: '添加绕行' }))
    pick()
    await user.click(screen.getByRole('button', { name: '取消预览' }))
    expect(screen.getByLabelText('数学类型')).toHaveValue('isolated')
    expect(screen.queryByTestId('avoidance-preview')).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByLabelText('属性面板内容')).toHaveFocus())
    expect(screen.getByRole('button', { name: '撤销' })).toBeDisabled()
  })

  it('keeps retained-piece appearance and labels independent, and reuses an existing binding', async () => {
    const user = userEvent.setup()
    await mount()
    pick('[data-testid="segment-gap:edge-a:before:avoid-1"]')
    await user.selectOptions(screen.getByLabelText('线型'), 'dashed')
    expect(screen.getByTestId('segment-gap:edge-a:before:avoid-1')).toHaveAttribute(
      'stroke-dasharray',
      '8 6',
    )
    expect(screen.getByTestId('segment-avoid:avoid-1:arc')).not.toHaveAttribute('stroke-dasharray')
    await user.type(screen.getByLabelText('LaTeX 标签'), 'C')
    await user.click(screen.getByRole('button', { name: '应用标签' }))
    expect(screen.getByTestId(`label-${firstPiece}`)).toHaveAttribute('aria-label', 'C')
    expect(screen.queryByTestId('label-gap:edge-a:before:avoid-1')).not.toBeInTheDocument()
    await selectObject(user, '选择标记点 1')
    await user.click(screen.getByRole('button', { name: '添加绕行' }))
    pick()
    expect(screen.getByLabelText('绕行半径')).toHaveValue('0.5')
    expect(screen.queryByTestId('avoidance-preview')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '撤销' }))
    expect(screen.queryByTestId(`label-${firstPiece}`)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '撤销' }))
    expect(screen.getByTestId('segment-avoid:avoid-1:arc')).not.toHaveAttribute('stroke-dasharray')
    expect(screen.getByRole('button', { name: '撤销' })).toBeDisabled()
  })

  it('lists multiple bindings and limits radius by the neighboring full footprint', async () => {
    const user = userEvent.setup()
    const state = createAvoidanceFixture()
    state.markers.push({ ...state.markers[0], id: 'pole2', re: 2 })
    state.avoidances.push({ ...state.avoidances[0], id: 'avoid-2', markerId: 'pole2' })
    localStorage.setItem(DRAFT_KEY, serializeProject(state))
    await renderApp()
    part()
    expect(screen.getByLabelText('可用半径范围')).toHaveTextContent('0 < r < 1.5')
    await user.click(screen.getByRole('button', { name: '定位原路径' }))
    expect(screen.getByRole('button', { name: '编辑绕行 1' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '编辑绕行 2' }))
    expect(screen.getByLabelText('绕行半径')).toHaveValue('0.5')
    await user.click(screen.getByRole('button', { name: '定位奇点' }))
    expect(screen.queryByRole('button', { name: '编辑绕行 2' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '撤销' })).toBeDisabled()
  })

  it('edits a binding on an independent connection through its retained source row', async () => {
    const user = userEvent.setup()
    const state = createAvoidanceFixture()
    state.connections = [state.segments.shift()!]
    state.closed = false
    localStorage.setItem(DRAFT_KEY, serializeProject(state))
    await renderApp()
    await selectObject(user, '选择独立路径段 1 的保留段 1')
    expect(screen.getByRole('button', { name: '选择独立路径段 1 的保留段 1' })).toHaveTextContent(
      '保留段 1',
    )
    await user.click(screen.getByRole('button', { name: '编辑绕行 1' }))
    await edit(user, '绕行半径', '0.75')
    expect(screen.getByLabelText('实际开口宽度')).toHaveTextContent('1.5')
    await user.click(screen.getByRole('button', { name: '取消绕行' }))
    expect(screen.getByTestId('segment-edge-a')).toBeInTheDocument()
  })

  it('keeps a retained closing-edge binding editable while its source is hidden', async () => {
    const user = userEvent.setup()
    const state = createAvoidanceFixture()
    state.closed = false
    state.markers[0].re = -4
    state.markers[0].im = 1.5
    state.avoidances[0].targetSegmentId = 'edge-d'
    localStorage.setItem(DRAFT_KEY, serializeProject(state))
    await renderApp()
    await selectObject(user, '选择标记点 1')
    await user.click(screen.getByRole('button', { name: '编辑绕行 1' }))
    expect(screen.getByLabelText('绕行半径')).toHaveValue('0.5')
    expect(screen.queryByLabelText('经过点实部 Re')).not.toBeInTheDocument()
    await selectObject(user, '选择标记点 1')
    expect(screen.getByLabelText('数学类型')).toHaveValue('isolated')
    await user.click(screen.getByRole('button', { name: '编辑绕行 1' }))
    await edit(user, '绕行半径', '0.75')
    await user.selectOptions(screen.getByLabelText('绕行部件'), 'entry')
    await user.selectOptions(screen.getByLabelText('线型'), 'dashed')
    await user.click(screen.getByRole('button', { name: '定位原路径' }))
    expect(screen.getByRole('button', { name: '编辑绕行 1' })).toBeInTheDocument()
    expect(screen.queryByLabelText('绕行半径')).not.toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: '闭合围道' }))
    part()
    expect(screen.getByLabelText('绕行半径')).toHaveValue('0.75')
  })

  it('keeps the selected visible closing part in the production Inspector after opening', async () => {
    const user = userEvent.setup()
    const state = createAvoidanceFixture()
    state.markers[0] = { ...state.markers[0], re: -4, im: 1.5 }
    state.avoidances[0].targetSegmentId = 'edge-d'
    localStorage.setItem(DRAFT_KEY, serializeProject(state))
    await renderApp()
    part()
    expect(screen.getByLabelText('绕行半径')).toHaveValue('0.5')
    await user.click(screen.getByRole('checkbox', { name: '闭合围道' }))
    expect(screen.queryByTestId('segment-avoid:avoid-1:arc')).not.toBeInTheDocument()
    expect(screen.getByLabelText('绕行半径')).toHaveValue('0.5')
    expect(screen.getByText(/原路径暂存，部件暂不显示/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '取消绕行' })).toBeEnabled()
    await edit(user, '绕行半径', '0.75')
    await user.click(screen.getByRole('button', { name: '定位原路径' }))
    await user.click(screen.getByRole('button', { name: '编辑绕行 1' }))
    expect(screen.getByLabelText('绕行半径')).toHaveValue('0.75')
    await user.click(screen.getByRole('checkbox', { name: '闭合围道' }))
    expect(screen.getByTestId('segment-avoid:avoid-1:arc')).toBeInTheDocument()
    expect(screen.getByLabelText('绕行半径')).toHaveValue('0.75')
  })

  it('locks cancellation during a style gesture without native disabling, then unlocks it', async () => {
    const user = userEvent.setup()
    await mount({ im: 2 })
    part()
    const width = screen.getByLabelText('线条粗细')
    const cancel = screen.getByRole('button', { name: '取消绕行' })
    const close = screen.getByRole('button', { name: '收起属性面板' })
    fireEvent.keyDown(width, { key: 'ArrowRight' })
    expect(cancel).not.toBeDisabled()
    expect(close).not.toBeDisabled()
    fireEvent.click(cancel)
    fireEvent.click(close)
    expect(screen.getByTestId('segment-avoid:avoid-1:arc')).toBeInTheDocument()
    expect(document.getElementById('properties-panel')).toBeVisible()
    fireEvent.keyUp(width, { key: 'ArrowRight' })
    await user.click(cancel)
    expect(screen.getByTestId('segment-edge-a')).toBeInTheDocument()
  })

  it('keeps preview errors visible when view settings temporarily cover the Inspector', async () => {
    const user = userEvent.setup()
    await mount({ bound: false })
    await selectObject(user, '选择标记点 1')
    await user.click(screen.getByRole('button', { name: '添加绕行' }))
    pick()
    await waitFor(() => expect(screen.getByLabelText('属性面板内容')).toHaveFocus())
    await edit(user, '绕行半径', '4')
    expect(screen.getByRole('alert')).toHaveTextContent(/半径|端点/)
    await user.click(screen.getByRole('button', { name: '视图设置' }))
    expect(screen.getByRole('alert')).toHaveTextContent(/半径|端点/)
    await user.click(screen.getByRole('button', { name: '关闭视图设置' }))
    expect(screen.getByRole('alert')).toHaveTextContent(/半径|端点/)
    await edit(user, '绕行半径', '0.5')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
