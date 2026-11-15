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
