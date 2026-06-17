import { describe, it, expect } from 'vitest';
import { normalizeProcess, liveryColor } from '../src/lib/livery';

describe('normalizeProcess', () => {
  it('aliases raw OS names to canonical process keys', () => {
    expect(normalizeProcess('Google Chrome Helper')).toBe('chrome');
    expect(normalizeProcess('Brave Browser')).toBe('brave');
    expect(normalizeProcess('Cursor')).toBe('code');
    expect(normalizeProcess('Visual Studio Code')).toBe('code');
    expect(normalizeProcess('com.spotify.client')).toBe('spotify');
  });
  it('strips .exe / Helper suffixes for unknowns', () => {
    expect(normalizeProcess('SomeApp.exe')).toBe('someapp');
    expect(normalizeProcess('Foo Helper (Renderer)')).toBe('foo');
    expect(normalizeProcess('   ')).toBe('unknown');
  });
});

describe('liveryColor', () => {
  it('returns brand colors', () => {
    expect(liveryColor('chrome')).toBe('#4285F4');
    expect(liveryColor('brave')).toBe('#FB542B');
    expect(liveryColor('code')).toBe('#23A5C3');
    expect(liveryColor('cursor')).toBe('#23A5C3');
  });
  it('muted gray for system processes', () => {
    expect(liveryColor('kernel_task')).toBe('#7c8087');
    expect(liveryColor('svchost')).toBe('#7c8087');
  });
  it('deterministic HSL-derived hex for unknowns, stable across calls', () => {
    const a = liveryColor('some-unknown-app');
    const b = liveryColor('some-unknown-app');
    expect(a).toBe(b);
    expect(a).toMatch(/^#[0-9a-f]{6}$/);
    expect(liveryColor('another-app')).not.toBe(a);
  });
});
