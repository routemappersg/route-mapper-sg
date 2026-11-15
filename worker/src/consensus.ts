/**
 * Community auto-accept rule. Nobody logs in, so trust comes from agreement:
 *   - a new gate/pin needs 2 independent submitters within 30 m of each other;
 *   - replacing an existing community record needs 3 who agree with each other (and not with it);
 *   - records set by the owner (source = admin) are never replaced automatically.
 * Submitters are salted hashes, so one person reporting twice counts once.
 */
import { distance } from '../../src/resolve/geo';
import type { GateRow, ReportRow } from './db';

export const AGREE_M = 30;
export const NEW_NEEDS = 2;
export const REPLACE_NEEDS = 3;

export interface Decision {
  lat: number;
  lng: number;
  postals: string[];
  gated: boolean;
  confirmations: number;
  /** The existing record to replace, if any. */
  replaces?: GateRow;
  /** Reports that make up the agreeing cluster: marked accepted. */
  reportIds: string[];
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

export function decide(newest: ReportRow, open: ReportRow[], existing: GateRow[]): Decision | null {
  const overlaps = (a: string[]): boolean => a.some((p) => newest.postals.includes(p));
  const pool = open.filter((r) => r.kind === newest.kind && overlaps(r.postals));
  // Latest report per submitter, so repeating yourself never adds weight.
  const bySubmitter = new Map<string, ReportRow>();
  for (const r of [...pool, newest]) bySubmitter.set(r.submitter, r);
  const near = [...bySubmitter.values()].filter((r) => distance(r, newest) <= AGREE_M);

  const current = existing.filter((g) => g.status === 'verified' && g.postals.some((p) => newest.postals.includes(p)));
  const rec = current[0];
  if (rec?.source === 'admin') return null;
  const lat = median(near.map((r) => r.lat));
  const lng = median(near.map((r) => r.lng));
  if (rec && distance({ lat, lng }, { lat: rec.lat, lng: rec.lng }) <= AGREE_M) return null;
  const needed = rec ? REPLACE_NEEDS : NEW_NEEDS;
  if (near.length < needed) return null;

  const postals = [...new Set(near.flatMap((r) => r.postals))].slice(0, 30);
  return {
    lat, lng, postals, gated: newest.kind === 'gate', confirmations: near.length,
    ...(rec ? { replaces: rec } : {}),
    reportIds: near.map((r) => r.id),
  };
}
