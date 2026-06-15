import { useBackendStore } from '@/store/backend';

// Non-blocking banner for capture-layer problems while the WS is up (online):
// capture_permission (needs sudo) and capture_dead (the supervisor gave up).
// Fatal problems (no_backend/port_in_use) use the blocking StartupOverlay;
// connection loss uses ReconnectingOverlay.
const BANNER_CODES = new Set(['capture_permission', 'capture_dead']);

export default function CaptureBanner() {
  const error = useBackendStore((s) => s.error);
  const online = useBackendStore((s) => s.online);
  if (!error || !online || !BANNER_CODES.has(error.code)) return null;
  const dead = error.code === 'capture_dead';
  const tone = dead
    ? 'border-red-700/60 bg-red-950/90 text-red-200'
    : 'border-amber-700/60 bg-amber-950/90 text-amber-200';
  return (
    <div
      className={`absolute left-1/2 top-16 z-40 -translate-x-1/2 whitespace-nowrap rounded-md border px-3 py-1.5 text-xs backdrop-blur-sm ${tone}`}
    >
      <span aria-hidden="true">⚠</span> {error.message}
    </div>
  );
}
