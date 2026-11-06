// src/lib/legend-hint.ts
// First-visit hint for the legend button. Storage can throw (private mode,
// blocked site data), so every access is guarded and failure just means
// "show the hint".

const KEY = 'netport-legend-seen';

export function legendSeen(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function markLegendSeen(): void {
  try {
    localStorage.setItem(KEY, '1');
  } catch {
    /* hint shows again next visit — harmless */
  }
}
