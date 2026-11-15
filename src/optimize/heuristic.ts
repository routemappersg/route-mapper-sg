/**
 * In-browser optimizer: nearest neighbour start, then local search (2-opt reversal,
 * Or-opt segment moves, swaps) over the stops that are free to move. Locked stops keep
 * their slot. Deadlines are soft (cost, not constraint). Runs offline; no network.
 */
import type { OptimizeJob, OptimizeResult, Optimizer, TimeMatrix } from '../providers/types';
import { evaluate, straightLineMatrix } from './evaluate';

export interface HeuristicOptions {
  /** Stop improving after this many ms (keeps 50-stop runs responsive on a mid-range phone). */
  budgetMs?: number;
}

function slots(job: OptimizeJob): { fixed: Map<number, number>; length: number } {
  const n = job.points.length;
  const fixed = new Map<number, number>(); // slot -> point index
  fixed.set(0, job.start);
  const fixedEnd = job.end !== null && job.end !== job.start;
  if (fixedEnd) fixed.set(n - 1, job.end!);
  for (const i of job.locked) {
    if (i === job.start || (fixedEnd && i === job.end)) continue;
    fixed.set(i, i);
  }
  return { fixed, length: n };
}

function assemble(fixed: Map<number, number>, length: number, free: number[]): number[] {
  const order: number[] = [];
  let k = 0;
  for (let s = 0; s < length; s++) order.push(fixed.get(s) ?? free[k++]!);
  return order;
}

export function solve(job: OptimizeJob, matrix: TimeMatrix, opts: HeuristicOptions = {}): OptimizeResult {
  const budget = opts.budgetMs ?? 1500;
  const t0 = Date.now();
  const { fixed, length } = slots(job);
  const fixedPts = new Set(fixed.values());
  const pool = job.points.map((_, i) => i).filter((i) => !fixedPts.has(i));

  // Nearest neighbour, walking the slots in order.
  const free: number[] = [];
  const left = new Set(pool);
  let prev = job.start;
  for (let s = 1; s < length; s++) {
    const f = fixed.get(s);
    if (f !== undefined) { prev = f; continue; }
    let best = -1;
    let bestD = Infinity;
    for (const c of left) {
      const d = matrix.durations[prev]![c]!;
      if (d < bestD) { bestD = d; best = c; }
    }
    if (best < 0) break;
    left.delete(best);
    free.push(best);
    prev = best;
  }

  const cost = (f: number[]): number => evaluate(job, matrix, assemble(fixed, length, f)).cost;
  let bestCost = cost(free);
  const m = free.length;
  let improved = true;
  while (improved && Date.now() - t0 < budget) {
    improved = false;
    // 2-opt: reverse free[i..j]
    for (let i = 0; i < m - 1 && !improved; i++) {
      for (let j = i + 1; j < m; j++) {
        const cand = [...free.slice(0, i), ...free.slice(i, j + 1).reverse(), ...free.slice(j + 1)];
        const c = cost(cand);
        if (c < bestCost - 1e-6) { free.splice(0, m, ...cand); bestCost = c; improved = true; break; }
      }
    }
    // Or-opt: move a segment of 1-3 stops elsewhere
    for (let len = 1; len <= 3 && !improved; len++) {
      for (let i = 0; i + len <= m && !improved; i++) {
        const seg = free.slice(i, i + len);
        const rest = [...free.slice(0, i), ...free.slice(i + len)];
        for (let k = 0; k <= rest.length; k++) {
          if (k === i) continue;
          const cand = [...rest.slice(0, k), ...seg, ...rest.slice(k)];
          const c = cost(cand);
          if (c < bestCost - 1e-6) { free.splice(0, m, ...cand); bestCost = c; improved = true; break; }
        }
      }
    }
    // Swap any two
    for (let i = 0; i < m - 1 && !improved; i++) {
      for (let j = i + 1; j < m; j++) {
        const cand = [...free];
        [cand[i], cand[j]] = [cand[j]!, cand[i]!];
        const c = cost(cand);
        if (c < bestCost - 1e-6) { free.splice(0, m, ...cand); bestCost = c; improved = true; break; }
      }
    }
  }
  const { cost: _c, ...result } = evaluate(job, matrix, assemble(fixed, length, free));
  void _c;
  return result;
}

export function heuristicOptimizer(opts: HeuristicOptions = {}): Optimizer {
  return {
    id: 'in-browser',
    async optimize(job) {
      return solve(job, job.matrix ?? straightLineMatrix(job.points), opts);
    },
  };
}
