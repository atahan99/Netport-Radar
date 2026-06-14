import { useBackendStore } from '@/store/backend';

// Non-blocking banner specifically for the sudo / capture-permission case — the
// WS is up (online) but no packets flow. Fatal problems (no_backend/port_in_use)
// use the blocking StartupOverlay; connection loss uses ReconnectingOverlay.
export default function CaptureBanner() {
  const error = useBackendStore((s) => s.error);
  const online = useBackendStore((s) => s.online);
  if (!error || !online || error.code !== 'capture_permission') return null;
  return (
    <div className="absolute left-1/2 top-16 z-40 -translate-x-1/2 whitespace-nowrap rounded-md border border-amber-700/60 bg-amber-950/90 px-3 py-1.5 text-xs text-amber-200 backdrop-blur-sm">
      <span aria-hidden="true">⚠</span> {error.message}
    </div>
  );
}
