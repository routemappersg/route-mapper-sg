import type { LatLng } from '../domain/types';
import type { OptimizeJob, OptimizeResult, TimeMatrix } from '../providers/types';
import { distance } from '../resolve/geo';

/** Soft deadlines: each second late costs this many seconds of driving. Never forbidden. */
export const LATE_WEIGHT = 10;

/**
 * Rough matrix from straight-line distance, used when no road matrix is available
 * (offline, provider down). Singapore roads average ~1.35x the straight line; 25 km/h urban.
 */
export function straightLineMatrix(points: LatLng[], detour = 1.35, kmh = 25): TimeMatrix {
  const distances = points.map((a) => points.map((b) => distance(a, b) * detour));
  const durations = distances.map((row) => row.map((m) => m / (kmh / 3.6)));
  return { durations, distances };
}

/** Does this job describe a round trip back to the start? */
export const isRoundTrip = (job: OptimizeJob): boolean => job.end === job.start;

/** Time each stop is reached along `order` (which starts at job.start and, for a fixed end, ends at job.end). */
export function evaluate(job: OptimizeJob, matrix: TimeMatrix, order: number[]): OptimizeResult & { cost: number } {
  const n = job.points.length;
  const etaSec = new Array<number>(n).fill(0);
  const lateBySec = new Array<number>(n).fill(0);
  let t = 0;
  let meters = 0;
  let late = 0;
  for (let i = 0; i < order.length; i++) {
    const cur = order[i]!;
    if (i > 0) {
      const prev = order[i - 1]!;
      t += matrix.durations[prev]![cur]!;
      meters += matrix.distances[prev]![cur]!;
    }
    etaSec[cur] = t;
    const dl = job.deadlineSec[cur];
    if (dl !== null && dl !== undefined && t > dl) {
      lateBySec[cur] = t - dl;
      late += t - dl;
    }
    t += job.serviceSec[cur] ?? 0;
  }
  if (isRoundTrip(job) && order.length > 1) {
    const last = order[order.length - 1]!;
    t += matrix.durations[last]![job.start]!;
    meters += matrix.distances[last]![job.start]!;
  }
  return { order, etaSec, lateBySec, totalSec: t, totalMeters: meters, cost: t + LATE_WEIGHT * late };
}
