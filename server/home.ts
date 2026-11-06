// server/home.ts
// Where the "home airport" sits. Behind NAT the captured source IP is private,
// so the primary home comes from ONE lookup of the public IP's location per
// session: ipapi.co (HTTPS) → ip-api.com (HTTP-only free tier) → ipify plus the
// local GeoIP database. NETPORT_HOME_LAT/LNG(/LABEL) skips the lookup entirely.

import type { HomeAirport } from '../src/types';
import { geoLookup } from './capture';

// Hosts contacted by resolvePrimaryHome — their IPs must never become flights.
export const HOME_PROBE_HOSTS = ['ipapi.co', 'ip-api.com', 'api.ipify.org'];

interface IpapiCoResp {
  latitude: number;
  longitude: number;
  city: string;
  country_code: string;
  ip: string;
}

interface IpApiResp {
  status: string;
  country: string;
  countryCode: string;
  city: string;
  lat: number;
  lon: number;
  query: string;
}

// Home airport from the public IP — still exactly ONE outbound lookup per
// session, just HTTPS-first now: ipapi.co (HTTPS) → ip-api.com (HTTP-only free
// tier) → ipify + local geoip-lite (country-accurate). Env override skips all.
export async function resolvePrimaryHome(): Promise<HomeAirport> {
  const { NETPORT_HOME_LAT, NETPORT_HOME_LNG, NETPORT_HOME_LABEL } = process.env;
  if (NETPORT_HOME_LAT && NETPORT_HOME_LNG) {
    return {
      id: 'primary',
      label: NETPORT_HOME_LABEL ?? 'Home',
      lat: Number(NETPORT_HOME_LAT),
      lng: Number(NETPORT_HOME_LNG),
      ip: '',
      isVpn: false,
    };
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
    const r = await fetch(
      'http://ip-api.com/json/?fields=status,country,countryCode,city,lat,lon,query',
      { signal: AbortSignal.timeout(4000) },
    );
    const j = (await r.json()) as IpApiResp;
    if (j.status === 'success') {
      return {
        id: 'primary',
        label: j.city ? `${j.city}, ${j.countryCode}` : j.country,
        lat: j.lat,
        lng: j.lon,
        ip: j.query,
        isVpn: false,
      };
    }
  } catch {
    /* fall through to the local DB */
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

