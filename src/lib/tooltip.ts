// src/lib/tooltip.ts
// One shared hover tooltip node, positioned imperatively (no React per move).

import type { Flight } from '@/types';

let el: HTMLDivElement | null = null;

function ensure(): HTMLDivElement {
  if (!el) {
    el = document.createElement('div');
    el.style.cssText =
      'position:fixed;z-index:60;pointer-events:none;display:none;padding:4px 8px;' +
      'border-radius:6px;border:1px solid #3f3f46;background:rgba(0,0,0,0.9);color:#e4e4e7;' +
      "font:600 11px ui-monospace,monospace;white-space:nowrap;transform:translate(-50%,-135%)";
    document.body.appendChild(el);
  }
  return el;
}

export function flightTipText(f: Flight): string {
  const proc = f.process && f.process !== '—' ? `${f.process} · ` : '';
  return `${f.id} · ${proc}${f.hostname} · ${f.phase.toUpperCase()} ${f.countryFlag}`.trim();
}

export function showTip(x: number, y: number, text: string): void {
  const t = ensure();
  t.textContent = text;
  t.style.left = `${x}px`;
  t.style.top = `${y}px`;
  t.style.display = 'block';
}

export function hideTip(): void {
  if (el) el.style.display = 'none';
}
