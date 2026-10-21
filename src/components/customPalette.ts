export const CUSTOM_PALETTE_KEY = 'contour-editor.custom-palette.v1'
export const MAX_CUSTOM_COLORS = 8

type PaletteStorage = Pick<Storage, 'getItem' | 'setItem'>

function canonicalColor(value: unknown): string | undefined {
  return typeof value === 'string' && /^#[\da-f]{6}$/i.test(value) ? value.toLowerCase() : undefined
}

function readColors(raw: string | null): readonly string[] {
  try {
    const parsed: unknown = JSON.parse(raw ?? '[]')
    if (!Array.isArray(parsed)) return []
    return [...new Set(parsed.map(canonicalColor).filter((color) => color !== undefined))].slice(
      0,
      MAX_CUSTOM_COLORS,
    )
  } catch {
    return []
  }
}

export function createCustomPaletteStore(getStorage: () => PaletteStorage = () => localStorage) {
  let colors: readonly string[] = []
  let savedRaw: string | null | undefined
  const listeners = new Set<() => void>()

  const getSnapshot = () => {
    try {
      const raw = getStorage().getItem(CUSTOM_PALETTE_KEY)
      if (raw !== savedRaw) {
        savedRaw = raw
        colors = readColors(raw)
      }
    } catch {
      // A blocked browser store still leaves the shared in-memory palette usable.
    }
    return colors
  }

  const publish = (next: readonly string[]) => {
    colors = next
    try {
      const raw = JSON.stringify(next)
      getStorage().setItem(CUSTOM_PALETTE_KEY, raw)
      savedRaw = raw
    } catch {
      // Keep the last readable raw value so a failed write cannot roll memory back.
    }
    listeners.forEach((listener) => listener())
  }

  return {
    getSnapshot,
    remove: (value: string) => {
      const color = canonicalColor(value)
      if (!color) return
      const current = getSnapshot()
      if (current.includes(color)) publish(current.filter((saved) => saved !== color))
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    // Return only the slot owned by this chooser session, never an unrelated duplicate.
    remember: (value: string, replacing?: string): string | undefined => {
      const color = canonicalColor(value)
      if (!color) return undefined
      const current = getSnapshot()
      const index = current.indexOf(canonicalColor(replacing) ?? '')
      if (current.includes(color)) {
        if (index !== -1 && current[index] !== color) {
          publish(current.filter((_, position) => position !== index))
        }
        return current[index] === color ? color : undefined
      }
      if (index !== -1) {
        publish(current.map((saved, position) => (position === index ? color : saved)))
      } else if (current.length < MAX_CUSTOM_COLORS) {
        publish([...current, color])
      } else {
        return undefined
      }
      return color
    },
  }
}

export const customPaletteStore = createCustomPaletteStore()
