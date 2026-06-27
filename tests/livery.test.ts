import { describe, it, expect } from 'vitest';
import { normalizeProcess, liveryColor, LIVERY_COLORS } from '../src/lib/livery';

describe('LIVERY_COLORS', () => {
  it('has 60+ brand entries', () => {
    expect(Object.keys(LIVERY_COLORS).length).toBeGreaterThanOrEqual(60);
  });

  it('every brand color is a valid hex', () => {
    for (const hex of Object.values(LIVERY_COLORS)) {
      expect(hex).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

describe('normalizeProcess', () => {
  it('aliases raw OS names to canonical process keys', () => {
    expect(normalizeProcess('Google Chrome Helper (Renderer)')).toBe('chrome');
    expect(normalizeProcess('Brave Browser')).toBe('brave');
    expect(normalizeProcess('Cursor')).toBe('code');
    expect(normalizeProcess('Visual Studio Code')).toBe('code');
    expect(normalizeProcess('com.spotify.client')).toBe('spotify');
    expect(normalizeProcess('Microsoft Edge')).toBe('edge');
    expect(normalizeProcess('WhatsApp')).toBe('whatsapp');
    expect(normalizeProcess('Docker Desktop')).toBe('docker');
    expect(normalizeProcess('Tailscale')).toBe('tailscale');
    expect(normalizeProcess('EpicGamesLauncher')).toBe('epicgames');
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
    expect(liveryColor('Google Chrome Helper')).toBe('#4285F4');
    expect(liveryColor('netflix')).toBe('#E50914');
    expect(liveryColor('tailscale')).toBe('#6366F1');
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
