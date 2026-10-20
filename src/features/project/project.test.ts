import { describe, expect, it } from 'vitest'
import { contourReducer, createInitialState, createSemicircleState } from '../contour/model'
import { defaultLabel } from '../contour/appearance'
import { createHistory, historyReducer } from '../contour/history'
import { MAX_PROJECT_BYTES, parseProject, serializeProject, type ProjectFile } from './project'

const fixture = (): ProjectFile =>
  JSON.parse(serializeProject(createSemicircleState())) as ProjectFile

function nearLimitProject(): ProjectFile {
  const project = fixture()
  project.document.vertices = Array.from({ length: 1000 }, (_, i) => ({
    id: `v-${i}`,
    re: i % 20,
    im: Math.floor(i / 20),
    label: defaultLabel('z'),
  }))
  project.document.segments = project.document.vertices.map((point, i, points) => ({
    id: `s-${i}`,
    kind: 'line',
    startId: point.id,
    endId: points[(i + 1) % points.length].id,
  }))
  const padding = Math.floor((MAX_PROJECT_BYTES - JSON.stringify(project).length - 20) / 1000)
  project.document.vertices.forEach((point) => {
    point.label!.tex = ' '.repeat(padding) + 'z'
  })
  let remaining = MAX_PROJECT_BYTES - JSON.stringify(project).length - 10
  for (const point of project.document.vertices) {
    const count = Math.min(remaining, 2000 - point.label!.tex.length)
    point.label!.tex = ' '.repeat(count) + point.label!.tex
    remaining -= count
    if (!remaining) break
  }
  return project
}

describe('versioned project files', () => {
  it('can save and reopen an accepted compact file near the byte limit', () => {
    const raw = JSON.stringify(nearLimitProject())
    expect(new TextEncoder().encode(raw).length).toBeLessThan(MAX_PROJECT_BYTES)
    const state = parseProject(raw)
    expect(() => parseProject(serializeProject(state))).not.toThrow()
  })

  it('rejects edits that would make an otherwise valid project too large to recover', () => {
    const state = parseProject(JSON.stringify(nearLimitProject()))
    const last = state.vertices[state.vertices.length - 1]
    const edited = contourReducer(state, {
      type: 'label',
      target: { kind: 'vertex', id: last.id },
      label: { ...last.label!, tex: ' '.repeat(1999) + 'z' },
    })
    expect(edited.vertices).toBe(state.vertices)
    expect(edited.error).toContain('2 MB')
  })

  it('rejects creating objects beyond the project reader capacity', () => {
    const base = createInitialState()
    const object = contourReducer(base, { type: 'addFormula', id: 'f', point: { re: 0, im: 0 } })
      .formulas[0]
    const state = {
      ...base,
      formulas: Array.from({ length: 200 }, (_, i) => ({ ...object, id: `formula-${i}` })),
    }
    const edited = contourReducer(state, {
      type: 'addFormula',
      id: 'extra',
      point: { re: 0, im: 0 },
    })
    expect(edited.formulas).toHaveLength(200)
    expect(edited.error).toContain('200')
  })
  it('round-trips curves, local style inheritance, labels, objects and view preferences', () => {
    let state = createSemicircleState()
    state = contourReducer(state, { type: 'stroke', id: 'edge-b', patch: { color: '#cc2233' } })
    state = contourReducer(state, { type: 'fill', patch: { mode: 'hatch', opacity: 0.5 } })
    state = contourReducer(state, {
      type: 'label',
      target: { kind: 'vertex', id: 'a' },
      label: defaultLabel('-R'),
    })
    state = contourReducer(state, { type: 'addMarker', id: 'pole', point: { re: 0, im: 1 } })
    state = contourReducer(state, { type: 'addFormula', id: 'formula', point: { re: -1, im: 3 } })
    state = contourReducer(state, {
      type: 'label',
      target: { kind: 'formula', id: 'formula' },
      label: defaultLabel('\\frac{1}{z}'),
    })
    state = contourReducer(state, { type: 'toggleGrid' })
    const restored = parseProject(serializeProject(state))
    expect(restored.vertices).toEqual(state.vertices)
    expect(restored.segments).toEqual(state.segments)
    expect(restored.segments[1].style).toEqual({ color: '#cc2233' })
    expect(restored.markers).toEqual(state.markers)
    expect(restored.formulas).toEqual(state.formulas)
    expect(restored.appearance).toEqual(state.appearance)
    expect(restored.grid).toBe(false)
    expect(restored.closed).toBe(true)
    expect(restored.selectedId).toBe('a')
  })

  it('rejects invalid JSON and unknown file formats or versions', () => {
    expect(() => parseProject('{')).toThrow(/JSON/)
    expect(() => parseProject('null')).toThrow()
    expect(() => parseProject(JSON.stringify({ ...fixture(), version: 99 }))).toThrow(/版本/)
    expect(() => parseProject(JSON.stringify({ ...fixture(), format: 'another-app' }))).toThrow(
      /项目文件/,
    )
  })

  it('rejects duplicate IDs and broken ordered endpoint references', () => {
    const duplicate = fixture()
    duplicate.document.vertices[1].id = 'a'
    expect(() => parseProject(JSON.stringify(duplicate))).toThrow(/重复/)
    const broken = fixture()
    broken.document.segments[0].endId = 'missing'
    expect(() => parseProject(JSON.stringify(broken))).toThrow(/连接/)
  })

  it('rejects non-finite coordinates, degenerate arcs and invalid two-line closure', () => {
    const invalid = fixture()
    invalid.document.vertices[0].re = Infinity
    expect(() => parseProject(JSON.stringify(invalid))).toThrow(/有限/)
    const flat = fixture()
    const arc = flat.document.segments[1]
    if (arc.kind !== 'arc') throw new Error('Expected fixture arc')
    arc.through = { re: 0, im: 0 }
    expect(() => parseProject(JSON.stringify(flat))).toThrow(/共线/)
    const lines = fixture()
    lines.document.segments[1] = { id: 'edge-b', startId: 'b', endId: 'a', kind: 'line' }
    expect(() => parseProject(JSON.stringify(lines))).toThrow(/闭合/)
  })

  it('rejects invalid appearance, formula source and unsafe IDs', () => {
    const badStyle = fixture()
    badStyle.document.appearance.fill.opacity = 2
    expect(() => parseProject(JSON.stringify(badStyle))).toThrow(/填充/)
    const badLabel = fixture()
    badLabel.document.vertices[0].label = defaultLabel('\\unknownCommand')
    expect(() => parseProject(JSON.stringify(badLabel))).toThrow(/公式/)
    const badId = fixture()
    badId.document.vertices[0].id = 'bad"id'
    expect(() => parseProject(JSON.stringify(badId))).toThrow(/ID/)
  })

  it('loading a valid file is one undoable document replacement', () => {
    const original = createInitialState()
    const loaded = parseProject(serializeProject(createSemicircleState()))
    let history = historyReducer(createHistory(original), { type: 'loadProject', state: loaded })
    expect(history.present.segments[1].kind).toBe('arc')
    expect(history.past).toHaveLength(1)
    history = historyReducer(history, { type: 'undo' })
    expect(history.present.vertices).toEqual(original.vertices)
    expect(historyReducer(history, { type: 'redo' }).present.segments).toEqual(loaded.segments)
  })
})
