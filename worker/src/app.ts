import { admin } from './admin';
import { community, json, readJson } from './community';
import { allowedOrigin, preflight, withCors } from './cors';
import type { Env, Platform } from './env';
import { guardOneMapSearch, guardOrs, guardOverpass, orsRouteOf, Reject } from './guard';
import { memoryLimiter } from './limiter';
import { createProxy } from './proxy';
import { settingsLoader } from './settings';

const dayOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

export function createApp(p: Platform) {
  const proxy = createProxy(p);
  const settings = settingsLoader(p.now);
  const general = memoryLimiter(90, 60_000, p.now);
  const heavy = memoryLimiter(10, 60_000, p.now);
  const writes = memoryLimiter(20, 60_000, p.now);
  const adminLimit = memoryLimiter(20, 60_000, p.now);
  const tooMany = (): Response => json({ error: 'rate-limited' }, 429, { 'retry-after': '60' });

  async function route(req: Request, env: Env, ip: string): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    const db = p.db(env);
    const s = await settings(env, db);
    const off = (group: string): boolean => s.kill.has(group);
    const disabled = (): Response => json({ error: 'disabled' }, 503);

    if (path === '/health') return json({ ok: true });

    if (path === '/config') {
      return json({
        providers: {
          geocode: !off('onemap') && Boolean(env.ONEMAP_EMAIL && env.ONEMAP_PASSWORD),
          mapData: !off('overpass'),
          route: !off('ors') && Boolean(env.ORS_API_KEY),
          community: !off('community') && db !== null,
        },
        banner: s.banner,
      }, 200, { 'cache-control': 'public, max-age=60' });
    }

    if (req.method === 'GET' && path === '/onemap/api/common/elastic/search') {
      if (off('onemap')) return disabled();
      return proxy.oneMapSearch(env, guardOneMapSearch(url));
    }

    if (req.method === 'POST' && path === '/overpass') {
      if (off('overpass')) return disabled();
      return proxy.overpass(env, guardOverpass(await req.text()));
    }

    if (req.method === 'POST' && path.startsWith('/ors/')) {
      const r = orsRouteOf(path);
      if (!r) throw new Reject(404, 'not-found');
      if (off('ors')) return disabled();
      const body = await readJson(req, 16_384);
      guardOrs(r, body);
      if (!(await heavy.limit({ key: ip })).success) return tooMany();
      if (db) {
        const n = await db.bump('ors', dayOf(p.now())).catch(() => 0);
        if (n > s.orsDailyCap) return json({ error: 'ors-quota', cap: s.orsDailyCap }, 429, { 'retry-after': '3600' });
      }
      return proxy.ors(env, path, body);
    }

    if (path.startsWith('/community/')) {
      if (off('community') || !db) return disabled();
      if (req.method === 'POST' && !(await (env.RL_WRITE ?? writes).limit({ key: ip })).success) return tooMany();
      const res = await community(req, url, { db, ip, salt: env.HASH_SALT, now: p.now() });
      if (res) return res;
    }

    if (path.startsWith('/admin/')) {
      if (!db || !env.ADMIN_TOKEN) throw new Reject(404, 'not-found');
      if (!(await adminLimit.limit({ key: ip })).success) return tooMany();
      const res = await admin(req, url, env, db, dayOf(p.now()), s.orsDailyCap);
      if (res) return res;
    }

    throw new Reject(404, 'not-found');
  }

  return {
    async fetch(req: Request, env: Env): Promise<Response> {
      const origin = allowedOrigin(req.headers.get('origin'), env.ALLOWED_ORIGINS);
      if (req.method === 'OPTIONS') return preflight(origin);
      const ip = req.headers.get('cf-connecting-ip') ?? 'unknown';
      try {
        if (!(await (env.RL ?? general).limit({ key: ip })).success) return withCors(tooMany(), origin);
        return withCors(await route(req, env, ip), origin);
      } catch (e) {
        if (e instanceof Reject) return withCors(json({ error: e.code }, e.status), origin);
        // Never echo internals or request content.
        return withCors(json({ error: 'internal' }, 500), origin);
      }
    },

    /** Daily cron: keeps the free Supabase project awake with a real query, and purges old data. */
    async scheduled(env: Env): Promise<void> {
      const db = p.db(env);
      if (!db) return;
      await db.ping();
      const day = 86_400_000;
      await db.purge({
        reportsBefore: new Date(p.now() - 90 * day).toISOString(),
        feedbackBefore: new Date(p.now() - 180 * day).toISOString(),
      });
    },
  };
}
