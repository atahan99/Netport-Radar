// server/privdrop.ts
// Privilege separation: capturing needs root, but the long-running network-facing
// servers (WS control channel, HTTP, flow tracker) should not. When started via
// sudo on a POSIX host we keep the root-only work (opening the capture device + lsof) in
// a small broker child and drop the main process to the invoking user. If we
// can't (not root, not via sudo, Windows, or opted out), everything runs inline
// in one process.

import * as os from 'os';

export interface DropTarget {
  uid: number;
  gid: number;
}

export function resolveDropTarget(): DropTarget | null {
  if (process.env.NETPORT_NO_PRIVDROP) return null;
  if (process.platform === 'win32') return null;
  if (typeof process.getuid !== 'function' || process.getuid() !== 0) return null;
  const uid = Number(process.env.SUDO_UID);
  const gid = Number(process.env.SUDO_GID);
  // Need a real non-root target (sudo from a normal user sets SUDO_UID/GID).
  if (!Number.isInteger(uid) || uid <= 0 || !Number.isInteger(gid) || gid < 0) return null;
  return { uid, gid };
}

export function dropPrivileges(target: DropTarget): void {
  try {
    process.setgid?.(target.gid);
    try {
      process.setgroups?.([target.gid]); // shed supplementary groups (e.g. wheel)
    } catch {
      /* non-fatal on some platforms */
    }
    process.setuid?.(target.uid); // must be last — can't change gid after
    // sudo may leave HOME=/root; decoders (tshark prefs) need the user's own.
    const me = os.userInfo();
    process.env.HOME = me.homedir;
    process.env.USER = me.username;
    console.log(
      `[security] dropped to uid=${target.uid} gid=${target.gid}; capture runs in the root broker.`,
    );
  } catch (e) {
    // Fail closed: the network-facing servers must never keep running as root.
    // Exiting also stops the broker (it exits when the IPC channel closes).
    console.error('[security] privilege drop failed — refusing to run the servers as root:', e);
    console.error('[security] fix sudo (SUDO_UID/GID/USER) or opt out with NETPORT_NO_PRIVDROP=1.');
    process.exit(1);
  }
}

export function assertPrivilegesDropped(brokered: boolean): void {
  if (typeof process.getuid !== 'function') return;
  const uid = process.getuid();
  console.log(`[security] effective uid=${uid}${brokered ? ' (brokered; capture in root child)' : ''}`);
  if (brokered && uid === 0) {
    console.error('[security] still root after the privilege drop — exiting.');
    process.exit(1);
  }
}
