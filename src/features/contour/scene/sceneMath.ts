import { defaultLabel } from '../appearance'
import type { ContourState } from '../model'
import type { ResolvedScene } from './resolvedScene'

/** Include every measured text, even currently hidden formula/axis bounds. */
export function sceneMathTexts(state: ContourState, scenes: readonly ResolvedScene[]): Set<string> {
  const texts = new Set([state.axes.reLabel, state.axes.imLabel])
  const addLabel = (label: ReturnType<typeof defaultLabel>) => {
    if (label.visible && label.tex.trim()) texts.add(label.tex)
  }
  state.vertices.forEach((v, i) => addLabel(v.label ?? defaultLabel(`z_{${i + 1}}`)))
  state.markers.forEach((m) => addLabel(m.label))
  state.formulas.forEach((f) => texts.add(f.label.tex))
  for (const scene of scenes) {
    scene.labels.forEach((l) => addLabel(l.value))
    if (state.handles)
      [...scene.contourSegments, ...scene.connectionSegments].forEach((s, i) => {
        if (s.kind === 'arc' && scene.origins.get(s.id)?.kind === 'source')
          texts.add(`q_{${i + 1}}`)
      })
  }
  return texts
}
