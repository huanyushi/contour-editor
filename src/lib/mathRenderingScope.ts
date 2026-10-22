import { renderMath, type MathRendering } from './math'

export type MathRenderer = (tex: string) => MathRendering

export interface MathRenderingScope {
  render: MathRenderer
  retain: (texts: Iterable<string>) => void
}

/** One live drawing/export owns its results, never past document snapshots. */
export function createMathRenderingScope(renderer: MathRenderer = renderMath): MathRenderingScope {
  let retained = new Set<string>()
  const results = new Map<string, MathRendering>()
  return {
    retain(texts) {
      retained = new Set(texts)
      for (const text of results.keys()) if (!retained.has(text)) results.delete(text)
    },
    render(text) {
      if (!retained.has(text)) return renderer(text)
      const cached = results.get(text)
      if (cached) return cached
      const result = renderer(text)
      results.set(text, result)
      return result
    },
  }
}
