import type { Flight } from '@/types'

export interface RankedItem {
  label: string
  count: number
  bytes: number
}

const TOP_N = 5

export const aggregateSessionStats = (flights: Flight[]) => {
  const byProcess = new Map<string, { count: number; bytes: number }>()
  const byCountry = new Map<string, { count: number; bytes: number }>()
  const byProtocol = new Map<string, { count: number; bytes: number }>()

  for (const f of flights) {
    const proc = f.process && f.process !== '—' ? f.process : 'unknown'
    bump(byProcess, proc, f.bytesTotal)
    const country = f.country || '??'
    bump(byCountry, country, f.bytesTotal)
    bump(byProtocol, f.detectedProtocol, f.bytesTotal)
  }

  return {
    talkers: topN(byProcess),
    countries: topN(byCountry),
    protocols: topN(byProtocol),
    totalFlights: flights.length,
    totalBytes: flights.reduce((s, f) => s + f.bytesTotal, 0),
  }
}

const bump = (map: Map<string, { count: number; bytes: number }>, key: string, bytes: number) => {
  const cur = map.get(key) ?? { count: 0, bytes: 0 }
  map.set(key, { count: cur.count + 1, bytes: cur.bytes + bytes })
}

const topN = (map: Map<string, { count: number; bytes: number }>): RankedItem[] =>
  [...map.entries()]
    .map(([label, v]) => ({ label, count: v.count, bytes: v.bytes }))
    .sort((a, b) => b.bytes - a.bytes || b.count - a.count)
    .slice(0, TOP_N)

// Radar footer: flows currently in the air and the app moving the most bytes
// right now (not over the whole session, which SessionStats covers).
export function liveSummary(flights: Flight[]): { active: number; top: string | null } {
  let active = 0
  let top: Flight | null = null
  for (const f of flights) {
    if (f.phase === 'landed') continue
    active++
    if (f.process !== '—' && (!top || f.bytesPerSec > top.bytesPerSec)) top = f
  }
  return { active, top: top && top.bytesPerSec > 0 ? top.process : null }
}
