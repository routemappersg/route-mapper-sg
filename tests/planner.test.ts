import { describe, expect, it } from 'vitest';
import type { Place, Stop } from '../src/domain/types';
import type { Resolved } from '../src/app/resolveAll';
import { loadResolutions, saveResolutions } from '../src/app/resolvedStore';
import { resolveAll } from '../src/app/resolveAll';
import { inOrder, pendingCount, preview, rowStatus } from '../src/planner/thread';
import { departureNow, dueInfo } from '../src/review/model';
import type { KeyValueStore } from '../src/providers/types';

const stop = (id: string, extra: Partial<Stop> = {}): Stop => ({ id, status: 'pending', flags: [], ...extra });
const place = (extra: Partial<Place> = {}): Place => ({ position: { lat: 1.3, lng: 103.8 }, gated: false, confidence: 'map-data', ...extra });
const res = (id: string, p: Place | null, flags: string[] = []): Resolved => ({ stop: stop(id), place: p, flags });

const mem = (): KeyValueStore => {
  const m = new Map<string, unknown>();
  return {
    get: async <T,>(k: string) => m.get(k) as T | undefined,
    set: async <T,>(k: string, v: T) => { m.set(k, v); },
    delete: async (k) => { m.delete(k); },
    keys: async () => [...m.keys()],
  };
};

describe('chat rows', () => {
  it('shows each lookup state, and never hides a stop that could not be placed', () => {
    expect(rowStatus(undefined).state).toBe('finding');
    expect(rowStatus(res('a', place())).state).toBe('pinned');
    expect(rowStatus(res('a', place({ gated: true }))).state).toBe('gated');
    expect(rowStatus(res('a', place(), ['check-pin'])).state).toBe('check');
    expect(rowStatus(res('a', null, ['not-found'])).state).toBe('notfound');
    expect(rowStatus(res('a', place(), ['demo'])).state).toBe('pinned');
  });

  it('counts pending lookups and keeps stop order, reporting unanswered stops as not found', () => {
    const stops = [stop('a'), stop('b'), stop('c')];
    const done = new Map([['c', res('c', place())], ['a', res('a', place())]]);
    expect(pendingCount(stops, done)).toBe(1);
    const list = inOrder(stops, done);
    expect(list.map((r) => r.stop.id)).toEqual(['a', 'b', 'c']);
    expect(list[1]).toMatchObject({ place: null, flags: ['not-found'] });
  });

  it('previews long pastes without keeping the whole text', () => {
    expect(preview('a\n\n b \nc')).toBe('a\nb\nc');
    expect(preview('1\n2\n3\n4\n5\n6')).toBe('1\n2\n3\n4\n… +2');
  });
});

describe('deliver-by', () => {
  it('compares the planned arrival with the deadline', () => {
    const s = stop('a', { deadlineMin: 13 * 60 });
    expect(dueInfo(s, 12 * 60)).toEqual({ time: '13:00', slackMin: 60, state: 'ok' });
    expect(dueInfo(s, 12 * 60 + 50)).toMatchObject({ slackMin: 10, state: 'tight' });
    expect(dueInfo(s, 13 * 60 + 12)).toMatchObject({ slackMin: -12, state: 'late' });
    expect(dueInfo(stop('b'), 600)).toBeNull();
  });

  it('plans from now, rounded up to 5 minutes', () => {
    expect(departureNow(new Date(2026, 10, 22, 14, 21))).toBe(14 * 60 + 25);
    expect(departureNow(new Date(2026, 10, 22, 14, 25))).toBe(14 * 60 + 25);
  });
});

describe('live lookups', () => {
  it('reports each stop the moment it is found, not after the whole batch', async () => {
    const hit = (postal: string) => ({ postal, block: '1', street: 'X', position: { lat: 1.3, lng: 103.8 } });
    const providers = {
      geocoder: { id: 'g', byPostal: async (q: string) => { await new Promise((r) => setTimeout(r, q.endsWith('0') ? 40 : 5)); return hit(q); }, bySearch: async () => [] },
      mapData: { id: 'm', around: async () => ({ roads: [], gates: [], developments: [] }) },
    } as never;
    const seen: string[] = [];
    const stops = [stop('slow', { postal: '677720' }), stop('fast', { postal: '677721' })];
    const batchDone = resolveAll(stops, providers, async () => [], undefined, (r) => seen.push(r.stop.id));
    await new Promise((r) => setTimeout(r, 20));
    expect(seen).toEqual(['fast']); // the quick one is already on screen while the slow one is still running
    await batchDone;
    expect(seen).toEqual(['fast', 'slow']);
  });

  it('keeps found positions on the device, and only those', async () => {
    const store = mem();
    await saveResolutions(store, { a: { place: place(), flags: [] }, b: { place: place(), flags: ['check-pin'] } });
    expect(Object.keys(await loadResolutions(store, ['a', 'zzz']))).toEqual(['a']);
  });
});
