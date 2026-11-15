import { createApp } from '../../worker/src/app';
import { memoryDb } from '../../worker/src/db-memory';
import type { Env, Platform } from '../../worker/src/env';

export interface Upstream {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}

export const T0 = Date.parse('2026-11-15T10:00:00Z');

/** A Worker app wired to fakes: a clock, a Map cache, a memory database and a recording upstream. */
export function harness(opts: { env?: Env; withDb?: boolean; upstream?: (u: Upstream) => Response | undefined } = {}) {
  let t = T0;
  const calls: Upstream[] = [];
  const store = new Map<string, Response>();
  const db = memoryDb(() => t);
  const platform: Platform = {
    now: () => t,
    cache: {
      async match(req) { return store.get(req.url)?.clone(); },
      async put(req, res) { store.set(req.url, res.clone()); },
    },
    db: () => (opts.withDb === false ? null : db),
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers: Record<string, string> = {};
      new Headers(init?.headers).forEach((v, k) => { headers[k] = v; });
      const u: Upstream = { url: String(input), method: init?.method ?? 'GET', headers, body: typeof init?.body === 'string' ? init.body : '' };
      calls.push(u);
      const custom = opts.upstream?.(u);
      if (custom) return custom;
      if (u.url.includes('/api/auth/post/getToken')) {
        return Response.json({ access_token: 'TOKEN1', expiry_timestamp: String(Math.floor(t / 1000) + 3 * 86400) });
      }
      if (u.url.includes('/api/common/elastic/search')) {
        return Response.json({ results: [{ POSTAL: '677723', LATITUDE: '1.3', LONGITUDE: '103.8' }] });
      }
      if (u.url.includes('overpass')) return Response.json({ elements: [] });
      if (u.url.includes('openrouteservice')) return Response.json({ durations: [[0]], distances: [[0]] });
      return new Response('unexpected upstream', { status: 599 });
    }) as typeof fetch,
  };
  const env: Env = {
    ONEMAP_EMAIL: 'x@y.z', ONEMAP_PASSWORD: 'pw', ORS_API_KEY: 'ORSKEY', HASH_SALT: 'salt',
    ADMIN_TOKEN: 'admin-secret', ALLOWED_ORIGINS: 'https://app.test', ...opts.env,
  };
  const app = createApp(platform);
  const send = (path: string, init: RequestInit & { ip?: string; json?: unknown } = {}): Promise<Response> => {
    const { ip = '1.1.1.1', json, ...rest } = init;
    const headers = new Headers(rest.headers);
    headers.set('cf-connecting-ip', ip);
    if (json !== undefined) headers.set('content-type', 'application/json');
    return app.fetch(new Request(`https://w.test${path}`, { ...rest, headers, ...(json !== undefined ? { method: rest.method ?? 'POST', body: JSON.stringify(json) } : {}) }), env);
  };
  return {
    send, calls, db, env, app, platform,
    advance: (ms: number) => { t += ms; },
    upstreamCalls: (part: string) => calls.filter((c) => c.url.includes(part)),
  };
}

export const sgPts = (n: number): [number, number][] => Array.from({ length: n }, (_, i) => [103.8 + i * 0.001, 1.35 + i * 0.001]);
