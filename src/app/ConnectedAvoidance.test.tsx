import { fireEvent, render, screen } from '@testing-library/react'
import { useReducer } from 'react'
import { expect, it } from 'vitest'
import { createConnectedFixture } from '../test/connectedAvoidanceFixtures'
import { createAvoidanceFixture } from '../test/avoidanceFixtures'
import { AvoidanceProperties } from '../features/contour/avoidance/AvoidanceProperties'
import { CanvasScene } from '../features/contour/scene/CanvasScene'
import { createHistory, historyReducer } from '../features/contour/history'
import { useAvoidanceDraft } from '../features/contour/avoidance/useAvoidanceDraft'

function Properties({
  child = false,
  legacy = false,
  legacyDiameter = false,
}: {
  child?: boolean
  legacy?: boolean
  legacyDiameter?: boolean
}) {
  const [history, dispatch] = useReducer(historyReducer, undefined, () => {
    const state = createConnectedFixture(child ? { clearanceRadius: 0.1 } : {})
    if (legacy) {
      const old = createAvoidanceFixture()
      old.markers[0].im = 1
      old.avoidances[0].id = 'parent'
      if (legacyDiameter) old.avoidances[0].openingRatio = 1
      state.vertices = old.vertices
      state.segments = old.segments
      state.markers = [...old.markers, { ...old.markers[0], id: 'other', im: 0.25 }]
      state.avoidances = [
        ...old.avoidances,
        {
          kind: 'bank-clearance',
          id: 'clearance',
          markerId: 'other',
          parentAvoidanceId: 'parent',
          radius: 0.27,
        },
      ]
    }
    state.selection = {
      kind: 'segment',
      id: child ? 'avoid:clearance:bank-entry' : 'avoid:parent:arc',
    }
    return createHistory(state)
  })
  const workflow = useAvoidanceDraft(history.present, dispatch)
  return (
    <>
      <AvoidanceProperties
        state={history.present}
        dispatch={dispatch}
        workflow={workflow}
        avoidanceId={child ? 'clearance' : 'parent'}
      />
      <CanvasScene state={history.present} avoidanceWorkflow={workflow} />
      <output aria-label="应用文档">{JSON.stringify(history.present)}</output>
      <output aria-label="历史步数">{history.past.length}</output>
    </>
  )
}
const documentState = () => JSON.parse(screen.getByLabelText('应用文档').textContent!)
function enter(label: string, value: string) {
  const field = screen.getByLabelText(label)
  fireEvent.change(field, { target: { value } })
  fireEvent.keyDown(field, { key: 'Enter' })
}

it('commits radius and gap independently with Enter or blur', () => {
  render(<Properties />)
  enter('绕行半径', '0.2')
  expect(documentState().avoidances[0]).toMatchObject({ radius: 0.2, gap: 0.04 })
  const field = screen.getByLabelText('两岸间距')
  fireEvent.change(field, { target: { value: '0.06' } })
  fireEvent.blur(field)
  expect(documentState().avoidances[0]).toMatchObject({ radius: 0.2, gap: 0.06 })
  expect(screen.getByLabelText('历史步数')).toHaveTextContent('2')
  expect(screen.queryByLabelText('绕行侧')).toBeNull()
  expect(screen.queryByLabelText('偏好开口宽度')).toBeNull()
})

it('edits one child bank appearance without altering the other', () => {
  render(<Properties child />)
  fireEvent.change(screen.getByLabelText('线条粗细'), { target: { value: '5' } })
  expect(documentState().avoidances[1].partStyles).toEqual({ 'bank-entry': { width: 5 } })
  fireEvent.change(screen.getByLabelText('绕行部件'), { target: { value: 'bank-exit' } })
  fireEvent.change(screen.getByLabelText('线型'), { target: { value: 'dashed' } })
  expect(documentState().avoidances[1].partStyles).toEqual({
    'bank-entry': { width: 5 },
    'bank-exit': { dash: 'dashed' },
  })
})

it('keeps no-cut child settings and restores its exterior arc after radius growth', () => {
  render(<Properties child />)
  fireEvent.change(screen.getByLabelText('线条粗细'), { target: { value: '5' } })
  enter('绕行半径', '0.01')
  expect(screen.queryByTestId('segment-avoid:clearance:bank-entry')).toBeNull()
  expect(screen.getByLabelText('绕行半径')).toHaveValue('0.01')
  enter('绕行半径', '0.1')
  expect(screen.getByTestId('segment-avoid:clearance:bank-entry')).toHaveAttribute(
    'stroke-width',
    '5',
  )
})

it('updates the shared parent gap from a child and refuses invalid geometry', () => {
  render(<Properties child />)
  enter('两岸间距', '0.06')
  expect(documentState().avoidances[0].gap).toBe(0.06)
  expect(documentState().avoidances[1].gap).toBeUndefined()
  enter('两岸间距', '0.5')
  expect(documentState().avoidances[0].gap).toBe(0.06)
  expect(screen.getByLabelText('两岸间距')).toHaveValue('0.06')
})

it('provides one add entry without a construction-mode selector', () => {
  const state = createConnectedFixture()
  state.avoidances = []
  function Entry() {
    const [history, dispatch] = useReducer(historyReducer, state, createHistory)
    const workflow = useAvoidanceDraft(history.present, dispatch)
    return (
      <AvoidanceProperties
        state={history.present}
        dispatch={dispatch}
        workflow={workflow}
        markerId="center"
      />
    )
  }
  render(<Entry />)
  expect(screen.getAllByRole('button', { name: '添加绕行' })).toHaveLength(1)
  expect(screen.queryByLabelText('接入方式')).toBeNull()
})

it('accepts 45, zero and negative opening angles while preserving radius and gap', () => {
  render(<Properties />)
  for (const [text, segmentId, t] of [
    ['45', 'upper', 0.25],
    ['0', 'upper', 0],
    ['-90', 'lower', 0.5],
  ] as const) {
    enter('开口朝向（度）', text)
    const a = documentState().avoidances[0]
    expect(a).toMatchObject({ radius: 0.1, gap: 0.04 })
    expect(a.anchor.segmentId).toBe(segmentId)
    if (t === 0) expect(a.anchor).toMatchObject({ kind: 'vertex', vertexId: 'right' })
    else expect(a.anchor.t).toBeCloseTo(t, 9)
  }
  expect(screen.getByLabelText('历史步数')).toHaveTextContent('3')
})

it('offers restoring automatic normal following after a manual direction edit', () => {
  render(<Properties />)
  enter('开口朝向（度）', '45')
  expect(documentState().avoidances[0].alignment).toEqual({ kind: 'direction', angle: 45 })
  fireEvent.click(screen.getByRole('button', { name: '恢复法向跟随' }))
  expect(documentState().avoidances[0].alignment).toEqual({ kind: 'normal' })
  expect(screen.getByText('移动奇点时，接入口沿源路径法向跟随。')).toBeInTheDocument()
})

it('does not offer an independent opening direction on a child clearance', () => {
  render(<Properties child />)
  fireEvent.click(screen.getByRole('button', { name: '定位父绕行' }))
  // This harness intentionally holds its child editor; direction belongs only to the parent.
  expect(screen.queryByLabelText('开口朝向（度）')).toBeNull()
})

it('edits a legacy parent spacing from its child while preserving radius and the child', () => {
  render(<Properties child legacy />)
  expect(screen.getByLabelText('两岸间距')).toHaveValue('0.5')
  enter('两岸间距', '0.4')
  expect(documentState().avoidances[0]).toMatchObject({ kind: 'corridor', gap: 0.4, radius: 0.5 })
  expect(documentState().avoidances[1]).toMatchObject({ id: 'clearance', radius: 0.27 })
  expect(screen.getByLabelText('历史步数')).toHaveTextContent('1')
})

it('keeps the compatible form for a legacy diameter opening and accepts a smaller radius', () => {
  render(<Properties legacy legacyDiameter />)
  expect(screen.getByLabelText('偏好开口宽度')).toHaveValue('1')
  expect(screen.queryByLabelText('开口朝向（度）')).toBeNull()
  enter('绕行半径', '0.4')
  expect(documentState().error).toBe('')
  expect(documentState().avoidances[0]).toMatchObject({ radius: 0.4, openingRatio: 1 })
  expect(documentState().avoidances[0].kind).toBeUndefined()
  expect(screen.getByLabelText('历史步数')).toHaveTextContent('1')
})
