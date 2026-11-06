import { describe, it, expect, vi, afterEach } from 'vitest';
import { applyLsofOutput, lookupProcess } from '../server/process-names';
import { PROCESS_RETAIN_MS } from '../server/config';

// lsof -FpcPn output: one field per line, p=pid c=command P=proto n=name.
const LSOF = [
  'p501',
  'cGoogle Chrome Helper',
  'PTCP',
  'n192.168.1.5:50000->142.250.1.1:443',
  'PUDP',
  'n*:5353',
  'p777',
  'cssh',
  'PTCP',
  'n[2001:db8::5]:51000->[2001:db8::1]:22',
].join('\n');

afterEach(() => vi.useRealTimers());

describe('applyLsofOutput / lookupProcess', () => {
  it('maps proto:localPort to the owning process, names with spaces included', () => {
    applyLsofOutput(LSOF);
    expect(lookupProcess(50000, 'TCP')).toMatchObject({ processRaw: 'Google Chrome Helper', pid: 501 });
    expect(lookupProcess(5353, 'UDP')).toMatchObject({ pid: 501 });
    expect(lookupProcess(51000, 'TCP')).toMatchObject({ processRaw: 'ssh', pid: 777 });
    expect(lookupProcess(50000, 'UDP')).toBeNull();
  });

  it('keeps a closed socket briefly so sub-poll flows still attribute, then drops it', () => {
    vi.useFakeTimers();
    applyLsofOutput(LSOF);
    applyLsofOutput(['p777', 'cssh', 'PTCP', 'n10.0.0.2:51000->10.0.0.1:22'].join('\n'));
    expect(lookupProcess(50000, 'TCP')).not.toBeNull(); // gone from lsof, still retained
    vi.advanceTimersByTime(PROCESS_RETAIN_MS + 10);
    applyLsofOutput(['p777', 'cssh', 'PTCP', 'n10.0.0.2:51000->10.0.0.1:22'].join('\n'));
    expect(lookupProcess(50000, 'TCP')).toBeNull();
  });
});
