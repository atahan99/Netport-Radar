#!/usr/bin/env tsx
// server/scripts/replay.ts
// Replays an exported NDJSON session over WebSocket — no live capture needed.
// Useful for load testing the client render queue at high speed.
//
// Usage:
//   npm run replay -- session.ndjson --speed 10
//   npm run replay -- session.ndjson --speed 1 --loop
//
// Stop any live capture server on :8090 first, then run the Vite dev UI:
//   npm run dev

import { readFileSync } from 'fs'
import { WebSocketServer, WebSocket } from 'ws'
import type {
  AircraftType,
  BackendInfo,
  DetectedProtocol,
  Flight,
  FlightEvent,
  FlightPhase,
  HomeAirport,
  ServerMessage,
} from '../../src/types'
import { geoLookup } from '../capture'
import { liveryColor } from '../../src/lib/livery'
import { flagEmoji } from '../net-utils'
import { WS_PORT, BIND_HOST, WS_FLUSH_MS } from '../config'

interface LogOpened {
  t: number
  e: 'opened'
  id: string
  process?: string
  pid?: number
  proto?: string
  src?: string
  dst?: string
  country?: string
  city?: string
  org?: string
  hostname?: string
  aircraft?: string
  homeAirport?: string
  isLan?: boolean
  isIPv6?: boolean
}

interface LogPhase {
  t: number
  e: 'phase'
  id: string
  phase: FlightPhase
}

interface LogHostname {
  t: number
  e: 'hostname'
  id: string
  hostname: string
  sni?: string
}

interface LogClosed {
  t: number
  e: 'closed'
  id: string
  bytesTotal?: number
  durationMs?: number
}

type LogLine = LogOpened | LogPhase | LogHostname | LogClosed | Record<string, unknown>

interface Scheduled {
  at: number
  event: FlightEvent
}

const DEFAULT_HOME: HomeAirport = {
  id: 'primary',
  label: process.env.NETPORT_HOME_LABEL ?? 'Replay Home',
  lat: Number(process.env.NETPORT_HOME_LAT ?? 41.01),
  lng: Number(process.env.NETPORT_HOME_LNG ?? 28.97),
  ip: '',
  isVpn: false,
}

const BACKEND: BackendInfo = {
  capture: 'tshark',
  dpiMode: 'full',
  iface: 'replay',
  interfaces: ['replay'],
}

function parseArgs(argv: string[]) {
  let file = ''
  let speed = 1
  let loop = false
  let port = WS_PORT

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--speed' && argv[i + 1]) {
      speed = Math.max(0.1, Number(argv[++i]) || 1)
    } else if (a === '--loop') {
      loop = true
    } else if (a === '--port' && argv[i + 1]) {
      port = Number(argv[++i]) || WS_PORT
    } else if (!a.startsWith('-') && !file) {
      file = a
    }
  }

  return { file, speed, loop, port }
}

function parseEndpoint(raw: string): { ip: string; port: number } {
  const idx = raw.lastIndexOf(':')
  if (idx <= 0) return { ip: raw, port: 0 }
  const ip = raw.slice(0, idx)
  const port = Number(raw.slice(idx + 1))
  return { ip, port: Number.isFinite(port) ? port : 0 }
}

function flightFromOpened(row: LogOpened, flights: Map<string, Flight>): Flight | null {
  if (!row.id) return null
  const existing = flights.get(row.id)
  if (existing) return existing

  const src = parseEndpoint(row.src ?? '0.0.0.0:0')
  const dst = parseEndpoint(row.dst ?? '0.0.0.0:0')
  const geo = geoLookup(dst.ip)
  const process = row.process ?? 'unknown'

  const flight: Flight = {
    id: row.id,
    process,
    processRaw: process,
    pid: row.pid ?? 0,
    protocol: row.proto?.includes('UDP') ? 'UDP' : row.proto?.includes('ICMP') ? 'ICMP' : 'TCP',
    detectedProtocol: (row.proto as DetectedProtocol) ?? 'Unknown',
    port: dst.port,
    srcIp: src.ip,
    dstIp: dst.ip,
    srcPort: src.port,
    dstPort: dst.port,
    isIPv6: row.isIPv6 ?? dst.ip.includes(':'),
    homeAirportId: row.homeAirport ?? 'primary',
    dstLat: geo?.lat ?? 0,
    dstLng: geo?.lng ?? 0,
    country: row.country ?? geo?.country ?? '??',
    countryFlag: flagEmoji(row.country ?? geo?.country ?? ''),
    geoConfidence: geo?.confidence ?? (row.country ? 'country' : 'none'),
    city: row.city ?? geo?.city ?? 'Unknown',
    org: row.org ?? geo?.org ?? 'Unknown',
    asn: geo?.asn ?? '',
    hostname: row.hostname ?? dst.ip,
    sni: undefined,
    aircraftType: (row.aircraft as AircraftType) ?? 'narrowbody',
    phase: 'taxi',
    liveryColor: liveryColor(process),
    bytesTotal: 0,
    bytesTx: 0,
    bytesRx: 0,
    bytesPerSec: 0,
    packetsTotal: 0,
    durationMs: 0,
    arcProgress: 0,
    direction: 'outbound',
    isLan: row.isLan ?? false,
    startedAt: row.t,
  }

  flights.set(row.id, flight)
  return flight
}

function flightFromClientExport(row: Record<string, unknown>, flights: Map<string, Flight>): Flight | null {
  const id = String(row.id ?? '')
  if (!id) return null
  const dstIp = String(row.dst ?? '0.0.0.0')
  const geo = geoLookup(dstIp)
  const process = String(row.process ?? 'unknown')

  const flight: Flight = {
    id,
    process,
    processRaw: process,
    pid: 0,
    protocol: 'TCP',
    detectedProtocol: (row.proto as DetectedProtocol) ?? 'HTTPS',
    port: 443,
    srcIp: '127.0.0.1',
    dstIp,
    srcPort: 40000,
    dstPort: 443,
    isIPv6: false,
    homeAirportId: String(row.homeAirport ?? 'primary'),
    dstLat: geo?.lat ?? 0,
    dstLng: geo?.lng ?? 0,
    country: String(row.country ?? geo?.country ?? '??'),
    countryFlag: flagEmoji(String(row.country ?? geo?.country ?? '')),
    geoConfidence: geo?.confidence ?? 'country',
    city: String(row.city ?? geo?.city ?? 'Unknown'),
    org: String(row.org ?? geo?.org ?? 'Unknown'),
    asn: String(row.asn ?? geo?.asn ?? ''),
    hostname: String(row.hostname ?? dstIp),
    aircraftType: (row.aircraft as AircraftType) ?? 'narrowbody',
    phase: 'cruise',
    liveryColor: liveryColor(process),
    bytesTotal: Number(row.bytesTotal ?? 0),
    bytesTx: 0,
    bytesRx: 0,
    bytesPerSec: 0,
    packetsTotal: 0,
    durationMs: Number(row.durationMs ?? 0),
    arcProgress: 0.5,
    direction: 'outbound',
    isLan: Boolean(row.isLan),
    startedAt: Number(row.t ?? Date.now()),
  }

  flights.set(id, flight)
  return flight
}

function parseLines(raw: string): Scheduled[] {
  const flights = new Map<string, Flight>()
  const scheduled: Scheduled[] = []
  const lines = raw.split('\n').filter((l) => l.trim())

  for (const line of lines) {
    let row: LogLine
    try {
      row = JSON.parse(line) as LogLine
    } catch {
      continue
    }

    const t = Number(row.t ?? Date.now())
    const hasProcess = 'process' in row && Boolean(row.process)
    const kind = row.e ?? (row.id && hasProcess ? 'client-export' : undefined)

    if (kind === 'opened') {
      const opened = row as LogOpened
      const flight = flightFromOpened(opened, flights)
      if (flight) scheduled.push({ at: t, event: { event: 'opened', flight: { ...flight } } })
    } else if (kind === 'phase') {
      const p = row as LogPhase
      scheduled.push({ at: t, event: { event: 'phase', id: p.id, phase: p.phase } })
    } else if (kind === 'hostname') {
      const h = row as LogHostname
      scheduled.push({
        at: t,
        event: { event: 'hostname', id: h.id, hostname: h.hostname, sni: h.sni },
      })
    } else if (kind === 'closed') {
      const c = row as LogClosed
      scheduled.push({
        at: t,
        event: {
          event: 'closed',
          id: c.id,
          bytesTotal: c.bytesTotal ?? 0,
          durationMs: c.durationMs ?? 0,
        },
      })
    } else if (kind === 'client-export' || (row.id && hasProcess && !row.e)) {
      const flight = flightFromClientExport(row as Record<string, unknown>, flights)
      if (flight) scheduled.push({ at: t, event: { event: 'opened', flight: { ...flight } } })
    }
  }

  scheduled.sort((a, b) => a.at - b.at)
  return scheduled
}

function runReplay(scheduled: Scheduled[], speed: number, loop: boolean, port: number): void {
  const clients = new Set<WebSocket>()
  let queue: Scheduled[] = scheduled.map((s) => ({ ...s }))
  let baseT = queue[0]?.at ?? Date.now()
  let started = Date.now()

  const wss = new WebSocketServer({ port, host: BIND_HOST })
  wss.on('connection', (ws) => {
    clients.add(ws)
    const init: ServerMessage = {
      type: 'init',
      homeAirports: [DEFAULT_HOME],
      backend: BACKEND,
      flights: [],
    }
    ws.send(JSON.stringify(init))
  })

  const flushBatch: FlightEvent[] = []
  const flushTimer = setInterval(() => {
    if (flushBatch.length === 0) return
    const msg: ServerMessage = { type: 'batch', events: flushBatch.splice(0) }
    const payload = JSON.stringify(msg)
    for (const ws of clients) {
      if (ws.readyState === WebSocket.OPEN) ws.send(payload)
    }
  }, WS_FLUSH_MS)

  const tick = () => {
    const elapsed = (Date.now() - started) * speed
    while (queue.length > 0 && queue[0].at - baseT <= elapsed) {
      flushBatch.push(queue.shift()!.event)
    }

    if (queue.length === 0) {
      if (loop && scheduled.length > 0) {
        queue = scheduled.map((s) => ({ ...s }))
        baseT = queue[0]?.at ?? Date.now()
        started = Date.now()
        const reset: ServerMessage = { type: 'reset' }
        const payload = JSON.stringify(reset)
        for (const ws of clients) {
          if (ws.readyState === WebSocket.OPEN) ws.send(payload)
        }
      }
    }

    setTimeout(tick, 50)
  }

  tick()

  console.log(
    `[replay] serving ws://${BIND_HOST}:${port} — ${scheduled.length} events at ${speed}×` +
      (loop ? ' (loop)' : ''),
  )
  console.log('[replay] start the UI with: npm run dev')

  const shutdown = () => {
    clearInterval(flushTimer)
    for (const ws of clients) ws.close()
    wss.close()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

function main(): void {
  const { file, speed, loop, port } = parseArgs(process.argv.slice(2))
  if (!file) {
    console.error('Usage: npm run replay -- <session.ndjson> [--speed N] [--loop] [--port 8090]')
    process.exit(1)
  }

  const raw = readFileSync(file, 'utf8')
  const scheduled = parseLines(raw)
  if (scheduled.length === 0) {
    console.error('[replay] no events parsed — is this a netport-radar NDJSON export?')
    process.exit(1)
  }

  runReplay(scheduled, speed, loop, port)
}

main()
