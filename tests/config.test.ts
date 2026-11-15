import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildProviders, capped, fetchCommunityGates, loadServerConfig, type ServerConfig } from '../src/app/config';
import { resolveAll } from '../src/app/resolveAll';
import type { KeyValueStore } from '../src/providers/types';

const mem = (): KeyValueStore => {
  const m = new Map<string, unknown>();
  return { get: async (k) => m.get(k) as never, set: async (k, v) => { m.set(k, v); }, delete: async (k) => { m.delete(k); }, keys: async () => [...m.keys()] };
};
const ON: ServerConfig = { providers: { geocode: true, mapData: true, route: true, community: true }, banner: null };

afterEach(() => vi.unstubAllGlobals());

describe('per-device routing cap', () => {
  it('allows the cap, then refuses with a 429 so the planner uses the in-browser engine; resets next day', async () => {
    let calls = 0;
    let now = Date.parse('2026-11-15T10:00:00Z');
    const r = capped({ matrix: async () => { calls++; return 1; } }, ['matrix'], mem(), () => now, 2);
    await r.matrix(); await r.matrix();
    await expect(r.matrix()).rejects.toMatchObject({ status: 429 });
    expect(calls).toBe(2);
    now += 86_400_000;
    await expect(r.matrix()).resolves.toBe(1);
  });
});

describe('server config and provider switches', () => {
  it('demo mode when there is no API base', async () => {
    expect(await loadServerConfig('')).toBeNull();
    expect(buildProviders(mem(), ON, '')).toBeNull();
  });

  it('reads /config; if the Worker is unreachable it carries on rather than blocking', async () => {
    vi.stubGlobal('fetch', async () => Response.json({ providers: { ...ON.providers, route: false }, banner: 'Busy' }));
    expect(await loadServerConfig('https://api.test')).toMatchObject({ banner: 'Busy' });
    vi.stubGlobal('fetch', async () => { throw new Error('offline'); });
    expect((await loadServerConfig('https://api.test'))?.providers.route).toBe(true);
  });

  it('a switched-off provider fails cleanly instead of calling the Worker', async () => {
    const f = vi.fn(); vi.stubGlobal('fetch', f);
    const p = buildProviders(mem(), { ...ON, providers: { ...ON.providers, route: false } }, 'https://api.test')!;
    await expect(p.router.matrix([{ lat: 1.3, lng: 103.8 }])).rejects.toMatchObject({ status: 503 });
    expect(f).not.toHaveBeenCalled();
  });
});

describe('community gates', () => {
  it('asks for postal codes only, and fails soft', async () => {
    const f = vi.fn(async () => Response.json({ gates: [{ id: 'g1', name: 'Blossom', postals: ['677721'], gate: { lat: 1.34, lng: 103.75 }, gated: true }] }));
    vi.stubGlobal('fetch', f);
    const g = await fetchCommunityGates(['677721', '677721', '677722'], 'https://api.test');
    expect(f).toHaveBeenCalledWith('https://api.test/community/gates?postals=677721,677722', expect.anything());
    expect(g[0]).toMatchObject({ developmentId: 'g1', gated: true });
    vi.stubGlobal('fetch', async () => { throw new Error('x'); });
    expect(await fetchCommunityGates(['677721'], 'https://api.test')).toEqual([]);
    expect(await fetchCommunityGates([], 'https://api.test')).toEqual([]);
  });

  it('resolveAll hands only postal codes to the community lookup', async () => {
    const seen: string[][] = [];
    const providers = buildProviders(mem(), ON, 'https://api.test')!;
    vi.stubGlobal('fetch', async () => Response.json({ results: [] }));
    await resolveAll(
      [{ id: 's1', raw: 'x', name: 'Mr Tan', unit: '#03-18', phone: '91234567', postal: '677723', block: '12', street: 'Hougang St 51' } as never],
      providers,
      async (p) => { seen.push(p); return []; },
    );
    expect(seen).toEqual([['677723']]);
  });
});

describe('resolveAll speed and resilience', () => {
  const stopOf = (i: number) => ({ id: `s${i}`, raw: '', postal: String(677700 + i) }) as never;
  const hit = (postal: string) => ({ postal, block: '1', street: 'X', position: { lat: 1.3, lng: 103.8 } });
  const area = { roads: [], gates: [], developments: [] };

  it('looks stops up in parallel, keeps their order and reports progress', async () => {
    let live = 0; let peak = 0;
    const gate = async () => { live++; peak = Math.max(peak, live); await new Promise((r) => setTimeout(r, 15)); live--; };
    const p = {
      geocoder: { id: 'g', byPostal: async (q: string) => { await gate(); return hit(q); }, bySearch: async () => [] },
      mapData: { id: 'm', around: async () => area },
    } as never;
    const progress: number[] = [];
    const { resolved } = await resolveAll(Array.from({ length: 10 }, (_, i) => stopOf(i)), p, async () => [], (n) => progress.push(n));
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(4);
    expect(resolved.map((r) => r.stop.id)).toEqual(Array.from({ length: 10 }, (_, i) => `s${i}`));
    expect(progress.at(-1)).toBe(10);
  });

  it('skips a failing map-data service after three failures but still places every stop', async () => {
    let calls = 0;
    const p = {
      geocoder: { id: 'g', byPostal: async (q: string) => hit(q), bySearch: async () => [] },
      mapData: { id: 'm', around: async () => { calls++; throw new Error('slow'); } },
    } as never;
    const { resolved } = await resolveAll(Array.from({ length: 12 }, (_, i) => stopOf(i)), p, async () => []);
    expect(resolved).toHaveLength(12);
    expect(resolved.every((r) => r.place !== null && r.flags.includes('check-pin'))).toBe(true);
    expect(calls).toBeLessThan(12);
  });

  it('never drops a stop when the address lookup itself fails', async () => {
    const p = {
      geocoder: { id: 'g', byPostal: async () => { throw new Error('down'); }, bySearch: async () => [] },
      mapData: { id: 'm', around: async () => area },
    } as never;
    const { resolved } = await resolveAll([stopOf(1), stopOf(2)], p, async () => []);
    expect(resolved.map((r) => [r.place, r.flags])).toEqual([[null, ['not-found']], [null, ['not-found']]]);
  });
});
