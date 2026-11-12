import { describe, expect, it } from 'vitest'
import { aggregateSessionStats } from '@/lib/session-stats'
import { makeFlight } from './helpers'

describe('aggregateSessionStats', () => {
  it('ranks talkers, countries, and protocols by bytes', () => {
    const flights = [
      makeFlight({ process: 'chrome', country: 'US', detectedProtocol: 'HTTPS', bytesTotal: 1000 }),
      makeFlight({ process: 'chrome', country: 'US', detectedProtocol: 'HTTPS', bytesTotal: 500 }),
      makeFlight({ process: 'firefox', country: 'DE', detectedProtocol: 'QUIC', bytesTotal: 200 }),
    ]
    const stats = aggregateSessionStats(flights)
    expect(stats.talkers[0]).toMatchObject({ label: 'chrome', count: 2, bytes: 1500 })
    expect(stats.countries[0]).toMatchObject({ label: 'US', bytes: 1500 })
    expect(stats.protocols[0]).toMatchObject({ label: 'HTTPS', bytes: 1500 })
    expect(stats.totalFlights).toBe(3)
    expect(stats.totalBytes).toBe(1700)
  })

  it('ranks orgs (skipping LAN/unknown) and splits direction and tx/rx', () => {
    const stats = aggregateSessionStats([
      makeFlight({ org: 'Spotify AB', bytesTotal: 900, bytesTx: 100, bytesRx: 800 }),
      makeFlight({ org: 'Unknown', bytesTotal: 5000, direction: 'inbound', bytesTx: 5000 }),
      makeFlight({ org: 'Home Router', isLan: true, bytesTotal: 7000 }),
    ])
    expect(stats.orgs).toEqual([{ label: 'Spotify AB', count: 1, bytes: 900 }])
    expect(stats).toMatchObject({ out: 2, in: 1, bytesTx: 5100, bytesRx: 800 })
  })
})

describe('flights store retire', () => {
  it('keeps only the newest RETIRED_CAP flights', async () => {
    const { useFlightsStore, RETIRED_CAP } = await import('../src/store/flights')
    const batch = Array.from({ length: RETIRED_CAP }, () => makeFlight())
    useFlightsStore.getState().retire(batch)
    const last = makeFlight()
    useFlightsStore.getState().retire([last])
    const { retired } = useFlightsStore.getState()
    expect(retired).toHaveLength(RETIRED_CAP)
    expect(retired.at(-1)).toBe(last)
    expect(retired[0]).toBe(batch[1])
  })
})

describe('liveSummary', () => {
  it('counts flights in the air and names the busiest known app right now', async () => {
    const { liveSummary } = await import('../src/lib/session-stats')
    const s = liveSummary([
      makeFlight({ process: 'spotify', phase: 'cruise', bytesPerSec: 900 }),
      makeFlight({ process: 'chrome', phase: 'hold', bytesPerSec: 100 }),
      makeFlight({ process: '—', phase: 'cruise', bytesPerSec: 5000 }),
      makeFlight({ process: 'steam', phase: 'landed', bytesPerSec: 9999 }),
    ])
    expect(s).toEqual({ active: 3, top: 'spotify' })
    expect(liveSummary([makeFlight({ phase: 'taxi', bytesPerSec: 0 })]).top).toBeNull()
  })
})
