import { useMemo } from 'react'
import { useFlightsStore } from '@/store/flights'
import { aggregateSessionStats } from '@/lib/session-stats'
import { fmtBytes } from '@/lib/format'

const Row = ({ label, count, bytes }: { label: string; count: number; bytes: number }) => (
  <div className="flex items-baseline justify-between gap-2 text-[10px]">
    <span className="truncate text-zinc-300" title={label}>
      {label}
    </span>
    <span className="shrink-0 tabular-nums text-zinc-500">
      {count} · {fmtBytes(bytes)}
    </span>
  </div>
)

const Section = ({ title, items }: { title: string; items: { label: string; count: number; bytes: number }[] }) => {
  if (items.length === 0) return null
  return (
    <div>
      <div className="mb-1 text-[9px] uppercase tracking-wider text-zinc-600">{title}</div>
      <div className="space-y-0.5">
        {items.map((item) => (
          <Row key={item.label} {...item} />
        ))}
      </div>
    </div>
  )
}

export default function SessionStats() {
  const flights = useFlightsStore((s) => s.flights)
  const stats = useMemo(() => aggregateSessionStats(flights), [flights])

  if (flights.length === 0) return null

  return (
    <div
      className="mt-2 w-[128px] rounded-xl border border-zinc-800 bg-black/85 p-2 font-mono backdrop-blur-sm"
      aria-label="Session statistics"
    >
      <div className="mb-2 text-[9px] tracking-wider text-zinc-500">
        SESSION · {stats.totalFlights} flights · {fmtBytes(stats.totalBytes)}
      </div>
      <div className="space-y-2">
        <Section title="Top talkers" items={stats.talkers} />
        <Section title="Top countries" items={stats.countries} />
        <Section title="Top protocols" items={stats.protocols} />
      </div>
    </div>
  )
}
