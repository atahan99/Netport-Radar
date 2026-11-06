import { describe, it, expect, afterEach, vi } from 'vitest';
import { resolveDropTarget } from '../server/privdrop';

const env = { ...process.env };
afterEach(() => {
  process.env = { ...env };
  vi.restoreAllMocks();
});

function asRoot(sudo: Record<string, string | undefined>) {
  vi.spyOn(process, 'getuid').mockReturnValue(0);
  Object.assign(process.env, sudo);
  for (const [k, v] of Object.entries(sudo)) if (v === undefined) delete process.env[k];
}

describe('resolveDropTarget', () => {
  it('drops to the sudo user when root via sudo', () => {
    asRoot({ SUDO_UID: '501', SUDO_GID: '20', NETPORT_NO_PRIVDROP: undefined });
    expect(resolveDropTarget()).toEqual({ uid: 501, gid: 20 });
  });
  it('does not drop when not root, opted out, or sudo env is missing/root', () => {
    vi.spyOn(process, 'getuid').mockReturnValue(501);
    expect(resolveDropTarget()).toBeNull();
    vi.restoreAllMocks();
    asRoot({ SUDO_UID: '501', SUDO_GID: '20', NETPORT_NO_PRIVDROP: '1' });
    expect(resolveDropTarget()).toBeNull();
    asRoot({ SUDO_UID: '0', SUDO_GID: '0', NETPORT_NO_PRIVDROP: undefined });
    expect(resolveDropTarget()).toBeNull();
    asRoot({ SUDO_UID: 'abc', SUDO_GID: '20', NETPORT_NO_PRIVDROP: undefined });
    expect(resolveDropTarget()).toBeNull();
  });
});
