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
})
