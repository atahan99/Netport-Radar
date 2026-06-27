// Low-confidence geo visual helpers — honest placement signals in the UI.

import type { Flight } from '@/types'

type GeoFields = Pick<Flight, 'country' | 'countryFlag' | 'geoConfidence' | 'city'>

export function geoFlagLabel(f: GeoFields): string {
  if (f.country === '??') return '??'
  if (f.geoConfidence === 'country') return `~${f.country}`
  return f.countryFlag
}

export function geoPlaceLabel(f: GeoFields): string {
  if (f.geoConfidence === 'none') return f.city
  if (f.geoConfidence === 'country') {
    const place = f.country && f.country !== '??' ? f.country : 'Unknown'
    return `${place} (approx.)`
  }
  return [f.city, f.country].filter(Boolean).join(', ')
}

export function geoMarkerOpacity(f: GeoFields): number {
  if (f.geoConfidence === 'none') return 0.65
  if (f.geoConfidence === 'country') return 0.85
  return 1
}
