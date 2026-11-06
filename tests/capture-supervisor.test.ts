import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import type { ChildProcess } from 'child_process';
import { superviseCapture, type SupervisorEvents } from '../server/capture-supervisor';

class FakeProc extends EventEmitter {
  killed = false;
  kill() {
    this.killed = true;
    this.emit('exit');
    return true;
  }
}

function setup() {
  const procs: FakeProc[] = [];
  const errs: ((m: string) => void)[] = [];
  const calls: string[] = [];
  const ev: SupervisorEvents = {
    permission: () => calls.push('permission'),
    error: (m) => calls.push(`error:${m}`),
    restarting: () => calls.push('restarting'),
    dead: () => calls.push('dead'),
    noBackend: () => calls.push('noBackend'),
  };
  const sup = superviseCapture((onError) => {
    const p = new FakeProc();
    procs.push(p);
    errs.push(onError);
    return p as unknown as ChildProcess;
  }, ev);
  return { sup, procs, errs, calls };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('superviseCapture', () => {
  it('restarts once, then declares the capture dead on a second quick death', () => {
    const { procs, calls } = setup();
    procs[0].emit('exit');
    expect(calls).toEqual(['restarting']);
    vi.advanceTimersByTime(2000);
    expect(procs).toHaveLength(2);
    procs[1].emit('exit');
    expect(calls).toEqual(['restarting', 'dead']);
    vi.advanceTimersByTime(5000);
    expect(procs).toHaveLength(2);
  });

  it('stops restarting after a permission error', () => {
    const { procs, errs, calls } = setup();
    errs[0]('dumpcap: You don\'t have permission to capture on that device');
    procs[0].emit('exit');
    vi.advanceTimersByTime(5000);
    expect(calls).toEqual(['permission']);
    expect(procs).toHaveLength(1);
  });

  it('restart() (interface switch) replaces the process without counting as a crash', () => {
    const { sup, procs, calls } = setup();
    sup.restart();
    expect(procs[0].killed).toBe(true);
    expect(procs).toHaveLength(2);
    vi.advanceTimersByTime(5000);
    expect(calls).toEqual([]);
    expect(procs).toHaveLength(2);
  });

  it('stop() kills without restarting', () => {
    const { sup, procs, calls } = setup();
    sup.stop();
    vi.advanceTimersByTime(5000);
    expect(procs).toHaveLength(1);
    expect(calls).toEqual([]);
  });

  it('reports a missing backend', () => {
    const calls: string[] = [];
    superviseCapture(() => null, {
      permission() {},
      error() {},
      restarting() {},
      dead() {},
      noBackend: () => calls.push('noBackend'),
    });
    expect(calls).toEqual(['noBackend']);
  });

  it('treats only real permission failures as permission errors', () => {
    const { errs, calls } = setup();
    errs[0]('tcpdump: syntax error in filter expression: bpf compile failed');
    errs[0]('dumpcap: The capture session could not be initiated (Operation not permitted)');
    expect(calls).toEqual(['error:tcpdump: syntax error in filter expression: bpf compile failed', 'permission']);
  });
});
