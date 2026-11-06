import { OctagonAlert } from 'lucide-react';
import { useBackendStore, FATAL_CODES } from '@/store/backend';

interface Fix {
  title: string;
  body: string;
  command?: string;
  link?: { href: string; label: string };
}

// Blocking, full-screen recovery instructions for fatal startup problems —
// distinct from the non-blocking CaptureBanner (sudo) and Toasts (transient).
const FIXES: Record<string, Fix> = {
  no_backend: {
    title: 'No capture backend found',
    body: 'Netport-Radar needs a packet-capture tool. Install Wireshark (which bundles tshark) — or tcpdump — then restart.',
    link: { href: 'https://www.wireshark.org/download.html', label: 'Download Wireshark' },
  },
  port_in_use: {
    title: 'Port 8090 is already in use',
    body: 'Another process is holding the capture WebSocket port — likely a second Netport-Radar. Free it, then restart:',
    command: 'lsof -ti tcp:8090 | xargs kill',
  },
};

export default function StartupOverlay() {
  const error = useBackendStore((s) => s.error);
  if (!error || !FATAL_CODES.has(error.code)) return null;
  const fix = FIXES[error.code] ?? { title: 'Capture unavailable', body: error.message };

  return (
    <div
      className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-5 bg-black/[0.97] p-8 animate-fade-in"
      role="alert"
    >
      <OctagonAlert className="h-10 w-10 text-red-500" />
      <div className="max-w-md text-center">
        <div className="text-base font-semibold text-zinc-100">{fix.title}</div>
        <p className="mt-2 text-sm leading-relaxed text-zinc-400">{fix.body}</p>
      </div>
      {fix.command && (
        <code className="select-all rounded border border-zinc-800 bg-zinc-950 px-3 py-1.5 font-mono text-xs text-zinc-300">
          {fix.command}
        </code>
      )}
      {fix.link && (
        <a
          href={fix.link.href}
          target="_blank"
          rel="noreferrer"
          className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-200 transition-colors hover:bg-zinc-900"
        >
          {fix.link.label} ↗
        </a>
      )}
      <div className="font-mono text-[10px] text-zinc-600">{error.message}</div>
    </div>
  );
}
