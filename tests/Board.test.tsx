// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { Board } from '../src/components/Board';
import { useFlightsStore } from '../src/store/flights';
import { useFiltersStore } from '../src/store/filters';
import { makeFlight } from './helpers';

afterEach(() => {
  cleanup();
  useFlightsStore.setState({ flights: [], selectedFlightId: null });
  useFiltersStore.setState({ boardTab: 'outbound' });
});

describe('<Board> tabs', () => {
  it('counts both directions and switches lists by tab', () => {
    useFlightsStore.setState({
      flights: [
        makeFlight({ id: 'OUT-1', direction: 'outbound', hostname: 'out.example' }),
        makeFlight({ id: 'IN-1', direction: 'inbound', hostname: 'in.example' }),
        makeFlight({ id: 'IN-2', direction: 'inbound', hostname: 'in2.example' }),
      ],
    });
    render(<Board />);
    const dep = screen.getByRole('tab', { name: /departures/i });
    const arr = screen.getByRole('tab', { name: /arrivals/i });
    expect(dep.textContent).toContain('1');
    expect(arr.textContent).toContain('2');
    expect(dep.getAttribute('aria-selected')).toBe('true');
    expect(screen.getAllByRole('option').map((o) => o.getAttribute('title'))).toEqual(['out.example']);

    fireEvent.click(arr);
    expect(useFiltersStore.getState().boardTab).toBe('inbound');
    expect(arr.getAttribute('aria-selected')).toBe('true');
    expect(screen.getAllByRole('option')).toHaveLength(2);
  });

  it('log tab lists both directions with full detail', () => {
    useFlightsStore.setState({
      flights: [
        makeFlight({ id: 'OUT-1', direction: 'outbound', dstIp: '9.9.9.9', org: 'Quad9', process: 'curl' }),
        makeFlight({ id: 'IN-1', direction: 'inbound', dstIp: '8.8.4.4' }),
      ],
    });
    useFiltersStore.setState({ boardTab: 'log' });
    render(<Board />);
    const rows = screen.getAllByRole('option');
    expect(rows).toHaveLength(2);
    const text = rows.map((r) => r.textContent).join(' ');
    expect(text).toContain('9.9.9.9:443');
    expect(text).toContain('Quad9');
    expect(text).toContain('curl');
    expect(text).toContain('8.8.4.4');
  });

  it('switches tabs with the arrow keys', () => {
    render(<Board />);
    fireEvent.keyDown(screen.getByRole('tab', { name: /departures/i }), { key: 'ArrowRight' });
    expect(useFiltersStore.getState().boardTab).toBe('inbound');
  });
});
