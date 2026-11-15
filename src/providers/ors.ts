/**
 * openrouteservice (HeiGIT): road matrix, route geometry and VROOM optimization.
 * Called through our Worker, which holds the API key. Only coordinates are sent.
 * Free tier is small and shared, so the app makes ONE matrix call per plan and re-uses it.
 */
import type { LatLng } from '../domain/types';
import type { Optimizer, Router } from './types';

type PostJson = (url: string, body: unknown) => Promise<unknown>;
const ll = (p: LatLng): [number, number] => [p.lng, p.lat];

export function orsRouter(opts: { baseUrl: string; postJson: PostJson }): Router {
  return {
    id: 'ors',
    async matrix(points) {
      const r = (await opts.postJson(`${opts.baseUrl}/ors/v2/matrix/driving-car`, {
        locations: points.map(ll), metrics: ['duration', 'distance'],
      })) as { durations?: (number | null)[][]; distances?: (number | null)[][] };
      if (!r.durations || !r.distances) throw new Error('ORS matrix: empty response');
      const fix = (m: (number | null)[][]): number[][] => m.map((row) => row.map((v) => (v === null ? 1e7 : v)));
      return { durations: fix(r.durations), distances: fix(r.distances) };
    },
    async path(points) {
      const r = (await opts.postJson(`${opts.baseUrl}/ors/v2/directions/driving-car/geojson`, {
        coordinates: points.map(ll),
      })) as { features?: { geometry?: { coordinates?: [number, number][] } }[] };
      return (r.features?.[0]?.geometry?.coordinates ?? []).map(([lng, lat]) => ({ lat, lng }));
    },
  };
}

/** VROOM via ORS. Deadlines are soft in this app, so they are scored locally, not sent as hard windows. */
export function orsOptimizer(opts: { baseUrl: string; postJson: PostJson }): Optimizer {
  return {
    id: 'ors-vroom',
    async optimize(job) {
      if (job.locked.length) throw new Error('Locked stops: use the in-browser optimizer');
      const fixedEnd = job.end !== null && job.end !== job.start;
      const jobs = job.points
        .map((p, i) => ({ i, p }))
        .filter(({ i }) => i !== job.start && !(fixedEnd && i === job.end))
        .map(({ i, p }) => ({ id: i + 1, location: ll(p), service: Math.round(job.serviceSec[i] ?? 0) }));
      const vehicle: Record<string, unknown> = { id: 1, profile: 'driving-car', start: ll(job.points[job.start]!) };
      if (job.end !== null) vehicle.end = ll(job.points[job.end]!);
      const r = (await opts.postJson(`${opts.baseUrl}/ors/optimization`, { jobs, vehicles: [vehicle] })) as {
        routes?: { steps: { type: string; job?: number }[] }[];
        unassigned?: unknown[];
      };
      if (r.unassigned?.length) throw new Error('VROOM left stops unassigned');
      const steps = r.routes?.[0]?.steps ?? [];
      const order = [job.start, ...steps.filter((s) => s.type === 'job' && s.job).map((s) => s.job! - 1)];
      if (fixedEnd) order.push(job.end!);
      if (order.length !== job.points.length) throw new Error('VROOM returned an incomplete route');
      // Times are recomputed by the planner on its own matrix so every engine is scored the same way.
      return { order, etaSec: [], lateBySec: [], totalSec: 0, totalMeters: 0 };
    },
  };
}
