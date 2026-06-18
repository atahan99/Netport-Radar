import { X } from 'lucide-react';
import { useFiltersStore } from '@/store/filters';
import { filterChips } from '@/lib/filter-chips';

export default function FilterChips() {
  const filters = useFiltersStore();
  const resetKey = useFiltersStore((s) => s.resetKey);
  const chips = filterChips(filters);
  if (chips.length === 0) return null;
  return (
    <div className="flex max-w-[340px] flex-wrap justify-end gap-1.5">
      {chips.map((c) => (
        <button
          key={c.key}
          onClick={() => resetKey(c.key)}
          className="flex items-center gap-1 rounded-full border border-amber-700/50 bg-amber-950/70 px-2 py-0.5 text-[10px] text-amber-200 backdrop-blur-sm transition-colors hover:bg-amber-900/70"
          title={`Clear filter: ${c.label}`}
        >
          {c.label}
          <X className="h-2.5 w-2.5" />
        </button>
      ))}
    </div>
  );
}
