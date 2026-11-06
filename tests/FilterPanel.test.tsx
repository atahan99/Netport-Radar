// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import FilterPanel from '../src/components/FilterPanel';
import { useFiltersStore } from '../src/store/filters';

afterEach(() => {
  cleanup();
  useFiltersStore.getState().reset();
  useFiltersStore.setState({ filterDrawerOpen: false });
});

describe('<FilterPanel> protocol chips', () => {
  it('shows on and off states differently, not just by shade', () => {
    useFiltersStore.setState({ filterDrawerOpen: true });
    render(<FilterPanel />);
    const https = screen.getByRole('button', { name: 'HTTPS' });
    expect(https.getAttribute('aria-pressed')).toBe('true');
    expect(https.className).not.toContain('line-through');

    fireEvent.click(https);
    expect(useFiltersStore.getState().showHTTPS).toBe(false);
    const off = screen.getByRole('button', { name: 'HTTPS' });
    expect(off.getAttribute('aria-pressed')).toBe('false');
    expect(off.className).toContain('line-through');
    expect(off.className).toContain('border-dashed');
  });
});
