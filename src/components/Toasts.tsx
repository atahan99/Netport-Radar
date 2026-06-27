import { AlertTriangle, Info, OctagonAlert, X } from 'lucide-react';
import { useToastStore, type ToastKind } from '@/store/toasts';

const STYLE: Record<ToastKind, string> = {
  info: 'border-sky-700/60 bg-sky-950/90 text-sky-200',
  warn: 'border-amber-700/60 bg-amber-950/90 text-amber-200',
  error: 'border-red-700/60 bg-red-950/90 text-red-200',
};
const ICON: Record<ToastKind, typeof Info> = {
  info: Info,
  warn: AlertTriangle,
  error: OctagonAlert,
};

// Corner stack of transient notifications. Top-center so it clears the boards
// (bottom corners) and the docked flight card (bottom-center).
export default function Toasts() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);
  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none absolute left-1/2 top-16 z-40 flex -translate-x-1/2 flex-col items-center gap-2">
      {toasts.map((t) => {
        const Icon = ICON[t.kind];
        return (
          <div
            key={t.id}
            className={`pointer-events-auto flex max-w-sm items-center gap-2 rounded-md border px-3 py-1.5 text-xs backdrop-blur-sm animate-board-row ${STYLE[t.kind]}`}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" />
            <span className="leading-snug">{t.message}</span>
            <button
              onClick={() => dismiss(t.id)}
              className="ml-1 shrink-0 opacity-60 transition-opacity hover:opacity-100"
              aria-label="Dismiss"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
