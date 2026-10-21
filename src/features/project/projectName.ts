export const DEFAULT_PROJECT_NAME = 'Untitled'
export const MAX_PROJECT_NAME_LENGTH = 100

export function normalizeProjectName(value: string): string | null {
  const name = value
    .trim()
    .slice(0, MAX_PROJECT_NAME_LENGTH)
    .replace(/[\uD800-\uDBFF]$/, '')
    .trim()
  return name || null
}

export function projectDownloadName(name: string, format: 'json' | 'svg' | 'png' = 'json'): string {
  let base = (normalizeProjectName(name) ?? DEFAULT_PROJECT_NAME)
    .replace(/[<>:"/\\|?*\p{Cc}]/gu, '-')
    .replace(/[. ]+$/, '')
    .replace(/(?:\.(?:json|svg|png))+$/i, '')
    .replace(/[. ]+$/, '')
  if (!base) base = DEFAULT_PROJECT_NAME
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(base)) base = `_${base}`
  // Leave room for the extension on filesystems with a 255-byte name limit.
  const encoder = new TextEncoder()
  while (encoder.encode(base).length > 240) base = Array.from(base).slice(0, -1).join('')
  return `${base.replace(/[. ]+$/, '')}.${format}`
}
