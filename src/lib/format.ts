// src/lib/format.ts
// Single source for byte / rate / duration formatting. The values are 1024-based,
// so the labels are the binary units (KiB/MiB/GiB) — honest, and fits the HUD tone.

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KiB`;
  if (n < 1073741824) return `${(n / 1048576).toFixed(1)} MiB`;
  return `${(n / 1073741824).toFixed(2)} GiB`;
}

export function fmtRate(bps: number): string {
  if (bps < 1024) return `${Math.round(bps)} B/s`;
  if (bps < 1048576) return `${(bps / 1024).toFixed(1)} KiB/s`;
  return `${(bps / 1048576).toFixed(2)} MiB/s`;
}

export function fmtDur(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
