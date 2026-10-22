import { expect, it } from 'vitest'
import { buildBankClearance } from './bankClearanceGeometry'
import type { ParallelBanks } from './connectedAvoidanceGeometry'

const banks: ParallelBanks = {
  center: { re: 0, im: 0 },
  direction: { re: 1, im: 0 },
  gap: 0.3,
  entry: { start: { re: 3.49, im: -0.15 }, end: { re: 0.48, im: -0.15 }, outward: -1 },
  exit: { start: { re: 0.48, im: 0.15 }, end: { re: 3.49, im: 0.15 }, outward: 1 },
}
const center = { re: 2, im: 0 }

it('matches the indented-keyhole exterior arcs', () => {
  const result = buildBankClearance({ banks, center, radius: 0.5 })
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(result.error)
  expect(result.value.cuts).toHaveLength(2)
  const lower = result.value.cuts.find((c) => c.bank === 'entry')!
  const upper = result.value.cuts.find((c) => c.bank === 'exit')!
  expect(lower.through).toEqual({ re: 2, im: -0.5 })
  expect(upper.through).toEqual({ re: 2, im: 0.5 })
  expect(lower.start.re).toBeCloseTo(2 + Math.sqrt(0.5 ** 2 - 0.15 ** 2), 12)
  expect(upper.start.re).toBeCloseTo(2 - Math.sqrt(0.5 ** 2 - 0.15 ** 2), 12)
  expect(lower.arc.sweep).toBeGreaterThan(-Math.PI)
  expect(lower.arc.sweep).toBeLessThan(0)
  expect(upper.arc.sweep).toBeGreaterThan(-Math.PI)
  expect(upper.arc.sweep).toBeLessThan(0)
})

it.each([0.1, 0.15])('keeps a radius %s without inventing a degenerate arc', (radius) => {
  expect(buildBankClearance({ banks, center, radius })).toEqual({ ok: true, value: { cuts: [] } })
})

it('only modifies the bank actually reached by an eccentric clearance', () => {
  const result = buildBankClearance({ banks, center: { re: 2, im: 0.1 }, radius: 0.1 })
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(result.error)
  expect(result.value.cuts.map((c) => c.bank)).toEqual(['exit'])
  expect(result.value.cuts[0].through.im).toBeCloseTo(0.2, 12)
})

it.each([
  { re: 2, im: 0.2 },
  { re: 3.4, im: 0 },
])('rejects a marker outside the finite channel: %j', (point) => {
  expect(buildBankClearance({ banks, center: point, radius: 0.5 }).ok).toBe(false)
})

it('uses mathematical outward directions after rotation and translation', () => {
  const move = (p: { re: number; im: number }) => ({ re: 5 - p.im, im: -3 + p.re })
  const rotated: ParallelBanks = {
    ...banks,
    center: move(banks.center),
    direction: { re: 0, im: 1 },
    entry: { ...banks.entry, start: move(banks.entry.start), end: move(banks.entry.end) },
    exit: { ...banks.exit, start: move(banks.exit.start), end: move(banks.exit.end) },
  }
  const result = buildBankClearance({ banks: rotated, center: move(center), radius: 0.5 })
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(result.error)
  expect(result.value.cuts[0].through).toEqual({ re: 5.5, im: -1 })
})

it.each([1, 1e-8])(
  'distinguishes rotated exact tangency from a real crossing at scale %s',
  (scale) => {
    const move = (p: { re: number; im: number }) => ({
      re: scale * (2 + p.re * Math.cos(0.1) - p.im * Math.sin(0.1)),
      im: scale * (3 + p.re * Math.sin(0.1) + p.im * Math.cos(0.1)),
    })
    const rotated: ParallelBanks = {
      center: move(banks.center),
      direction: { re: Math.cos(0.1), im: Math.sin(0.1) },
      gap: 0.3 * scale,
      entry: { ...banks.entry, start: move(banks.entry.start), end: move(banks.entry.end) },
      exit: { ...banks.exit, start: move(banks.exit.start), end: move(banks.exit.end) },
    }
    expect(
      buildBankClearance({ banks: rotated, center: move(center), radius: 0.15 * scale }),
    ).toEqual({ ok: true, value: { cuts: [] } })
    const crossing = buildBankClearance({
      banks: rotated,
      center: move(center),
      radius: 0.150001 * scale,
    })
    expect(crossing.ok, crossing.ok ? '' : crossing.error).toBe(true)
    if (!crossing.ok) throw new Error(crossing.error)
    expect(crossing.value.cuts).toHaveLength(2)
    expect(crossing.value.cuts.every((cut) => cut.endT > cut.startT)).toBe(true)
  },
)
