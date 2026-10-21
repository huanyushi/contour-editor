import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { createInitialState, type ContourState } from '../features/contour/model'
import { defaultLabel, defaultPointStyle } from '../features/contour/appearance'
import { serializeProject } from '../features/project/format'
import { parseProject } from '../features/project/project'
import { DRAFT_KEY } from '../features/project/useLocalDraft'
import { selectObject } from '../test/navigation'

function corner(): ContourState {
  return {
    ...createInitialState(),
    vertices: [
      { id: 'a', re: 0, im: 2 },
      { id: 'b', re: 0, im: 0 },
      { id: 'c', re: 3, im: 0 },
      { id: 'd', re: 3, im: 2 },
    ],
    markers: [],
  }
}

function arc(): ContourState {
  return {
    ...corner(),
    closed: false,
    vertices: [
      { id: 'a', re: -3, im: 0 },
      { id: 'b', re: 3, im: 0 },
    ],
    segments: [{ id: 'upper', kind: 'arc', startId: 'a', endId: 'b', through: { re: 0, im: 3 } }],
    markers: [
      {
        id: 'pole',
        re: 0,
        im: 3,
        mathematicalKind: 'pole',
        label: defaultLabel('p'),
        pointStyle: defaultPointStyle(),
      },
    ],
  }
}

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
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function mount(state: ContourState) {
  localStorage.setItem(DRAFT_KEY, serializeProject(state))
  return render(<App />)
}
function pick(id: string) {
  fireEvent.pointerDown(document.querySelector(`.segment-hit[data-source-segment-id="${id}"]`)!, {
    button: 0,
  })
}
async function edit(user: ReturnType<typeof userEvent.setup>, value: string) {
  const radius = screen.getByLabelText('绕行半径')
  await user.clear(radius)
  await user.type(radius, `${value}{Enter}`)
  fireEvent.blur(radius)
}
function saved() {
  fireEvent(window, new Event('pagehide'))
  return parseProject(localStorage.getItem(DRAFT_KEY)!)
}
async function startCorner(user: ReturnType<typeof userEvent.setup>, edge = 'edge-b') {
  await selectObject(user, '选择顶点 z2')
  await user.selectOptions(screen.getByLabelText('数学类型'), 'pole')
  await user.click(screen.getByRole('button', { name: '添加绕行' }))
  pick(edge)
  await waitFor(() => expect(screen.getByLabelText('属性面板内容')).toHaveFocus())
}

describe('source arc and semantic corner Inspector', () => {
  it.each([false, true])(
    'repairs an invalid initial radius to the short preview/apply unless a side was explicitly chosen (%s)',
    async (explicit) => {
      const user = userEvent.setup()
      const state = corner()
      state.vertices = [
        { id: 'a', re: 0, im: 100 },
        { id: 'b', re: 0, im: 0, mathematicalKind: 'pole' },
        { id: 'c', re: -1, im: 0 },
        { id: 'd', re: -1, im: 100 },
      ]
      mount(state)
      await startCorner(user)
      expect(screen.getByLabelText('绕行半径')).toHaveValue('5')
      expect(screen.getByRole('button', { name: '应用绕行' })).toBeDisabled()
      if (explicit) {
        await user.selectOptions(screen.getByLabelText('绕行侧'), 'right')
        await user.selectOptions(screen.getByLabelText('绕行侧'), 'left')
      }
      await edit(user, '0.5')
      expect(screen.getByLabelText('绕行侧')).toHaveValue(explicit ? 'left' : 'right')
      const preview = screen
        .getByTestId('avoidance-preview')
        .querySelector('path[data-preview-part$=":arc"]')!
        .getAttribute('d')!
      expect(preview.split(/\s+/).slice(7, 9)).toEqual(explicit ? ['1', '1'] : ['0', '0'])
      expect(screen.getByRole('button', { name: '撤销' })).toBeDisabled()
      await user.click(screen.getByRole('button', { name: '应用绕行' }))
      expect(screen.getByTestId('segment-avoid:avoidance-0:arc')).toHaveAttribute('d', preview)
      expect(saved().avoidances[0].side).toBe(explicit ? 'left' : 'right')
      await user.click(screen.getByRole('button', { name: '撤销' }))
      expect(saved().avoidances).toHaveLength(0)
      expect(screen.getByRole('button', { name: '撤销' })).toBeDisabled()
    },
  )

  it('previews true source-circle intersections, keeps both remaining arcs, and repairs an invalid radius', async () => {
    const user = userEvent.setup()
    mount(arc())
    await selectObject(user, '选择标记点 1')
    await user.click(screen.getByRole('button', { name: '添加绕行' }))
    pick('upper')
    await waitFor(() => expect(screen.getByLabelText('属性面板内容')).toHaveFocus())
    expect(Number((screen.getByLabelText('绕行半径') as HTMLInputElement).value)).toBeCloseTo(
      (3 * Math.PI) / 20,
      6,
    )
    expect(screen.getByLabelText('可用半径范围')).toHaveTextContent('4.242641')
    expect(screen.queryByText(/沿线占用范围/)).not.toBeInTheDocument()
    await edit(user, '5')
    expect(screen.getByRole('alert')).toHaveTextContent(/upper/)
    expect(screen.getByLabelText('绕行侧')).toBeInTheDocument()
    expect(screen.queryByLabelText('偏好开口宽度')).not.toBeInTheDocument()
    await edit(user, '0.5')
    const preview = screen
      .getByTestId('avoidance-preview')
      .querySelector('path[data-preview-part$=":arc"]')!
      .getAttribute('d')
    await user.click(screen.getByRole('button', { name: '应用绕行' }))
    const path = screen.getByTestId('segment-avoid:avoidance-0:arc')
    expect(path).toHaveAttribute('d', preview)
    const command = path.getAttribute('d')!.split(/\s+/)
    for (const [x, y] of [
      [Number(command[1]), Number(command[2])],
      [Number(command[9]), Number(command[10])],
    ]) {
      const re = (x - 400) / 40,
        im = (300 - y) / 40
      expect(Math.hypot(re, im)).toBeCloseTo(3, 10)
      expect(Math.hypot(re, im - 3)).toBeCloseTo(0.5, 10)
      expect(im).toBeCloseTo(71 / 24, 10)
    }
    const retained = document.querySelectorAll('[data-testid^="segment-gap:upper:"]')
    expect(retained).toHaveLength(2)
    for (const p of retained) {
      const command = p.getAttribute('d')!.split(/\s+/)
      expect(command[3]).toBe('A')
      expect(Number(command[4])).toBeCloseTo(120, 9)
      expect(Number(command[5])).toBeCloseTo(120, 9)
    }
    expect(screen.queryByLabelText('经过点实部 Re')).not.toBeInTheDocument()
  })

  it.each(['edge-a', 'edge-b'])(
    'normalizes %s to both corner dependencies, defaults short, preserves explicit major side and one-step commits',
    async (edge) => {
      const user = userEvent.setup()
      mount(corner())
      await startCorner(user, edge)
      expect(screen.getByText(/进入路径 edge-a.*离开路径 edge-b/)).toBeInTheDocument()
      expect(screen.getByLabelText('可用半径范围')).toHaveTextContent('0 < r < 2')
      expect(screen.queryByLabelText('偏好开口宽度')).not.toBeInTheDocument()
      await edit(user, '0.5')
      await user.click(screen.getByRole('button', { name: '应用绕行' }))
      const path = () =>
        screen.getByTestId('segment-avoid:avoidance-0:arc').getAttribute('d')!.split(/\s+/)
      expect(path().slice(7, 9)).toEqual(['0', '1'])
      expect(saved().avoidances[0]).toMatchObject({
        markerId: 'b',
        targetSegmentId: 'edge-a',
        exitSegmentId: 'edge-b',
        side: 'left',
      })
      expect(saved().markers).toHaveLength(0)
      await user.selectOptions(screen.getByLabelText('绕行侧'), 'right')
      expect(path().slice(7, 9)).toEqual(['1', '0'])
      await edit(user, '0.75')
      await user.click(screen.getByRole('button', { name: '撤销' }))
      expect(screen.getByLabelText('绕行半径')).toHaveValue('0.5')
      expect(screen.getByLabelText('绕行侧')).toHaveValue('right')
      await edit(user, '2')
      expect(screen.getByLabelText('绕行半径')).toHaveValue('0.5')
      expect(screen.getByRole('alert')).toHaveTextContent(/端点|半径/)
      await user.click(screen.getByRole('button', { name: '定位奇点' }))
      expect(screen.getByRole('button', { name: '删除选中顶点' })).toBeInTheDocument()
      expect(screen.getByLabelText('数学类型')).toHaveValue('pole')
      const list = screen.getByRole('complementary', { name: '对象列表' })
      expect(within(list).getByRole('button', { name: '选择顶点 z2' })).toHaveTextContent('极点')
      expect(within(list).getByRole('button', { name: '选择路径段 2' })).toHaveTextContent(
        '1 处绕行',
      )
      await selectObject(user, '选择路径段 2')
      await user.click(screen.getByRole('button', { name: '编辑绕行 1' }))
      await user.click(screen.getByRole('button', { name: '取消绕行' }))
      expect(saved().vertices).toHaveLength(4)
      expect(saved().markers).toHaveLength(0)
      expect(screen.getByTestId('segment-edge-a')).toBeInTheDocument()
    },
  )

  it('explains an open endpoint and cancellation returns to the real source vertex', async () => {
    const user = userEvent.setup()
    const state = corner()
    state.closed = false
    mount(state)
    await selectObject(user, '选择顶点 z1')
    await user.selectOptions(screen.getByLabelText('数学类型'), 'pole')
    await user.click(screen.getByRole('button', { name: '添加绕行' }))
    pick('edge-a')
    expect(screen.getByRole('alert')).toHaveTextContent(/进入.*离开|可见/)
    await user.click(screen.getByRole('button', { name: '取消选择目标' }))
    expect(screen.getByRole('button', { name: '删除选中顶点' })).toBeInTheDocument()
    expect(screen.getByLabelText('数学类型')).toHaveValue('pole')
    expect(saved().avoidances).toHaveLength(0)
  })

  it.each([390, 1200])(
    'shows target errors and retries canvas picking without history at width %i, then Escape cancels',
    async (width) => {
      vi.stubGlobal('innerWidth', width)
      const user = userEvent.setup()
      const state = corner()
      state.closed = false
      state.vertices[0].mathematicalKind = 'pole'
      mount(state)
      await selectObject(user, '选择顶点 z1')
      await user.click(screen.getByRole('button', { name: '添加绕行' }))
      const canvas = screen.getByTestId('contour-canvas')
      const panel = document.getElementById('properties-panel')!
      if (width === 390) expect(panel).not.toBeVisible()
      expect(canvas).toHaveFocus()
      expect(document.querySelector('.canvas-status [role="status"]')).toHaveTextContent(
        /源路径|直线或圆弧/,
      )
      pick('edge-a')
      expect(panel).toBeVisible()
      expect(screen.getByRole('alert')).toHaveTextContent(/可见进入.*可见离开/)
      await waitFor(() => expect(screen.getByLabelText('属性面板内容')).toHaveFocus())
      await user.click(screen.getByRole('button', { name: '重新选择目标' }))
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(canvas).toHaveFocus()
      if (width === 390) expect(panel).not.toBeVisible()
      else expect(panel).toBeVisible()
      // The same error must reopen the panel: retry retained the same picking source.
      pick('edge-a')
      expect(panel).toBeVisible()
      expect(screen.getByRole('alert')).toHaveTextContent(/可见进入.*可见离开/)
      await waitFor(() => expect(screen.getByLabelText('属性面板内容')).toHaveFocus())
      await user.click(screen.getByRole('button', { name: '重新选择目标' }))
      await user.keyboard('{Escape}')
      expect(screen.queryByRole('button', { name: '取消选择目标' })).not.toBeInTheDocument()
      expect(canvas).toHaveFocus()
      pick('edge-a')
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(saved().avoidances).toHaveLength(0)
      expect(saved().vertices).toEqual(state.vertices)
      expect(screen.getByRole('button', { name: '撤销' })).toBeDisabled()
      expect(screen.getByRole('button', { name: '重做' })).toBeDisabled()
    },
  )

  it.each(['retry', 'Escape'] as const)(
    'cancels queued error-panel focus on %s before the narrow error frame runs',
    async (action) => {
      vi.stubGlobal('innerWidth', 390)
      const user = userEvent.setup()
      const state = corner()
      state.closed = false
      state.vertices[0].mathematicalKind = 'pole'
      mount(state)
      await selectObject(user, '选择顶点 z1')
      await user.click(screen.getByRole('button', { name: '添加绕行' }))
      const frames = new Map<number, FrameRequestCallback>()
      let nextFrame = 0
      vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
        const id = ++nextFrame
        frames.set(id, callback)
        return id
      })
      vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
        frames.delete(id)
      })
      const canvas = screen.getByTestId('contour-canvas')
      pick('edge-a')
      expect(screen.getByRole('alert')).toBeVisible()
      const errorFrames = [...frames.keys()]
      expect(errorFrames.length).toBeGreaterThan(0)
      if (action === 'retry') fireEvent.click(screen.getByRole('button', { name: '重新选择目标' }))
      else fireEvent.keyDown(canvas, { key: 'Escape' })
      act(() => {
        for (const id of errorFrames) frames.get(id)?.(0)
      })
      expect(canvas).toHaveFocus()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      if (action === 'retry') {
        expect(
          screen.getByRole('button', { name: '取消选择目标', hidden: true }),
        ).toBeInTheDocument()
        expect(document.getElementById('properties-panel')).not.toBeVisible()
      } else expect(screen.queryByRole('button', { name: '取消选择目标' })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: '撤销' })).toBeDisabled()
    },
  )

  it('cancels a configured corner without changing source arrays or creating markers', async () => {
    const user = userEvent.setup()
    const state = corner()
    mount(state)
    await startCorner(user)
    await user.click(screen.getByRole('button', { name: '取消预览' }))
    expect(screen.getByRole('button', { name: '删除选中顶点' })).toBeInTheDocument()
    expect(saved().segments).toEqual(state.segments)
    expect(saved().markers).toHaveLength(0)
    expect(saved().avoidances).toHaveLength(0)
  })

  it('creates a mixed line/arc corner from the outgoing arc and retains its circle after reopening', async () => {
    const user = userEvent.setup()
    const state = corner()
    state.vertices[2].re = 2
    state.segments[1] = { ...state.segments[1], kind: 'arc', through: { re: 1, im: -1 } }
    const view = mount(state)
    await startCorner(user)
    await edit(user, '0.5')
    expect(screen.queryByRole('alert')?.textContent).toBeUndefined()
    await user.click(screen.getByRole('button', { name: '应用绕行' }))
    const path = screen.getByTestId('segment-avoid:avoidance-0:arc').getAttribute('d')!
    const command = path.split(/\s+/)
    expect((Number(command[9]) - 400) / 40).toBeCloseTo(1 / 8, 10)
    expect((300 - Number(command[10])) / 40).toBeCloseTo(-Math.sqrt(15) / 8, 10)
    const retained = document
      .querySelector('[data-testid^="segment-gap:edge-b:"]')!
      .getAttribute('d')!
      .split(/\s+/)
    expect(retained[3]).toBe('A')
    expect(Number(retained[4])).toBeCloseTo(40, 10)
    const accepted = saved()
    view.unmount()
    mount(accepted)
    expect(screen.getByTestId('segment-avoid:avoidance-0:arc')).toHaveAttribute('d', path)
    expect(saved().markers).toHaveLength(0)
  })

  it('drags the real semantic vertex as the bound center even with helper handles hidden, with one undo', async () => {
    const user = userEvent.setup()
    const state = corner()
    state.handles = false
    state.vertices[1].mathematicalKind = 'pole'
    state.avoidances = [
      {
        id: 'cut',
        markerId: 'b',
        targetSegmentId: 'edge-a',
        exitSegmentId: 'edge-b',
        radius: 0.5,
        side: 'left',
        openingRatio: 0.5,
      },
    ]
    mount(state)
    const svg = screen.getByTestId('contour-canvas')
    Object.assign(svg, {
      getScreenCTM: () => ({ inverse: () => ({}) }),
      createSVGPoint: () => ({
        x: 0,
        y: 0,
        matrixTransform() {
          return { x: this.x, y: this.y }
        },
      }),
      setPointerCapture: vi.fn(),
      hasPointerCapture: () => false,
    })
    fireEvent.pointerDown(screen.getByTestId('vertex-b'), { button: 0, clientX: 400, clientY: 300 })
    fireEvent.pointerMove(svg, { clientX: 440, clientY: 340 })
    fireEvent.pointerUp(svg)
    expect(saved().vertices[1]).toMatchObject({ id: 'b', re: 1, im: -1, mathematicalKind: 'pole' })
    expect(saved().markers).toHaveLength(0)
    const command = screen.getByTestId('segment-avoid:cut:arc').getAttribute('d')!.split(/\s+/)
    for (const [x, y] of [
      [Number(command[1]), Number(command[2])],
      [Number(command[9]), Number(command[10])],
    ]) {
      expect(Math.hypot((x - 400) / 40 - 1, (300 - y) / 40 + 1)).toBeCloseTo(0.5, 10)
    }
    await user.click(screen.getByRole('button', { name: '撤销' }))
    expect(saved().vertices).toEqual(state.vertices)
    expect(screen.getByRole('button', { name: '撤销' })).toBeDisabled()
  })
})
