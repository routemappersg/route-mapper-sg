import { describe, expect, it } from 'vitest';
import type { Place, Stop } from '../src/domain/types';
import { straightLineMatrix } from '../src/optimize/evaluate';
import { solve } from '../src/optimize/heuristic';
import { buildJob, clock, DEFAULT_SETTINGS, moveStop, optimizeInputs, orderFromResult, schedule, toggleLock, type Run } from '../src/review/model';
import { offset } from '../src/resolve/geo';

const B = { lat: 1.35, lng: 103.82 };
const mk = (k: number, extra: Partial<Stop> = {}, gated = false): Run['items'][number] => ({
  stop: { id: `s${k}`, status: 'pending', flags: [], ...extra },
  place: { position: offset(B, k * 1500, (k % 2) * 800), gated, confidence: 'map-data' } as Place,
  locked: false,
});
const run = (n = 6, extra: Partial<Run> = {}): Run => ({
  depot: B, items: Array.from({ length: n }, (_, i) => mk(i + 1)), settings: DEFAULT_SETTINGS, order: Array.from({ length: n }, (_, i) => i), ...extra,
});
const matrixOf = (r: Run) => straightLineMatrix(buildJob(r).points);

describe('review model', () => {
  it('builds a job: depot first, gated stops get the registration allowance, deadlines are relative to departure', () => {
    const r = run(3);
    r.items[1] = mk(2, { deadlineMin: 10 * 60 }, true);
    const j = buildJob(r);
    expect(j.points).toHaveLength(4);
    expect(j.serviceSec).toEqual([0, 180, 360, 180]);
    expect(j.deadlineSec[2]).toBe(3600);
    expect(j.end).toBeNull();
    expect(buildJob(run(3, { settings: { ...DEFAULT_SETTINGS, end: 'round' } })).end).toBe(0);
  });

  it('schedules arrivals from the departure time and the cached matrix', () => {
    const r = run(4);
    const s = schedule(r, matrixOf(r));
    expect(s.rows.map((x) => x.n)).toEqual([1, 2, 3, 4]);
    expect(s.rows[0]!.arriveMin).toBeGreaterThan(DEFAULT_SETTINGS.startMin);
    for (let i = 1; i < 4; i++) expect(s.rows[i]!.arriveMin).toBeGreaterThan(s.rows[i - 1]!.arriveMin + 3);
    expect(s.finishMin).toBeGreaterThanOrEqual(s.rows[3]!.arriveMin);
  });

  it('flags a stop that arrives after its deadline', () => {
    const r = run(3);
    r.items[2] = mk(3, { deadlineMin: DEFAULT_SETTINGS.startMin + 5 });
    expect(schedule(r, matrixOf(r)).lateCount).toBe(1);
  });

  it('dragging recalculates times with no provider call (same cached matrix)', () => {
    const r = run(5);
    const m = matrixOf(r);
    const before = schedule(r, m);
    const moved = { ...r, order: moveStop(r, 0, 3) };
    expect(moved.order).toEqual([1, 2, 3, 0, 4]);
    expect(schedule(moved, m).totalMin).not.toBeCloseTo(before.totalMin, 3);
  });

  it('locked stops keep their slot and cannot be dragged', () => {
    let r = run(6);
    r = toggleLock(r, 2); // item index 2 sits in slot 2
    expect(moveStop(r, 2, 5)).toEqual(r.order);
    const out = moveStop(r, 0, 4);
    expect(out[2]).toBe(2);
    expect([...out].sort()).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('optimizer honours locks even when the visit order is not the item order', () => {
    // Start from a scrambled visit order, lock the stop that sits in slot 4, then optimize.
    let r = run(8, { order: [5, 2, 7, 0, 3, 6, 1, 4] });
    const lockedItem = r.order[3]!; // visit position 4 (slot 4 with the depot at 0)
    r = toggleLock(r, lockedItem);
    const m = matrixOf(r);
    const inp = optimizeInputs(r, m);
    expect(inp.job.locked).toEqual([4]);
    const res = solve(inp.job, inp.matrix);
    const newOrder = orderFromResult(inp, res.order);
    expect(newOrder[3]).toBe(lockedItem);
    expect([...newOrder].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    // and the permuted matrix really is the same geography: the schedule of the result is not worse
    expect(schedule({ ...r, order: newOrder }, m).totalMin).toBeLessThanOrEqual(schedule(r, m).totalMin + 1e-6);
  });

  it('formats clock times', () => {
    expect(clock(9 * 60 + 5)).toBe('09:05');
    expect(clock(24 * 60 + 10)).toBe('00:10');
  });
});
