import { createApp } from './app';
import { supabaseDb } from './db-supabase';
import type { Env, Platform } from './env';

const edgeCache = (): Platform['cache'] => (globalThis as unknown as { caches: { default: Platform['cache'] } }).caches.default;

let app: ReturnType<typeof createApp> | undefined;
const get = (): ReturnType<typeof createApp> => {
  app ??= createApp({
    fetch: (...a) => fetch(...a),
    cache: edgeCache(),
    now: () => Date.now(),
    db: (env: Env) => (env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY ? supabaseDb(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, (...a) => fetch(...a)) : null),
  });
  return app;
};

export default {
  fetch: (req: Request, env: Env): Promise<Response> => get().fetch(req, env),
  scheduled: (_e: unknown, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }): void => {
    ctx.waitUntil(get().scheduled(env));
  },
};
