import type { Stop } from '../domain/types';

/** Dedup key: postal + unit, or block + street + unit when there is no postal. Never the name. */
export function dedupKey(s: Stop): string | null {
  if (!s.unit) return null;
  if (s.postal) return `${s.postal}|${s.unit}`;
  if (s.block && s.street) return `${s.block}|${s.street.toLowerCase()}|${s.unit}`;
  return null;
}

/** Merge duplicates, keeping the first and filling its gaps from later copies. */
export function dedup(stops: Stop[]): { stops: Stop[]; merged: number } {
  const seen = new Map<string, Stop>();
  const out: Stop[] = [];
  let merged = 0;
  for (const s of stops) {
    const key = dedupKey(s);
    const first = key ? seen.get(key) : undefined;
    if (first) {
      merged++;
      for (const k of ['recipient', 'contact', 'note', 'deadlineMin', 'block', 'street'] as const) {
        if (first[k] === undefined && s[k] !== undefined) Object.assign(first, { [k]: s[k] });
      }
      continue;
    }
    if (key) seen.set(key, s);
    out.push(s);
  }
  return { stops: out, merged };
}
