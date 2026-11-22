/**
 * Upstream proxies. Credentials live here, never in the app. Everything arriving here has
 * already passed the payload guard. Postal geocodes and map data are non-personal and cached
 * at the edge (Cache API: free, unlike KV writes), which also protects the free quotas.
 */
import type { Env, Platform } from './env';
import { overpassQuery } from '../../src/providers/overpass';

const UA = 'RouteMapperSG/1 (+https://github.com/routemappersg/route-mapper-sg)';
const DAY = 86_400;
const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

const ONEMAP = 'https://www.onemap.gov.sg';

export function createProxy(p: Platform) {
  let token: { value: string; exp: number } | null = null;
  let scheme: 'raw' | 'bearer' = 'raw';

  const cached = async (key: string): Promise<Response | undefined> => p.cache.match(new Request(key));
  const store = async (key: string, body: string, ttlSec: number): Promise<void> => {
    await p.cache.put(new Request(key), new Response(body, { headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${ttlSec}` } }));
  };

  async function oneMapToken(env: Env, force: boolean): Promise<string | null> {
    if (!env.ONEMAP_EMAIL || !env.ONEMAP_PASSWORD) return null;
    const nowSec = p.now() / 1000;
    if (!force && token && token.exp - 3600 > nowSec) return token.value;
    const key = 'https://cache.internal/onemap-token';
    if (!force) {
      const hit = await cached(key);
      if (hit) {
        const t = (await hit.json()) as { value: string; exp: number };
        if (t.exp - 3600 > nowSec) { token = t; return t.value; }
      }
    }
    const res = await p.fetch(`${ONEMAP}/api/auth/post/getToken`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': UA },
      body: JSON.stringify({ email: env.ONEMAP_EMAIL, password: env.ONEMAP_PASSWORD }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { access_token?: string; expiry_timestamp?: string | number };
    if (!body.access_token) return null;
    const exp = Number(body.expiry_timestamp) || nowSec + 3 * DAY;
    token = { value: body.access_token, exp };
    await store(key, JSON.stringify(token), Math.max(60, Math.floor(exp - 3600 - nowSec)));
    return token.value;
  }

  /** The caller has already validated `q` (postal or block + street). */
  async function oneMapSearch(env: Env, q: string): Promise<Response> {
    const key = `https://cache.internal/onemap/${encodeURIComponent(q)}`;
    const hit = await cached(key);
    if (hit) return new Response(hit.body, { status: 200, headers: { 'content-type': 'application/json', 'x-cache': 'hit' } });

    const url = `${ONEMAP}/api/common/elastic/search?searchVal=${encodeURIComponent(q)}&returnGeom=Y&getAddrDetails=Y&pageNum=1`;
    const call = async (t: string, s: 'raw' | 'bearer'): Promise<Response> =>
      p.fetch(url, { headers: { authorization: s === 'bearer' ? `Bearer ${t}` : t, 'user-agent': UA }, signal: AbortSignal.timeout(10_000) });

    let t = await oneMapToken(env, false);
    if (!t) return json({ error: 'onemap-not-configured' }, 503);
    let res = await call(t, scheme);
    if (res.status === 401 || res.status === 403) {
      // The documented header format varies between sources: renew the token, then try the other format once.
      t = (await oneMapToken(env, true)) ?? t;
      res = await call(t, scheme);
      if (res.status === 401 || res.status === 403) {
        const other = scheme === 'raw' ? 'bearer' : 'raw';
        const second = await call(t, other);
        if (second.ok) { scheme = other; res = second; }
      }
    }
    if (!res.ok) return json({ error: 'onemap-upstream', status: res.status }, res.status === 429 ? 429 : 502);
    const text = await res.text();
    const parsed = ((): { results?: unknown[] } | null => { try { return JSON.parse(text) as { results?: unknown[] }; } catch { return null; } })();
    if (!parsed) return json({ error: 'onemap-bad-json' }, 502);
    const hasResults = (parsed.results ?? []).length > 0;
    await store(key, text, hasResults ? 30 * DAY : DAY);
    return new Response(text, { status: 200, headers: { 'content-type': 'application/json', 'x-cache': 'miss' } });
  }

  /** Map data is public OSM data; a 4-decimal grid (about 11 m) lets nearby requests share a cache entry. */
  async function overpass(env: Env, a: { lat: number; lng: number; radius: number }): Promise<Response> {
    const lat = Number(a.lat.toFixed(4));
    const lng = Number(a.lng.toFixed(4));
    const key = `https://cache.internal/overpass/${lat}/${lng}/${a.radius}`;
    const hit = await cached(key);
    if (hit) return new Response(hit.body, { status: 200, headers: { 'content-type': 'application/json', 'x-cache': 'hit' } });
    const query = overpassQuery({ lat, lng }, a.radius);
    const urls = (env.OVERPASS_URLS ?? 'https://overpass-api.de/api/interpreter,https://overpass.kumi.systems/api/interpreter')
      .split(',').map((s) => s.trim()).filter(Boolean);
    for (const u of urls) {
      try {
        const res = await p.fetch(u, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': UA },
          body: `data=${encodeURIComponent(query)}`,
          signal: AbortSignal.timeout(12_000), // a slow free mirror must not hold the whole plan up
        });
        if (!res.ok) continue;
        const text = await res.text();
        JSON.parse(text);
        await store(key, text, 7 * DAY);
        return new Response(text, { status: 200, headers: { 'content-type': 'application/json', 'x-cache': 'miss' } });
      } catch { /* try the next mirror */ }
    }
    return json({ error: 'overpass-unavailable' }, 502);
  }

  async function ors(env: Env, path: string, body: unknown): Promise<Response> {
    if (!env.ORS_API_KEY) return json({ error: 'ors-not-configured' }, 503);
    let res: Response;
    try {
      res = await p.fetch(`https://api.openrouteservice.org${path.replace(/^\/ors/, '')}`, {
        method: 'POST',
        headers: { authorization: env.ORS_API_KEY, 'content-type': 'application/json', accept: 'application/json, application/geo+json', 'user-agent': UA },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      return json({ error: 'ors-unreachable' }, 502);
    }
    const text = await res.text();
    if (res.status === 429) return json({ error: 'ors-quota' }, 429, { 'retry-after': '3600' });
    if (!res.ok) return json({ error: 'ors-upstream', status: res.status }, 502);
    return new Response(text, { status: 200, headers: { 'content-type': 'application/json' } });
  }

  return { oneMapSearch, overpass, ors };
}
