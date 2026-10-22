import type { ContourState, PathSegment } from './model'
import { resolvedScene, logicalSegmentId } from './sceneObjects'
import { activeSegments } from './pathTopology'

export interface PathObjectRow {
  id: string
  kind: PathSegment['kind']
  name: string
  accessibleName: string
  description: string
}
const partNames = {
  entry: '进入连接段',
  arc: '绕行圆弧',
  exit: '离开连接段',
  'bank-entry': '进入岸避让弧',
  'bank-exit': '离开岸避让弧',
}

/** The list exposes the same logical objects that canvas selection edits. */
export function pathObjectRows(
  state: ContourState,
  collection: 'contour' | 'connection',
): PathObjectRow[] {
  const scene = resolvedScene(state)
  const sources = collection === 'contour' ? state.segments : state.connections
  const visible = new Set(activeSegments(state).map((s) => s.id))
  const seen = new Set<string>()
  return sources.flatMap((source, index) => {
    const chain = scene.chains.get(source.id) ?? []
    const prefix = collection === 'contour' ? '路径段' : '独立路径段'
    if (!chain.some((s) => s.origin.kind !== 'source')) {
      if (!chain.length && (collection === 'connection' || visible.has(source.id))) return []
      return [
        {
          id: source.id,
          kind: source.kind,
          name:
            collection === 'connection'
              ? `${source.kind === 'arc' ? '圆弧' : '线段'} ${index + 1}`
              : `${prefix} ${index + 1}`,
          accessibleName: `选择${prefix} ${index + 1}`,
          description:
            collection === 'contour' && !visible.has(source.id)
              ? '暂存闭合边'
              : source.kind === 'arc'
                ? '圆弧'
                : '线段',
        },
      ]
    }
    let pieces = 0
    return chain.flatMap((segment): PathObjectRow[] => {
      const id = logicalSegmentId(state, segment.id)
      if (seen.has(id)) return []
      seen.add(id)
      const origin = segment.origin
      if (origin.kind === 'avoidance') {
        const number = state.avoidances.findIndex((a) => a.id === origin.avoidanceId) + 1
        const name = partNames[origin.part]
        return [
          {
            id,
            kind: segment.kind,
            name,
            accessibleName: `选择绕行 ${number} 的${name}`,
            description: `绕行 ${number}`,
          },
        ]
      }
      pieces++
      return [
        {
          id,
          kind: segment.kind,
          name: `${prefix} ${index + 1} · 保留段 ${pieces}`,
          accessibleName: `选择${prefix} ${index + 1} 的保留段 ${pieces}`,
          description: segment.kind === 'arc' ? '圆弧' : '线段',
        },
      ]
    })
  })
}
