// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import FilterChips from '../src/components/FilterChips';
import { useFiltersStore } from '../src/store/filters';

afterEach(() => {
  cleanup();
  useFiltersStore.getState().reset();
});

describe('<FilterChips>', () => {
  it('renders nothing when no filters are active', () => {
    useFiltersStore.getState().reset();
    const { container } = render(<FilterChips />);
    expect(container.firstChild).toBeNull();
  });

  it('shows a removable chip for an active filter and clears it on click', () => {
    useFiltersStore.setState({ appSearch: 'brave' });
    render(<FilterChips />);
    const chip = screen.getByTitle('Clear filter: Search: "brave"');
    fireEvent.click(chip);
    expect(useFiltersStore.getState().appSearch).toBe('');
  });
});
