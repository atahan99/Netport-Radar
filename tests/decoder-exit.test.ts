import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'events';
import { PassThrough } from 'stream';

// The decoder is an external tshark process; fake it to simulate a crash.
const fakeProcs: (EventEmitter & { kill: () => boolean })[] = [];
vi.mock('child_process', async (orig) => ({
  ...(await orig<typeof import('child_process')>()),
  spawn: () => {
    const p = Object.assign(new EventEmitter(), {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: () => true,
    });
    fakeProcs.push(p);
    return p;
  },
}));

const { startDecoder } = await import('../server/capture');

describe('startDecoder (tshark) crash handling', () => {
  it('closes the input stream and reports when the decoder dies', () => {
    const input = new PassThrough();
    const errors: string[] = [];
    startDecoder('tshark', input, new Set(), () => {}, (m) => errors.push(m));
    fakeProcs.at(-1)!.emit('exit', null, 'SIGSEGV');
    expect(input.destroyed).toBe(true);
    expect(errors[0]).toMatch(/decoder exited \(SIGSEGV\)/);
  });

  it('stays quiet when stopped on purpose', () => {
    const errors: string[] = [];
    const d = startDecoder('tshark', new PassThrough(), new Set(), () => {}, (m) => errors.push(m));
    d.stop();
    fakeProcs.at(-1)!.emit('exit', null, 'SIGTERM');
    expect(errors).toEqual([]);
  });
});
