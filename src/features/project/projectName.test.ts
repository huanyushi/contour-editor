import { describe, expect, it } from 'vitest'
import { normalizeProjectName, projectDownloadName } from './projectName'

describe('project names', () => {
  it('rejects empty names, trims valid ones and bounds their length', () => {
    expect(normalizeProjectName(' \t\n ')).toBeNull()
    expect(normalizeProjectName('  钥匙孔 / Contour  ')).toBe('钥匙孔 / Contour')
    expect(normalizeProjectName('a'.repeat(101))).toBe('a'.repeat(100))
  })

  it.each([
    ['Keyhole Contour', 'Keyhole Contour.json'],
    ['钥匙孔围道', '钥匙孔围道.json'],
    ['name.JSON.json', 'name.json'],
    ['a/b:c*?"<>|', 'a-b-c------.json'],
    ['a\u0000b', 'a-b.json'],
    ['  name...  ', 'name.json'],
    ['name.json... ', 'name.json'],
    ['CON', '_CON.json'],
    ['lpt1.txt', '_lpt1.txt.json'],
    ['...', 'Untitled.json'],
    ['.json', 'Untitled.json'],
    ['   ', 'Untitled.json'],
  ])('downloads %j as %j', (name, expected) => {
    expect(projectDownloadName(name)).toBe(expected)
  })

  it.each([
    ['Keyhole Contour', 'svg', 'Keyhole Contour.svg'],
    ['Keyhole Contour', 'png', 'Keyhole Contour.png'],
    ['Keyhole.JSON.svg.png', 'svg', 'Keyhole.svg'],
    ['a/b:c.json', 'png', 'a-b-c.png'],
    ['', 'svg', 'Untitled.svg'],
    ['   ', 'png', 'Untitled.png'],
  ] as const)('downloads %j in %s format as %j', (name, format, expected) => {
    expect(projectDownloadName(name, format)).toBe(expected)
  })

  it('keeps long Unicode filenames within common filesystem byte limits', () => {
    const filename = projectDownloadName('围'.repeat(100))
    expect(new TextEncoder().encode(filename).length).toBeLessThanOrEqual(255)
    expect(filename).toMatch(/^围+\.json$/)
  })
})
