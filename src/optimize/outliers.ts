/**
 * Impractical-route prompt (decision #24). When deadlines pull stops to opposite ends, find
 * the 1-2 stops whose removal saves the most time and rescues the most deadlines, and suggest
 * a third-party courier for them. Advice only: the plan is always produced.
 * Runs locally on the cached matrix, so it costs no API quota.
 */
import type { OptimizeJob, OptimizeResult, TimeMatrix } from '../providers/types';
import { evaluate, isRoundTrip } from './evaluate';
import { solve } from './heuristic';

/** A rescued deadline is worth this much, in seconds of saved driving. */
const DEADLINE_VALUE_SEC = 30 * 60;
/** Without late stops, only flag a detour this big (absolute and share of the run). */
const MIN_DETOUR_SEC = 20 * 60;
const MIN_DETOUR_SHARE = 0.15;

export interface OutlierSuggestion {
  /** Indices into job.points. */
  stops: number[];
  /** Driving time saved by handing these to a courier. */
  savedSec: number;
  /** Deadlines (other stops' and their own) that would then be met. */
  deadlinesRescued: number;
}

export interface OutlierReport {
  impractical: boolean;
  /** Ranked single-stop suggestions (max 2), then the pair together if it helps more. */
  singles: OutlierSuggestion[];
  pair: OutlierSuggestion | null;
}

function without(job: OptimizeJob, matrix: TimeMatrix, drop: number[]): { job: OptimizeJob; matrix: TimeMatrix; map: number[] } {
  const keep = job.points.map((_, i) => i).filter((i) => !drop.includes(i));
  const pos = new Map(keep.map((orig, k) => [orig, k]));
  const pick = <T>(rows: T[][]): T[][] => keep.map((i) => keep.map((j) => rows[i]![j]!));
  return {
    map: keep,
    matrix: { durations: pick(matrix.durations), distances: pick(matrix.distances) },
    job: {
      ...job,
      points: keep.map((i) => job.points[i]!),
      start: pos.get(job.start)!,
      end: job.end === null ? null : pos.get(job.end)!,
      serviceSec: keep.map((i) => job.serviceSec[i] ?? 0),
      deadlineSec: keep.map((i) => job.deadlineSec[i] ?? null),
      locked: [], // slots shift when stops are removed; locks are ignored for this estimate
    },
  };
}

function score(job: OptimizeJob, matrix: TimeMatrix, base: OptimizeResult, drop: number[], budgetMs: number): OutlierSuggestion {
  const w = without(job, matrix, drop);
  const r = solve(w.job, w.matrix, { budgetMs });
  const service = drop.reduce((s, i) => s + (job.serviceSec[i] ?? 0), 0);
  const savedSec = Math.max(0, base.totalSec - r.totalSec - service);
  let rescued = drop.filter((i) => (base.lateBySec[i] ?? 0) > 0).length;
  w.map.forEach((orig, k) => {
    if ((base.lateBySec[orig] ?? 0) > 0 && (r.lateBySec[k] ?? 0) === 0) rescued++;
  });
  return { stops: drop, savedSec, deadlinesRescued: rescued };
}

const value = (s: OutlierSuggestion): number => s.savedSec + s.deadlinesRescued * DEADLINE_VALUE_SEC;

export function findOutliers(job: OptimizeJob, matrix: TimeMatrix, base: OptimizeResult): OutlierReport {
  const fixedEnd = job.end !== null && !isRoundTrip(job) ? job.end : -1;
  const candidates = base.order.filter((i) => i !== job.start && i !== fixedEnd && !job.locked.includes(i));
  if (candidates.length < 3) return { impractical: false, singles: [], pair: null };

  // Cheap screen: drop each stop from the current order (no re-optimizing) and see how much
  // the cost falls. Cost already counts lateness, so deadline relief shows up here.
  const baseCost = evaluate(job, matrix, base.order).cost;
  const screened = candidates
    .map((c) => ({ c, gain: baseCost - evaluate(job, matrix, base.order.filter((i) => i !== c)).cost - (job.serviceSec[c] ?? 0) }))
    .sort((a, b) => b.gain - a.gain)
    .slice(0, 4);

  // Accurate re-optimized numbers for the shortlist.
  const singles = screened.map(({ c }) => score(job, matrix, base, [c], 300)).sort((a, b) => value(b) - value(a));
  const anyLate = base.lateBySec.some((s) => s > 0);
  const big = (s: OutlierSuggestion): boolean =>
    s.deadlinesRescued > 0 || (s.savedSec >= MIN_DETOUR_SEC && s.savedSec >= MIN_DETOUR_SHARE * base.totalSec);
  const top = singles.filter(big).slice(0, 2);
  const impractical = top.length > 0 && (anyLate || top.some((s) => s.savedSec >= MIN_DETOUR_SEC));
  if (!impractical) return { impractical: false, singles: [], pair: null };

  // Outliers often come in pairs (two stops in the same far-off area): try the top stop
  // together with each other shortlisted stop, and offer the pair if it is clearly better.
  let pair: OutlierSuggestion | null = null;
  const lead = top[0]!;
  for (const { c } of screened) {
    if (c === lead.stops[0]) continue;
    const p = score(job, matrix, base, [lead.stops[0]!, c], 300);
    if (value(p) > value(lead) * 1.25 && (!pair || value(p) > value(pair))) pair = p;
  }
  return { impractical, singles: top, pair };
}
