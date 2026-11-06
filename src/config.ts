// src/config.ts
// Frontend tunables, one commented home each. (Server tunables: server/config.ts.)

// Animation channel: the React store snapshot is pushed at this cadence; motion
// stays at full frame rate via arcProgressLive (src/lib/anim.ts).
export const STORE_PUSH_MS = 100; // 10Hz

// Client-side arcProgress animation (live + demo).
export const CRUISE_MS = 18000; // visual time to fly out to the hold point
export const CRUISE_TARGET = 0.8; // arcProgress at the cruise/hold boundary
export const DESCENT_MS = 2000; // descent visual duration
export const LANDED_TTL_MS = 60_000; // keep a landed flight this long before pruning

// Render caps (post-filter): 150 main flights + a separate 20-slot DNS pool.
export const MAIN_CAP = 150;
export const DNS_CAP = 20;

// Toast auto-dismiss.
export const TOAST_TTL_MS = 5000;

// Branding (About panel, page title).
export const APP_NAME = 'Netport-Radar';
export const REPO_URL = 'https://github.com/atahan99/Netport-Radar';
