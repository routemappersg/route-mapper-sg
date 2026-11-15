import type { RateLimitBinding } from './env';

/** Fixed-window limiter in memory: the fallback when no Workers Rate Limiting binding is configured. */
export function memoryLimiter(limit: number, windowMs: number, now: () => number): RateLimitBinding {
  const hits = new Map<string, { start: number; n: number }>();
  return {
    async limit({ key }) {
      const t = now();
      const h = hits.get(key);
      if (!h || t - h.start >= windowMs) {
        hits.set(key, { start: t, n: 1 });
        if (hits.size > 5000) for (const [k, v] of hits) if (t - v.start >= windowMs) hits.delete(k);
        return { success: true };
      }
      h.n++;
      return { success: h.n <= limit };
    },
  };
}
