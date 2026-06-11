import { useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { useConnectionStore } from '@/store/connection';
import { Button } from '@/components/ui/button';

export default function ReconnectingOverlay() {
  const reconnecting = useConnectionStore((s) => s.reconnecting);
  const attempt = useConnectionStore((s) => s.attempt);
  const setReconnecting = useConnectionStore((s) => s.setReconnecting);
  const bumpAttempt = useConnectionStore((s) => s.bumpAttempt);

  useEffect(() => {
    if (!reconnecting) return;
    const id = setInterval(() => bumpAttempt(), 3000);
    return () => clearInterval(id);
  }, [reconnecting, bumpAttempt]);

  if (!reconnecting) return null;

  return (
    <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-black/95 animate-fade-in">
      <Loader2 className="h-8 w-8 animate-spin text-zinc-500" />
      <div className="text-center">
        <div className="text-sm text-zinc-200">Reconnecting…</div>
        <div className="font-mono text-xs text-zinc-500">Attempt {attempt} of ∞ · retry 3s</div>
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={() => setReconnecting(false)}>
          Try now
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setReconnecting(false)}>
          Dismiss
        </Button>
      </div>
      <div className="absolute bottom-4 text-[10px] text-zinc-700">demo: press R to toggle</div>
    </div>
  );
}
