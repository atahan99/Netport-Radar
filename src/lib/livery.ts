// src/lib/livery.ts
// Process name → brand livery color. Cross-platform alias table normalizes
// raw OS names (e.g. "Google Chrome Helper" → "chrome" → #4285F4).

const BRAND_COLORS: Record<string, string> = {
  // Browsers
  chrome: '#4285F4',
  firefox: '#FF6611',
  safari: '#006CFF',
  brave: '#FB542B',
  edge: '#0078D4',
  opera: '#FF1B2D',
  vivaldi: '#EF3939',
  arc: '#FC536C',
  tor: '#7D4698',

  // Chat & social
  discord: '#5865F2',
  slack: '#4A154B',
  whatsapp: '#25D366',
  messenger: '#0084FF',
  teams: '#6264A7',
  telegram: '#2AABEE',
  signal: '#3A76F0',
  element: '#0DBD8B',
  zoom: '#2D8CFF',

  // Google / Microsoft / Apple suites
  gmail: '#EA4335',
  google: '#34A853',
  outlook: '#0072C6',
  onedrive: '#094AB2',
  gdrive: '#0F9D58',
  icloud: '#3693F3',
  music: '#FA243C',
  tv: '#6E6E73',
  photos: '#FF9500',
  mail: '#147EFB',
  facetime: '#32D74B',

  // Dev tools
  code: '#23A5C3',
  cursor: '#1F8AD9',
  git: '#F05032',
  node: '#339933',
  python: '#3776AB',
  docker: '#2496ED',
  postman: '#FF6C37',
  insomnia: '#4000BF',
  github: '#24292F',
  jetbrains: '#FE315D',
  iterm: '#33CC33',

  // VPNs
  protonvpn: '#6D4AFF',
  wireguard: '#88171A',
  tailscale: '#6366F1',
  mullvad: '#294D73',
  nordvpn: '#4687FF',
  expressvpn: '#DA3940',
  openvpn: '#EA7E20',

  // Cloud sync
  dropbox: '#0061FF',
  box: '#0061D5',

  // Media
  spotify: '#1DB954',
  vlc: '#FF8800',
  plex: '#EBAF00',
  netflix: '#E50914',
  youtube: '#FF0000',
  twitch: '#9146FF',
  obs: '#302E31',

  // Games & launchers
  steam: '#4C8CBF',
  epicgames: '#2F2D2E',
  riot: '#D32936',
  valorant: '#FF4655',
  league: '#C89B3C',
  minecraft: '#62B47A',
  battlenet: '#148EFF',
  origin: '#FF4747',
}

/** Canonical brand → hex map (exported for legend / tests). */
export const LIVERY_COLORS: Readonly<Record<string, string>> = BRAND_COLORS

// System processes render in muted gray.
const SYSTEM_PROCS = new Set([
  'svchost',
  'kernel_task',
  'systemd',
  'launchd',
  'wininit',
  'services',
  'system',
  'ping',
])

// Order matters: more specific patterns first.
const ALIASES: Array<[RegExp, string]> = [
  // Browsers
  [/google chrome|chromium/, 'chrome'],
  [/microsoft edge|msedge/, 'edge'],
  [/firefox/, 'firefox'],
  [/brave/, 'brave'],
  [/safari/, 'safari'],
  [/opera|opr\./, 'opera'],
  [/vivaldi/, 'vivaldi'],
  [/\barc\b|the browser company/, 'arc'],
  [/tor browser|tor\.exe/, 'tor'],

  // Chat
  [/discord/, 'discord'],
  [/slack/, 'slack'],
  [/whatsapp/, 'whatsapp'],
  [/messenger/, 'messenger'],
  [/microsoft teams|ms-teams|^teams$/, 'teams'],
  [/telegram/, 'telegram'],
  [/signal/, 'signal'],
  [/element|riot\.im|nheko/, 'element'],
  [/zoom/, 'zoom'],

  // Google / MS / Apple
  [/gmail|google drive|backup.?and.?sync|googleaccount/, 'google'],
  [/outlook/, 'outlook'],
  [/onedrive/, 'onedrive'],
  [/gdrive/, 'gdrive'],
  [/icloud/, 'icloud'],
  [/apple music|music\.app/, 'music'],
  [/apple tv|tv\.app/, 'tv'],
  [/photos\.app|apple photos/, 'photos'],
  [/mail\.app|apple mail/, 'mail'],
  [/facetime/, 'facetime'],

  // Dev tools
  [/vscode|visual studio code|cursor|^code$/, 'code'],
  [/\bgit\b/, 'git'],
  [/\bnode\b|nodejs/, 'node'],
  [/\bpython\b|python3/, 'python'],
  [/docker/, 'docker'],
  [/postman/, 'postman'],
  [/insomnia/, 'insomnia'],
  [/github desktop|github/, 'github'],
  [/jetbrains|idea|pycharm|webstorm|goland|clion|rider/, 'jetbrains'],
  [/iterm/, 'iterm'],

  // VPNs
  [/proton/, 'protonvpn'],
  [/wireguard/, 'wireguard'],
  [/tailscale/, 'tailscale'],
  [/mullvad/, 'mullvad'],
  [/nordvpn/, 'nordvpn'],
  [/expressvpn/, 'expressvpn'],
  [/openvpn/, 'openvpn'],

  // Cloud
  [/dropbox/, 'dropbox'],
  [/\bbox\b/, 'box'],

  // Media
  [/spotify/, 'spotify'],
  [/vlc/, 'vlc'],
  [/plex/, 'plex'],
  [/netflix/, 'netflix'],
  [/youtube/, 'youtube'],
  [/twitch/, 'twitch'],
  [/obs/, 'obs'],

  // Games
  [/steamwebhelper|steam/, 'steam'],
  [/epicgames|epic games/, 'epicgames'],
  [/riotclient|riot games|^riot$/, 'riot'],
  [/valorant/, 'valorant'],
  [/leagueoflegends|league of legends/, 'league'],
  [/minecraft/, 'minecraft'],
  [/battlenet|battle\.net/, 'battlenet'],
  [/origin\.exe|ea app|eadesktop/, 'origin'],
]

export function normalizeProcess(raw: string): string {
  const s = raw.toLowerCase().trim()
  for (const [re, name] of ALIASES) if (re.test(s)) return name
  return s.replace(/\.exe$/, '').replace(/\s*helper.*$/, '').trim() || 'unknown'
}

export function liveryColor(process: string): string {
  const p = normalizeProcess(process)
  if (BRAND_COLORS[p]) return BRAND_COLORS[p]
  if (SYSTEM_PROCS.has(p)) return '#7c8087'

  // Deterministic hash → HSL hue, fixed sat/lightness.
  let h = 5381
  for (let i = 0; i < p.length; i++) h = ((h << 5) + h + p.charCodeAt(i)) >>> 0
  return hslToHex(h % 360, 65, 55)
}

function hslToHex(h: number, s: number, l: number): string {
  const sn = s / 100
  const ln = l / 100
  const k = (n: number) => (n + h / 30) % 12
  const a = sn * Math.min(ln, 1 - ln)
  const f = (n: number) =>
    ln - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  const toHex = (x: number) =>
    Math.round(255 * x)
      .toString(16)
      .padStart(2, '0')
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`
}
