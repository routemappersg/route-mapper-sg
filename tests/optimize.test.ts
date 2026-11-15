import { describe, expect, it } from 'vitest';
import type { LatLng } from '../src/domain/types';
import type { OptimizeJob, Optimizer, Router, TimeMatrix } from '../src/providers/types';
import { evaluate, straightLineMatrix } from '../src/optimize/evaluate';
import { solve } from '../src/optimize/heuristic';
import { planRoute } from '../src/optimize/plan';
import { splitRuns } from '../src/optimize/split';
import { offset } from '../src/resolve/geo';

const BASE: LatLng = { lat: 1.35, lng: 103.82 };
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}
const randomPoints = (n: number, seed: number, spanM = 20000): LatLng[] => {
  const r = rng(seed);
  return Array.from({ length: n }, () => offset(BASE, (r() - 0.5) * spanM, (r() - 0.5) * spanM));
};
const job = (points: LatLng[], extra: Partial<OptimizeJob> = {}): OptimizeJob => ({
  points, start: 0, end: null, serviceSec: points.map((_, i) => (i ? 180 : 0)),
  deadlineSec: points.map(() => null), locked: [], ...extra,
});

function bruteForce(j: OptimizeJob, m: TimeMatrix): number {
  const free = j.points.map((_, i) => i).filter((i) => i !== j.start && !(j.end !== null && j.end !== j.start && i === j.end));
  let best = Infinity;
  const perm = (rest: number[], acc: number[]): void => {
    if (!rest.length) {
      const order = [j.start, ...acc, ...(j.end !== null && j.end !== j.start ? [j.end] : [])];
      best = Math.min(best, evaluate(j, m, order).cost);
      return;
    }
    rest.forEach((x, k) => perm([...rest.slice(0, k), ...rest.slice(k + 1)], [...acc, x]));
  };
  perm(free, []);
  return best;
}

describe('in-browser optimizer quality', () => {
  it('is within 5% of the true optimum on 30 random small runs (all end modes)', () => {
    const modes: (number | null)[] = [null, 0, 7];
    let worst = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const pts = randomPoints(8, seed);
      const j = job(pts, { end: modes[seed % 3]! });
      const m = straightLineMatrix(pts);
      const got = evaluate(j, m, solve(j, m).order).cost;
      const opt = bruteForce(j, m);
      worst = Math.max(worst, got / opt - 1);
    }
    expect(worst).toBeLessThanOrEqual(0.05);
  });

  it('plans 50 stops quickly', () => {
    const pts = randomPoints(51, 99);
    const t0 = Date.now();
    const r = solve(job(pts), straightLineMatrix(pts), { budgetMs: 1500 });
    expect(Date.now() - t0).toBeLessThan(2500);
    expect(new Set(r.order).size).toBe(51);
  });
});

describe('constraints', () => {
  it('keeps locked stops in their slot and every stop exactly once', () => {
    const pts = randomPoints(12, 5);
    const r = solve(job(pts, { locked: [3, 8] }), straightLineMatrix(pts));
    expect(r.order[3]).toBe(3);
    expect(r.order[8]).toBe(8);
    expect([...r.order].sort((a, b) => a - b)).toEqual(pts.map((_, i) => i));
  });

  it('fixed end point is last; round trip returns to start', () => {
    const pts = randomPoints(9, 6);
    const m = straightLineMatrix(pts);
    expect(solve(job(pts, { end: 4 }), m).order.at(-1)).toBe(4);
    const rt = solve(job(pts, { end: 0 }), m);
    expect(rt.order[0]).toBe(0);
    expect(rt.totalSec).toBeGreaterThan(evaluate(job(pts), m, rt.order).totalSec);
  });

  it('reorders to meet a deadline even when that makes the drive longer', () => {
    // Stops 1-5 east; stop 6 is 6 km west and due in 20 min. Shortest drive goes east first
    // and misses it; respecting the deadline means going west first.
    const pts = [BASE, ...[1, 2, 3, 4, 5].map((k) => offset(BASE, k * 1000, 0)), offset(BASE, -6000, 0)];
    const m = straightLineMatrix(pts);
    const plain = solve(job(pts), m);
    expect(plain.order[1]).not.toBe(6); // sanity: without the deadline, west is not first
    const r = solve(job(pts, { deadlineSec: pts.map((_, i) => (i === 6 ? 1200 : null)) }), m);
    expect(r.order[1]).toBe(6);
    expect(r.lateBySec[6]).toBe(0);
  });

  it('an impossible deadline is reported late, never blocks the plan', () => {
    const pts = randomPoints(6, 7);
    const r = solve(job(pts, { deadlineSec: pts.map((_, i) => (i === 3 ? 1 : null)) }), straightLineMatrix(pts));
    expect(r.order).toHaveLength(6);
    expect(r.lateBySec[3]).toBeGreaterThan(0);
  });
});

describe('planner', () => {
  const pts = randomPoints(10, 11);

  it('falls back to estimated travel times and the in-browser optimizer when providers fail', async () => {
    const down: Router = { id: 'down', matrix: async () => { throw new Error('429'); }, path: async () => [] };
    const hosted: Optimizer = { id: 'ors-vroom', optimize: async () => { throw new Error('timeout'); } };
    const p = await planRoute(job(pts), { router: down, hosted });
    expect(p.engine).toBe('in-browser');
    expect(p.notices).toEqual(expect.arrayContaining(['matrix-estimated', 'optimizer-fallback']));
    expect(p.order).toHaveLength(10);
  });

  it('uses the hosted plan only when it is better, scored on the same matrix', async () => {
    const reversed: Optimizer = { id: 'ors-vroom', optimize: async (j) => ({ order: [0, ...j.points.map((_, i) => i).slice(1).reverse()], etaSec: [], lateBySec: [], totalSec: 0, totalMeters: 0 }) };
    const p = await planRoute(job(pts), { hosted: reversed });
    expect(p.engine).toBe('in-browser');
  });

  it('suggests splitting above 50 stops', async () => {
    const p = await planRoute(job(randomPoints(55, 3)), { budgetMs: 200 });
    expect(p.notices).toContain('split-suggested');
  });
});

describe('impractical route prompt', () => {
  // Cluster of 8 stops west of the depot; two stops far east, one due early; another
  // western stop also due early. Serving both ends in time is impossible.
  const west = [1, 2, 3, 4, 5, 6, 7, 8].map((k) => offset(BASE, -2000 - k * 300, (k % 3) * 400));
  const farEast1 = offset(BASE, 18000, 1000);
  const farEast2 = offset(BASE, 18500, -800);
  const pts = [BASE, ...west, farEast1, farEast2];
  const deadlines = pts.map((_, i) => (i === 9 ? 20 * 60 : i === 3 ? 25 * 60 : null));

  it('flags the far-off stops as the outliers to hand to a courier', async () => {
    const p = await planRoute(job(pts, { deadlineSec: deadlines }));
    expect(p.outliers.impractical).toBe(true);
    const picked = p.outliers.singles.map((s) => s.stops[0]);
    expect(picked).toContain(9);
    expect(picked.every((i) => i === 9 || i === 10)).toBe(true);
    expect([...(p.outliers.pair?.stops ?? [])].sort()).toEqual([10, 9].sort());
    expect(p.outliers.pair!.savedSec).toBeGreaterThan(p.outliers.singles[0]!.savedSec);
    expect(p.outliers.singles[0]!.savedSec + p.outliers.singles[0]!.deadlinesRescued).toBeGreaterThan(0);
    expect(p.order).toHaveLength(pts.length); // still a full plan
  });

  it('stays quiet for a compact run with no deadline trouble', async () => {
    const p = await planRoute(job([BASE, ...west]));
    expect(p.outliers.impractical).toBe(false);
  });
});

describe('multi-run split', () => {
  it('splits 120 stops into 3 runs of at most 50, each stop once, by direction', () => {
    const stops = randomPoints(120, 21);
    const runs = splitRuns(BASE, stops);
    expect(runs).toHaveLength(3);
    expect(runs.every((r) => r.length <= 50)).toBe(true);
    expect(runs.flat().sort((a, b) => a - b)).toEqual(stops.map((_, i) => i));
  });

  it('does not cut a tight cluster in half when there is an empty sector', () => {
    const north = Array.from({ length: 10 }, (_, k) => offset(BASE, k * 50 - 250, 5000));
    const south = Array.from({ length: 10 }, (_, k) => offset(BASE, k * 50 - 250, -5000));
    const runs = splitRuns(BASE, [...north, ...south], 2);
    const groupOf = (i: number) => runs.findIndex((r) => r.includes(i));
    expect(new Set(north.map((_, i) => groupOf(i))).size).toBe(1);
    expect(new Set(south.map((_, i) => groupOf(i + 10))).size).toBe(1);
  });
});
