import { describe, it, expect } from 'vitest';
import { geoFlagLabel, geoPlaceLabel, geoMarkerOpacity } from '../src/lib/geo-display';
import { makeFlight } from './helpers';

describe('geoFlagLabel', () => {
  it('shows ?? for unknown shelf', () => {
    expect(geoFlagLabel(makeFlight({ country: '??', countryFlag: '', geoConfidence: 'none' }))).toBe('??');
  });

  it('prefixes country code for centroid guesses', () => {
    expect(geoFlagLabel(makeFlight({ country: 'US', countryFlag: '🇺🇸', geoConfidence: 'country' }))).toBe('~US');
  });

  it('shows flag emoji for city-level geo', () => {
    expect(geoFlagLabel(makeFlight({ country: 'DE', countryFlag: '🇩🇪', geoConfidence: 'city' }))).toBe('🇩🇪');
  });
});

describe('geoPlaceLabel', () => {
  it('marks country-centroid guesses as approx', () => {
    expect(geoPlaceLabel(makeFlight({ city: 'Unknown', country: 'FR', geoConfidence: 'country' }))).toBe('FR (approx.)');
  });

  it('shows city for high-confidence placement', () => {
    expect(geoPlaceLabel(makeFlight({ city: 'Paris', country: 'FR', geoConfidence: 'city' }))).toBe('Paris, FR');
  });
});

describe('geoMarkerOpacity', () => {
  it('dims low-confidence markers', () => {
    expect(geoMarkerOpacity(makeFlight({ geoConfidence: 'city' }))).toBe(1);
    expect(geoMarkerOpacity(makeFlight({ geoConfidence: 'country' }))).toBe(0.85);
    expect(geoMarkerOpacity(makeFlight({ geoConfidence: 'none' }))).toBe(0.65);
  });
});
