// src/lib/livery.ts
// Process name → brand livery color. Cross-platform alias table normalizes
// raw OS names (e.g. "Google Chrome Helper" → "chrome" → #4285F4).

const BRAND_COLORS: Record<string, string> = {
  chrome: '#4285F4',
  firefox: '#FF6611',
  discord: '#5865F2',
  spotify: '#1DB954',
  steam: '#4C8CBF',
  slack: '#4A154B',
  code: '#23A5C3',
  cursor: '#23A5C3',
  brave: '#FB542B',
  safari: '#006CFF',
  signal: '#3A76F0',
  telegram: '#2AABEE',
  zoom: '#2D8CFF',
  obs: '#302E31',
  protonvpn: '#6D4AFF',
};

// System processes render in muted gray.
const SYSTEM_PROCS = new Set([
  'svchost',
  'kernel_task',
  'systemd',
  'launchd',
  'wininit',
  'services',
  'system',
]);

const ALIASES: Array<[RegExp, string]> = [
  [/chrome/, 'chrome'],
  [/firefox/, 'firefox'],
  [/discord/, 'discord'],
  [/spotify/, 'spotify'],
  [/steam/, 'steam'],
  [/slack/, 'slack'],
  [/vscode|visual studio code|cursor|^code$/, 'code'],
  [/brave/, 'brave'],
  [/safari/, 'safari'],
  [/signal/, 'signal'],
  [/telegram/, 'telegram'],
  [/zoom/, 'zoom'],
  [/obs/, 'obs'],
  [/proton/, 'protonvpn'],
];

export function normalizeProcess(raw: string): string {
  const s = raw.toLowerCase().trim();
  for (const [re, name] of ALIASES) if (re.test(s)) return name;
  return s.replace(/\.exe$/, '').replace(/\s*helper.*$/, '').trim() || 'unknown';
}

export function liveryColor(process: string): string {
  const p = process.toLowerCase().replace(/\.exe$/, '');
  if (BRAND_COLORS[p]) return BRAND_COLORS[p];
  if (SYSTEM_PROCS.has(p)) return '#7c8087';

  // Deterministic hash → HSL hue, fixed sat/lightness.
  let h = 5381;
  for (let i = 0; i < p.length; i++) h = ((h << 5) + h + p.charCodeAt(i)) >>> 0;
  return hslToHex(h % 360, 65, 55);
}

function hslToHex(h: number, s: number, l: number): string {
  const sn = s / 100;
  const ln = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sn * Math.min(ln, 1 - ln);
  const f = (n: number) =>
    ln - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const toHex = (x: number) =>
    Math.round(255 * x)
      .toString(16)
      .padStart(2, '0');
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
}
