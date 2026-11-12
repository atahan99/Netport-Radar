import { useMemo } from 'react'
import { X } from 'lucide-react'
import { useFlightsStore } from '@/store/flights'
import { useFiltersStore } from '@/store/filters'
import { aggregateSessionStats } from '@/lib/session-stats'
import { fmtBytes } from '@/lib/format'

const Row = ({ label, count, bytes }: { label: string; count: number; bytes: number }) => (
  <div className="flex items-baseline justify-between gap-2 text-[10px]">
    <span className="truncate text-zinc-300" title={label}>
      {label}
    </span>
    <span className="shrink-0 tabular-nums text-zinc-400">
      {count} · {fmtBytes(bytes)}
    </span>
  </div>
)

const Section = ({ title, items }: { title: string; items: { label: string; count: number; bytes: number }[] }) => {
  if (items.length === 0) return null
  return (
    <div>
      <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">{title}</div>
      <div className="space-y-0.5">
        {items.map((item) => (
          <Row key={item.label} {...item} />
        ))}
      </div>
    </div>
  )
}

// Session totals (live + already-landed flights). Clicking a destination dot
// isolates a country; the panel then becomes that country's summary.
export default function SessionStats() {
  const flights = useFlightsStore((s) => s.flights)
  const retired = useFlightsStore((s) => s.retired)
  const country = useFiltersStore((s) => s.isolatedCountry)
  const setCountry = useFiltersStore((s) => s.setIsolatedCountry)
  const all = useMemo(() => {
    const merged = [...retired, ...flights]
    return country ? merged.filter((f) => f.country === country) : merged
  }, [retired, flights, country])
  const stats = useMemo(() => aggregateSessionStats(all), [all])

  if (all.length === 0 && !country) return null
  const flag = all.find((f) => f.countryFlag)?.countryFlag ?? ''

  return (
    <div
      className="hud-panel hud-scroll mt-2 max-h-[max(120px,calc(100vh-480px))] w-[152px] overflow-y-auto rounded-xl border border-zinc-800 bg-black/85 p-2 font-mono backdrop-blur-sm"
      aria-label={country ? `Traffic summary for ${country}` : 'Session statistics'}
    >
      <div className="mb-1 flex items-center justify-between gap-1 text-[10px] tracking-wider text-zinc-400">
        <span>{country ? `${flag} ${country}` : 'SESSION'}</span>
        {country && (
          <button
            type="button"
            onClick={() => setCountry(null)}
            className="flex items-center gap-0.5 rounded px-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
            aria-label="Clear country summary"
          >
            clear <X className="h-3 w-3" />
          </button>
        )}
      </div>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <div>
          <div className="text-base leading-tight tabular-nums text-zinc-100">{stats.totalFlights}</div>
          <div className="text-[9px] text-zinc-500">flights</div>
        </div>
        <div className="text-right">
          <div className="whitespace-nowrap text-base leading-tight tabular-nums" style={{ color: 'var(--theme-accent, #4285f4)' }}>
            {fmtBytes(stats.totalBytes)}
          </div>
          <div className="text-[9px] text-zinc-500">total</div>
        </div>
      </div>
      <div className="mb-2 text-[9px] tabular-nums text-zinc-400">
        ↑{fmtBytes(stats.bytesTx)} ↓{fmtBytes(stats.bytesRx)} · out {stats.out} · in {stats.in}
      </div>
      <div className="space-y-2">
        <Section title="Where it goes" items={stats.orgs} />
        <Section title="Top talkers" items={stats.talkers} />
        {!country && <Section title="Top countries" items={stats.countries} />}
        <Section title="Top protocols" items={stats.protocols} />
      </div>
    </div>
  )
}
