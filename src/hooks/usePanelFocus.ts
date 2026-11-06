import { useEffect, useRef } from 'react';

// Non-modal popover panels (Legend, About): move focus into the panel when it
// opens and give it back to whatever had it (usually the toggle) on close.
export function usePanelFocus<T extends HTMLElement>(open: boolean) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    return () => {
      if (prev?.isConnected) prev.focus();
    };
  }, [open]);
  return ref;
}
