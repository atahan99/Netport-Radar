// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { applyTheme, THEME_BY_ID, type ThemeName } from '../src/lib/themes';

describe('applyTheme', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.style.cssText = '';
  });

  it('sets the data-theme attribute and the accent/bg CSS variables', () => {
    applyTheme('matrix');
    const r = document.documentElement;
    expect(r.dataset.theme).toBe('matrix');
    expect(r.style.getPropertyValue('--theme-accent')).toBe(THEME_BY_ID.matrix.accent);
    expect(r.style.getPropertyValue('--theme-bg')).toBe(THEME_BY_ID.matrix.bg);
  });

  it('falls back to Midnight for an unknown theme id', () => {
    applyTheme('bogus' as ThemeName);
    expect(document.documentElement.dataset.theme).toBe('midnight');
  });
});
