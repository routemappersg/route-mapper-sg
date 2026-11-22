/**
 * The driver's start point. It is kept on the device only. Anything that leaves the device
 * (road matrix, optimizer) gets coordinates rounded to ~110 m, which is plenty for routing
 * and means the exact spot a driver stands on is never sent anywhere.
 */
import type { LatLng } from '../domain/types';
import type { Geocoder, KeyValueStore } from '../providers/types';

export interface StartPoint {
  position: LatLng;
  source: 'gps' | 'postal';
  /** Postal code when the driver typed one. */
  postal?: string;
  /** When it was taken (ms). A GPS start older than a few minutes is refreshed before planning. */
  at: number;
}

const KEY = 'start';
/** Roughly Singapore, with a margin: anything outside is not a usable start. */
const SG = { minLat: 1.15, maxLat: 1.48, minLng: 103.55, maxLng: 104.1 };

export const inSingapore = (p: LatLng): boolean =>
  p.lat >= SG.minLat && p.lat <= SG.maxLat && p.lng >= SG.minLng && p.lng <= SG.maxLng;

/** Round to 3 decimals (about 110 m). */
export const coarse = (p: LatLng): LatLng => ({ lat: Math.round(p.lat * 1000) / 1000, lng: Math.round(p.lng * 1000) / 1000 });

export const loadStart = (store: KeyValueStore): Promise<StartPoint | undefined> => store.get<StartPoint>(KEY);
export const saveStart = (store: KeyValueStore, s: StartPoint): Promise<void> => store.set(KEY, s);
export const clearStart = (store: KeyValueStore): Promise<void> => store.delete(KEY);

export type GeoResult = { ok: true; position: LatLng } | { ok: false; reason: 'denied' | 'unavailable' | 'outside' };

/** Ask the device where it is. Must be called from a tap the first time (the browser shows a permission prompt). */
export function locate(
  geo: Pick<Geolocation, 'getCurrentPosition'> | undefined = typeof navigator === 'undefined' ? undefined : navigator.geolocation,
  timeoutMs = 10_000,
): Promise<GeoResult> {
  return new Promise((resolve) => {
    if (!geo) return resolve({ ok: false, reason: 'unavailable' });
    geo.getCurrentPosition(
      (p) => {
        const position = coarse({ lat: p.coords.latitude, lng: p.coords.longitude });
        resolve(inSingapore(position) ? { ok: true, position } : { ok: false, reason: 'outside' });
      },
      (e) => resolve({ ok: false, reason: e.code === 1 ? 'denied' : 'unavailable' }),
      { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 60_000 },
    );
  });
}

/** Start from a postal code (only the postal code is sent to the geocoder). */
export async function startFromPostal(geocoder: Geocoder, postal: string, now = Date.now()): Promise<StartPoint | null> {
  if (!/^\d{6}$/.test(postal)) return null;
  const hit = await geocoder.byPostal(postal);
  if (!hit || !inSingapore(hit.position)) return null;
  return { position: coarse(hit.position), source: 'postal', postal, at: now };
}

/** GPS starts go stale as the driver moves: refresh when older than this. */
export const GPS_FRESH_MS = 5 * 60_000;
export const needsRefresh = (s: StartPoint | undefined, now = Date.now()): boolean =>
  !s || (s.source === 'gps' && now - s.at > GPS_FRESH_MS);

/**
 * Where the route begins. Never blocks planning: with no start at all the route begins at the
 * first stop and the driver is told.
 */
export function chooseDepot(start: StartPoint | undefined, firstStop: LatLng | undefined): { depot: LatLng; known: boolean } | null {
  if (start) return { depot: start.position, known: true };
  return firstStop ? { depot: firstStop, known: false } : null;
}
