import CaptureBanner from '@/components/CaptureBanner';
import Toasts from '@/components/Toasts';

// Single top-center column so the sudo banner and transient toasts stack instead
// of overlapping. aria-live announces toasts.
export default function NoticeStack() {
  return (
    <div
      className="pointer-events-none absolute left-1/2 top-16 z-40 flex -translate-x-1/2 flex-col items-center gap-2"
      role="status"
      aria-live="polite"
    >
      <CaptureBanner />
      <Toasts />
    </div>
  );
}
