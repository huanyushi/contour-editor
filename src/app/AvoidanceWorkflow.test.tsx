import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useReducer } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { ContourCanvas, type DrawingTool } from '../features/contour/ContourCanvas'
import { createHistory, historyReducer, type EditorAction } from '../features/contour/history'
import type { ContourState } from '../features/contour/model'
import type { AvoidanceWorkflow } from '../features/contour/useAvoidanceDraft'
import { useAvoidanceDraft } from '../features/contour/useAvoidanceDraft'
import { serializeProject } from '../features/project/format'
import { defaultExportOptions, serializeSvg } from '../features/project/export'
import { downloadBlob } from '../features/project/download'
import { DRAFT_KEY } from '../features/project/useLocalDraft'
import { createAvoidanceFixture } from '../test/avoidanceFixtures'
import { loadTemplate, selectObject } from '../test/navigation'

// Observe App-owned state to verify that the real workflow isolates its draft.
const observed = vi.hoisted(
  () =>
    ({}) as {
      workflow: AvoidanceWorkflow
      state: ContourState
      dispatch: React.Dispatch<EditorAction>
    },
)
vi.mock('../features/contour/useAvoidanceDraft', async (importOriginal) => {
  const original = await importOriginal<typeof import('../features/contour/useAvoidanceDraft')>()
  return {
    ...original,
    useAvoidanceDraft: (...args: Parameters<typeof original.useAvoidanceDraft>) => {
      observed.workflow = original.useAvoidanceDraft(...args)
      observed.state = args[0]
      observed.dispatch = args[1]
      return observed.workflow
    },
  }
})
vi.mock('../features/project/download', () => ({ downloadBlob: vi.fn() }))

beforeEach(() => {
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
  vi.clearAllMocks()
})

function sourceFixture() {
  const state = createAvoidanceFixture()
  state.avoidances = []
  state.markers[0].im = -2
  return state
}

function mountApp(narrow = false) {
  vi.stubGlobal('innerWidth', narrow ? 390 : 1200)
  const saved = serializeProject(sourceFixture())
  localStorage.setItem(DRAFT_KEY, saved)
  const view = render(<App />)
  return { ...view, saved }
}

function hit(id = 'edge-a') {
  return document.querySelector<SVGPathElement>(`.segment-hit[data-source-segment-id="${id}"]`)!
}

function preparePointerGeometry() {
  const svg = screen.getByTestId('contour-canvas')
  Object.assign(svg, {
    getScreenCTM: () => ({ a: 1, b: 0, c: 0, d: 1, inverse: () => ({}) }),
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
  return svg
}

function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.readAsText(blob)
  })
}

describe('App avoidance workflow integration', () => {
  it('isolates preview from history, local draft, project downloads and SVG downloads until apply', async () => {
    const user = userEvent.setup()
    const { saved } = mountApp()
    const sourcePath = screen.getByTestId('segment-edge-a').getAttribute('d')
    act(() => observed.workflow.start('pole'))
    expect(screen.getByRole('button', { name: '选择工具' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.pointerDown(hit(), { button: 0 })
    act(() => observed.workflow.patch({ radius: 0.25 }))
    const preview = screen.getByTestId('avoidance-preview')
    expect(preview).toHaveAttribute('data-export-omit')
    expect(preview).toHaveAttribute('pointer-events', 'none')
    expect(preview.querySelectorAll('path[data-preview-part]')).toHaveLength(3)
    expect(
      preview.querySelector('.segment-hit, .vertex, [data-testid^="label-handle-"]'),
    ).toBeNull()
    expect(screen.queryByTestId('segment-edge-a')).toBeNull()
    expect(screen.getByTestId('export-original-segment-edge-a')).toHaveAttribute('d', sourcePath)
    expect(serializeProject(observed.state)).toBe(saved)
    expect(screen.getByRole('button', { name: '撤销' })).toBeDisabled()
    fireEvent(window, new Event('pagehide'))
    expect(localStorage.getItem(DRAFT_KEY)).toBe(saved)
    await user.click(screen.getByRole('button', { name: '保存项目' }))
    const savedBlob = vi.mocked(downloadBlob).mock.calls[0][0]
    expect(await readBlob(savedBlob)).toBe(saved)
    await user.click(screen.getByText('导出', { exact: true }))
    await user.click(screen.getByRole('button', { name: '导出 SVG' }))
    const svgText = await readBlob(vi.mocked(downloadBlob).mock.calls[1][0])
    expect(svgText).not.toMatch(/avoidance-|avoid:|data-preview-part/)
    expect(svgText).not.toMatch(/ A /)
    const liveExport = serializeSvg(
      screen.getByTestId('contour-canvas') as unknown as SVGSVGElement,
      defaultExportOptions(),
    )
    expect(liveExport).not.toMatch(/avoidance-|avoid:|data-preview-part| A /)
    act(() => observed.workflow.apply())
    expect(screen.queryByTestId('avoidance-preview')).toBeNull()
    expect(observed.state.avoidances).toHaveLength(1)
    expect(screen.getByRole('button', { name: '撤销' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: '撤销' }))
    expect(observed.state.avoidances).toEqual([])
    expect(screen.getByRole('button', { name: '撤销' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: '重做' }))
    expect(observed.state.avoidances).toHaveLength(1)
  })

  it('narrow auto-hide preserves picking, then reopens and focuses configuration; Esc cancels before closing the panel', async () => {
    const user = userEvent.setup()
    mountApp(true)
    await user.click(screen.getByRole('button', { name: '线段工具' }))
    act(() => observed.workflow.start('pole'))
    expect(observed.workflow.draft.kind).toBe('pickTarget')
    expect(screen.getByRole('button', { name: '选择工具' })).toHaveAttribute('aria-pressed', 'true')
    expect(document.getElementById('properties-panel')).not.toBeVisible()
    fireEvent.pointerDown(hit(), { button: 0 })
    expect(observed.workflow.draft.kind).toBe('configure')
    expect(document.getElementById('properties-panel')).toBeVisible()
    await waitFor(() => expect(screen.getByLabelText('属性面板内容')).toHaveFocus())
    fireEvent.keyDown(screen.getByLabelText('属性面板内容'), { key: 'Escape' })
    expect(observed.workflow.draft.kind).toBe('idle')
    expect(screen.queryByTestId('avoidance-preview')).toBeNull()
    expect(document.getElementById('properties-panel')).toBeVisible()
    await waitFor(() => expect(screen.getByTestId('contour-canvas')).toHaveFocus())
  })

  it('moves focus from a narrow Inspector creation control to canvas so immediate Escape cancels without history', async () => {
    const user = userEvent.setup()
    const { saved } = mountApp(true)
    await selectObject(user, '选择标记点 1')
    await waitFor(() => expect(screen.getByLabelText('属性面板内容')).toHaveFocus())
    const trigger = screen.getByRole('button', { name: '添加绕行' })
    trigger.focus()
    expect(trigger).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(observed.workflow.draft).toEqual({ kind: 'pickTarget', markerId: 'pole' })
    expect(document.getElementById('properties-panel')).not.toBeVisible()
    const canvas = screen.getByTestId('contour-canvas')
    expect(canvas).toHaveFocus()
    expect(serializeProject(observed.state)).toBe(saved)
    expect(screen.getByRole('button', { name: '撤销' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '重做' })).toBeDisabled()

    await user.keyboard('{Escape}')
    expect(observed.workflow.draft).toEqual({ kind: 'idle' })
    expect(screen.queryByTestId('avoidance-preview')).toBeNull()
    expect(canvas).toHaveFocus()
    expect(document.getElementById('properties-panel')).not.toBeVisible()
    expect(serializeProject(observed.state)).toBe(saved)
    expect(localStorage.getItem(DRAFT_KEY)).toBe(saved)
    expect(screen.getByRole('button', { name: '撤销' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '重做' })).toBeDisabled()
  })

  it.each(['tool', 'close', 'template', 'project'] as const)(
    'cancels configured preview on explicit %s action',
    async (action) => {
      const user = userEvent.setup()
      mountApp()
      act(() => observed.workflow.start('pole'))
      fireEvent.pointerDown(hit(), { button: 0 })
      expect(screen.getByTestId('avoidance-preview')).toBeInTheDocument()
      if (action === 'tool') await user.click(screen.getByRole('button', { name: '独立点工具' }))
      if (action === 'close') await user.click(screen.getByRole('button', { name: '收起属性面板' }))
      if (action === 'template') await loadTemplate(user, '上半圆围道')
      if (action === 'project') {
        const file = new File([serializeProject(sourceFixture())], 'same-ids.json', {
          type: 'application/json',
        })
        Object.defineProperty(file, 'text', {
          value: async () => serializeProject(sourceFixture()),
        })
        await user.upload(screen.getByLabelText('打开项目文件'), file)
        await screen.findByText('已打开 same-ids.json')
      }
      expect(observed.workflow.draft.kind).toBe('idle')
      expect(screen.queryByTestId('avoidance-preview')).toBeNull()
      expect(observed.state.avoidances).toEqual([])
    },
  )

  it('displays invalid preview errors without changing accepted geometry and cancels invalidated sources', () => {
    const { saved } = mountApp()
    act(() => observed.workflow.start('pole'))
    fireEvent.pointerDown(hit(), { button: 0 })
    act(() => observed.workflow.patch({ radius: 4 }))
    expect(screen.getByRole('alert')).toHaveTextContent(/半径|端点/)
    expect(screen.queryByTestId('avoidance-preview')).toBeNull()
    act(() => observed.workflow.apply())
    expect(serializeProject(observed.state)).toBe(saved)
    act(() => observed.dispatch({ type: 'deleteSegment', id: 'edge-a' }))
    expect(observed.workflow.draft.kind).toBe('idle')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('cancels creation before a nested export menu consumes Escape', async () => {
    const user = userEvent.setup()
    mountApp()
    act(() => observed.workflow.start('pole'))
    fireEvent.pointerDown(hit(), { button: 0 })
    await user.click(screen.getByText('导出', { exact: true }))
    fireEvent.keyDown(screen.getByRole('button', { name: '导出 SVG' }), { key: 'Escape' })
    expect(observed.workflow.draft.kind).toBe('idle')
    expect(screen.queryByTestId('avoidance-preview')).toBeNull()
  })

  it('Escape cancels both picking and an active pan without leaving a live drag', () => {
    mountApp()
    const svg = preparePointerGeometry()
    act(() => observed.workflow.start('pole'))
    const before = observed.state.viewport
    fireEvent.pointerDown(svg, { button: 1, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(svg, { clientX: 140, clientY: 120 })
    expect(observed.state.viewport.centerRe).not.toBe(before.centerRe)
    fireEvent.keyDown(svg, { key: 'Escape' })
    expect(observed.workflow.draft.kind).toBe('idle')
    expect(observed.state.viewport).toEqual(before)
    fireEvent.pointerMove(svg, { clientX: 180, clientY: 160 })
    expect(observed.state.viewport).toEqual(before)
  })
})

describe('canvas target-pick event priority', () => {
  it.each(['select', 'line', 'marker', 'add', 'arc', 'formula', 'marquee'] as DrawingTool[])(
    'intercepts %s events without selecting, dragging or creating source objects',
    (tool) => {
      const actions: EditorAction[] = []
      const arc = vi.fn()
      function Harness() {
        const [history, dispatch] = useReducer(historyReducer, sourceFixture(), createHistory)
        const workflow = useAvoidanceDraft(history.present, dispatch)
        return (
          <ContourCanvas
            state={history.present}
            dispatch={(action) => {
              actions.push(action)
              dispatch(action)
            }}
            gestureOwner={history.gesture?.owner ?? null}
            tool={tool}
            onArcPoint={arc}
            avoidanceWorkflow={workflow}
          />
        )
      }
      render(<Harness />)
      const svg = preparePointerGeometry()
      const before = serializeProject(observed.state)
      act(() => observed.workflow.start('pole'))
      for (const node of [
        screen.getByTestId('vertex-a'),
        screen.getByTestId('marker-pole'),
        screen.getByTestId('label-handle-a'),
        svg,
      ]) {
        fireEvent.pointerDown(node, { button: 0, clientX: 400, clientY: 300 })
        fireEvent.pointerMove(svg, { clientX: 440, clientY: 340 })
        fireEvent.pointerUp(svg)
      }
      expect(observed.workflow.draft.kind).toBe('pickTarget')
      expect(actions).toEqual([])
      fireEvent.pointerDown(hit(), { button: 0, ctrlKey: true })
      expect(observed.workflow.draft.kind).toBe('configure')
      expect(actions).toEqual([])
      expect(arc).not.toHaveBeenCalled()
      expect(serializeProject(observed.state)).toBe(before)
      fireEvent.keyDown(svg, { key: 'Escape' })
      expect(observed.workflow.draft.kind).toBe('idle')
    },
  )

  it('preserves middle-button panning and wheel zoom while picking', () => {
    function Harness() {
      const [history, dispatch] = useReducer(historyReducer, sourceFixture(), createHistory)
      const workflow = useAvoidanceDraft(history.present, dispatch)
      return (
        <ContourCanvas
          state={history.present}
          dispatch={dispatch}
          gestureOwner={history.gesture?.owner ?? null}
          tool="select"
          onArcPoint={() => {}}
          avoidanceWorkflow={workflow}
        />
      )
    }
    render(<Harness />)
    const svg = preparePointerGeometry()
    act(() => observed.workflow.start('pole'))
    const before = observed.state.viewport
    fireEvent.pointerDown(screen.getByTestId('vertex-a'), { button: 1, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(svg, { clientX: 140, clientY: 120 })
    fireEvent.pointerUp(svg)
    expect(observed.state.viewport.centerRe).not.toBe(before.centerRe)
    expect(observed.workflow.draft.kind).toBe('pickTarget')
    fireEvent.wheel(svg, { deltaY: -100, clientX: 400, clientY: 300 })
    expect(observed.state.viewport.scaleX).toBeGreaterThan(before.scaleX)
    expect(observed.workflow.draft.kind).toBe('pickTarget')
  })
})
