import type { Db } from './db';
import type { Env } from './env';

export interface Settings {
  /** Provider groups switched off: onemap, overpass, ors, community. */
  kill: Set<string>;
  banner: string | null;
  orsDailyCap: number;
}

const TTL_MS = 60_000;

/** Runtime switches: Ali can turn a provider off (the app then falls back) without a deploy. Cached for a minute. */
export function settingsLoader(now: () => number): (env: Env, db: Db | null) => Promise<Settings> {
  let memo: { at: number; value: Settings } | null = null;
  return async (env, db) => {
    if (memo && now() - memo.at < TTL_MS) return memo.value;
    const kill = new Set((env.KILL ?? '').split(',').map((s) => s.trim()).filter(Boolean));
    let banner: string | null = null;
    let cap = Number(env.ORS_DAILY_CAP) || 400;
    if (db) {
      try {
        for (const k of ((await db.getSetting('kill')) ?? '').split(',').map((s) => s.trim()).filter(Boolean)) kill.add(k);
        banner = (await db.getSetting('banner')) || null;
        const c = Number(await db.getSetting('orsDailyCap'));
        if (c > 0) cap = c;
      } catch { /* database unreachable: keep env-only settings */ }
    }
    memo = { at: now(), value: { kill, banner, orsDailyCap: cap } };
    return memo.value;
  };
}
