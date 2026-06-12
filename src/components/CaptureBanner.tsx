import { useBackendStore } from '@/store/backend';

// Non-blocking banner for capture-layer problems (e.g. missing sudo) — the WS
// is up (online) but no packets are flowing. Connection loss is handled by the
// ReconnectingOverlay instead.
export default function CaptureBanner() {
  const error = useBackendStore((s) => s.error);
  const online = useBackendStore((s) => s.online);
  if (!error || !online) return null;
  return (
    <div className="absolute left-1/2 top-16 z-40 -translate-x-1/2 whitespace-nowrap rounded-md border border-amber-700/60 bg-amber-950/90 px-3 py-1.5 text-xs text-amber-200 backdrop-blur-sm">
      <span aria-hidden="true">⚠</span> {error.message}
    </div>
  );
}
