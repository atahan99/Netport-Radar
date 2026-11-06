// server/home.ts
// Where the "home airport" sits. Behind NAT the captured source IP is private,
// so the primary home comes from ONE lookup of the public IP's location per
// session: ipapi.co, then ipify plus the local GeoIP database, both over HTTPS.
// NETPORT_HOME_LAT/LNG(/LABEL) skips the lookup entirely.

import type { HomeAirport } from '../src/types';
import { geoLookup } from './capture';

// Hosts contacted by resolvePrimaryHome — their IPs must never become flights.
export const HOME_PROBE_HOSTS = ['ipapi.co', 'api.ipify.org'];

interface IpapiCoResp {
  latitude: number;
  longitude: number;
  city: string;
  country_code: string;
  ip: string;
}

export async function resolvePrimaryHome(): Promise<HomeAirport> {
  const { NETPORT_HOME_LAT, NETPORT_HOME_LNG, NETPORT_HOME_LABEL } = process.env;
  const lat = Number(NETPORT_HOME_LAT);
  const lng = Number(NETPORT_HOME_LNG);
  if (NETPORT_HOME_LAT && NETPORT_HOME_LNG && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
    return {
      id: 'primary',
      label: NETPORT_HOME_LABEL ?? 'Home',
      lat,
      lng,
      ip: '',
      isVpn: false,
    };
  }
  if (NETPORT_HOME_LAT || NETPORT_HOME_LNG) {
    console.warn('[home] NETPORT_HOME_LAT/LNG missing or out of range; looking the location up instead');
  }
  try {
    const r = await fetch('https://ipapi.co/json/', { signal: AbortSignal.timeout(4000) });
    const j = (await r.json()) as IpapiCoResp;
    if (typeof j.latitude === 'number' && typeof j.longitude === 'number') {
      return {
        id: 'primary',
        label: j.city ? `${j.city}, ${j.country_code}` : (j.country_code ?? 'Home'),
        lat: j.latitude,
        lng: j.longitude,
        ip: j.ip ?? '',
        isVpn: false,
      };
    }
  } catch {
    /* fall through */
  }
  try {
    const ip = (
      await (await fetch('https://api.ipify.org', { signal: AbortSignal.timeout(4000) })).text()
    ).trim();
    const geo = geoLookup(ip);
    if (geo) {
      return {
        id: 'primary',
        label: geo.city ? `${geo.city}, ${geo.country}` : geo.country,
        lat: geo.lat,
        lng: geo.lng,
        ip,
        isVpn: false,
      };
    }
  } catch {
    /* offline */
  }
  return { id: 'primary', label: 'Local', lat: 0, lng: 0, ip: '', isVpn: false };
}

