import type { Db } from './db';

/** Cloudflare bindings and secrets. All optional: a missing one disables only the feature that needs it. */
export interface Env {
  /** Comma-separated origins allowed by CORS, e.g. https://routemapper.pages.dev */
  ALLOWED_ORIGINS?: string;
  /** Secrets (wrangler secret put): never in the repo, never in the app. */
  ONEMAP_EMAIL?: string;
  ONEMAP_PASSWORD?: string;
  ORS_API_KEY?: string;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_KEY?: string;
  ADMIN_TOKEN?: string;
  /** Salt for the one-way submitter hash (community submissions). Rotate to unlink old reports. */
  HASH_SALT?: string;
  /** Plain variables */
  OVERPASS_URLS?: string;
  ORS_DAILY_CAP?: string;
  /** Emergency kill-switch without touching the database: "ors,overpass,onemap,community". */
  KILL?: string;
  /** Workers Rate Limiting bindings (optional; an in-memory limiter is used if absent). */
  RL?: RateLimitBinding;
  RL_WRITE?: RateLimitBinding;
}

export interface RateLimitBinding {
  limit(o: { key: string }): Promise<{ success: boolean }>;
}

/** The few platform pieces the Worker needs, injectable so the whole app runs in tests and in Node. */
export interface CacheLike {
  match(req: Request): Promise<Response | undefined>;
  put(req: Request, res: Response): Promise<void>;
}

export interface Platform {
  fetch: typeof fetch;
  cache: CacheLike;
  now: () => number;
  /** Builds the database client for this request's env (null when Supabase is not configured). */
  db: (env: Env) => Db | null;
}
