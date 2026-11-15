import type { OptimizeJob, OptimizeResult, Optimizer, Router, TimeMatrix } from '../providers/types';
import { evaluate, straightLineMatrix } from './evaluate';
import { solve } from './heuristic';
import { findOutliers, type OutlierReport } from './outliers';
import { MAX_STOPS_PER_RUN } from './split';

export type PlanNotice = 'matrix-estimated' | 'optimizer-fallback' | 'split-suggested' | 'deadlines-missed';

export interface Plan extends OptimizeResult {
  engine: string;
  matrix: TimeMatrix;
  notices: PlanNotice[];
  outliers: OutlierReport;
}

export interface PlanDeps {
  router?: Router;
  hosted?: Optimizer;
  budgetMs?: number;
}

/**
 * Plan a run. One road-matrix call (re-used for every later drag or re-plan); hosted VROOM
 * when available; the in-browser optimizer always runs too and the better plan wins, so a
 * provider outage or quota limit never stops planning.
 */
export async function planRoute(job: OptimizeJob, deps: PlanDeps = {}): Promise<Plan> {
  const notices: PlanNotice[] = [];
  let matrix = job.matrix;
  if (!matrix) {
    try {
      if (!deps.router) throw new Error('no router');
      matrix = await deps.router.matrix(job.points);
    } catch {
      matrix = straightLineMatrix(job.points);
      notices.push('matrix-estimated');
    }
  }
  if (job.points.length - 1 > MAX_STOPS_PER_RUN) notices.push('split-suggested');

  let best = evaluate(job, matrix, solve(job, matrix, { budgetMs: deps.budgetMs }).order);
  let engine = 'in-browser';
  if (deps.hosted) {
    try {
      const hosted = evaluate(job, matrix, (await deps.hosted.optimize({ ...job, matrix })).order);
      if (hosted.cost < best.cost) { best = hosted; engine = deps.hosted.id; }
    } catch {
      notices.push('optimizer-fallback');
    }
  }
  const { cost: _cost, ...result } = best;
  void _cost;
  if (result.lateBySec.some((s) => s > 0)) notices.push('deadlines-missed');
  return { ...result, engine, matrix, notices, outliers: findOutliers(job, matrix, result) };
}
