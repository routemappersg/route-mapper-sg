import { describe, expect, it } from 'vitest';
import { GPS_FRESH_MS, chooseDepot, coarse, inSingapore, locate, needsRefresh, startFromPostal, type StartPoint } from '../src/app/start';

const gps = (at: number): StartPoint => ({ position: { lat: 1.35, lng: 103.82 }, source: 'gps', at });

describe('start point', () => {
  it('rounds to about 110 m before anything can leave the device', () => {
    expect(coarse({ lat: 1.352149, lng: 103.819836 })).toEqual({ lat: 1.352, lng: 103.82 });
  });

  it('knows what is inside Singapore', () => {
    expect(inSingapore({ lat: 1.3, lng: 103.8 })).toBe(true);
    expect(inSingapore({ lat: 1.49, lng: 103.76 })).toBe(false); // Johor Bahru
  });

  it('refreshes a GPS start after a few minutes but never a typed postal code', () => {
    const now = 1_000_000;
    expect(needsRefresh(undefined, now)).toBe(true);
    expect(needsRefresh(gps(now - 1000), now)).toBe(false);
    expect(needsRefresh(gps(now - GPS_FRESH_MS - 1), now)).toBe(true);
    expect(needsRefresh({ ...gps(0), source: 'postal', postal: '560123' }, now)).toBe(false);
  });

  it('never blocks planning: with no start the route begins at the first stop', () => {
    const first = { lat: 1.3, lng: 103.9 };
    expect(chooseDepot(gps(1), first)).toEqual({ depot: { lat: 1.35, lng: 103.82 }, known: true });
    expect(chooseDepot(undefined, first)).toEqual({ depot: first, known: false });
    expect(chooseDepot(undefined, undefined)).toBeNull();
  });

  it('locate() returns a rounded position, or says why not', async () => {
    const ok = { getCurrentPosition: (s: PositionCallback) => s({ coords: { latitude: 1.352149, longitude: 103.819836 } } as GeolocationPosition) };
    expect(await locate(ok)).toEqual({ ok: true, position: { lat: 1.352, lng: 103.82 } });
    const denied = { getCurrentPosition: (_s: PositionCallback, e?: PositionErrorCallback | null) => e?.({ code: 1 } as GeolocationPositionError) };
    expect(await locate(denied)).toEqual({ ok: false, reason: 'denied' });
    const abroad = { getCurrentPosition: (s: PositionCallback) => s({ coords: { latitude: 3.14, longitude: 101.69 } } as GeolocationPosition) };
    expect(await locate(abroad)).toEqual({ ok: false, reason: 'outside' });
    expect(await locate(undefined as never)).toEqual({ ok: false, reason: 'unavailable' });
  });

  it('startFromPostal sends only the postal code and rejects anything else', async () => {
    const asked: string[] = [];
    const geocoder = { id: 'g', byPostal: async (p: string) => { asked.push(p); return { postal: p, position: { lat: 1.3912, lng: 103.8956 } }; }, bySearch: async () => [] };
    expect(await startFromPostal(geocoder, 'Blk 1 #01-01')).toBeNull();
    const s = await startFromPostal(geocoder, '540248', 5);
    expect(s).toEqual({ position: { lat: 1.391, lng: 103.896 }, source: 'postal', postal: '540248', at: 5 });
    expect(asked).toEqual(['540248']);
  });
});
