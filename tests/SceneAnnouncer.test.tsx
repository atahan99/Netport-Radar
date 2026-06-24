// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import SceneAnnouncer from '../src/components/SceneAnnouncer';
import { useFlightsStore } from '../src/store/flights';
import { makeFlight } from './helpers';

afterEach(() => {
  cleanup();
  useFlightsStore.setState({ flights: [], selectedFlightId: null });
});

describe('<SceneAnnouncer>', () => {
  it('renders an sr-only description pointing keyboard/SR users to the lists', () => {
    useFlightsStore.setState({ flights: [], selectedFlightId: null });
    render(<SceneAnnouncer />);
    expect(screen.getByText(/live network connections are shown/i)).toBeTruthy();
    // nothing selected → the polite live region is empty
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('announces the selected flight in the live region', () => {
    const f = makeFlight({
      id: 'TCP-AAA',
      hostname: 'youtube.com',
      country: 'US',
      detectedProtocol: 'HTTPS',
      phase: 'cruise',
      direction: 'outbound',
    });
    useFlightsStore.setState({ flights: [f], selectedFlightId: f.id });
    render(<SceneAnnouncer />);
    const status = screen.getByRole('status');
    expect(status.textContent).toContain('TCP-AAA');
    expect(status.textContent).toContain('youtube.com');
  });
});
