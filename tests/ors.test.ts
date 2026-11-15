import { describe, expect, it } from 'vitest';
import { orsOptimizer, orsRouter } from '../src/providers/ors';

const p = (lat: number, lng: number) => ({ lat, lng });

describe('openrouteservice adapters', () => {
  it('matrix sends only coordinates and replaces unreachable (null) cells', async () => {
    const sent: unknown[] = [];
    const r = orsRouter({ baseUrl: 'https://w', postJson: async (u, b) => { sent.push([u, b]); return { durations: [[0, null], [5, 0]], distances: [[0, 9], [9, 0]] }; } });
    const m = await r.matrix([p(1.3, 103.8), p(1.31, 103.81)]);
    expect(sent[0]).toEqual(['https://w/ors/v2/matrix/driving-car', { locations: [[103.8, 1.3], [103.81, 1.31]], metrics: ['duration', 'distance'] }]);
    expect(m.durations[0]![1]).toBe(1e7);
  });

  it('VROOM request has no deadlines as hard windows; response steps map back to point order', async () => {
    let body: { jobs: { id: number; time_windows?: unknown }[]; vehicles: { end?: unknown }[] } | undefined;
    const o = orsOptimizer({ baseUrl: 'https://w', postJson: async (_u, b) => {
      body = b as typeof body;
      return { routes: [{ steps: [{ type: 'start' }, { type: 'job', job: 3 }, { type: 'job', job: 2 }, { type: 'end' }] }] };
    } });
    const r = await o.optimize({ points: [p(1, 1), p(1, 2), p(1, 3)], start: 0, end: 0, serviceSec: [0, 60, 60], deadlineSec: [null, 100, null], locked: [] });
    expect(r.order).toEqual([0, 2, 1]);
    expect(body?.jobs.some((j) => j.time_windows)).toBe(false);
    expect(body?.vehicles[0]?.end).toEqual([1, 1]);
  });

  it('refuses locked stops and unassigned results so the planner falls back', async () => {
    const o = orsOptimizer({ baseUrl: 'https://w', postJson: async () => ({ routes: [], unassigned: [{ id: 2 }] }) });
    const j = { points: [p(1, 1), p(1, 2)], start: 0, end: null, serviceSec: [0, 0], deadlineSec: [null, null], locked: [] };
    await expect(o.optimize({ ...j, locked: [1] })).rejects.toThrow();
    await expect(o.optimize(j)).rejects.toThrow();
  });
});
