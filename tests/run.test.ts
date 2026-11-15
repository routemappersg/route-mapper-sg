import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import type { Place } from '../src/domain/types';
import { straightLineMatrix } from '../src/optimize/evaluate';
import { solve } from '../src/optimize/heuristic';
import { offset } from '../src/resolve/geo';
import { buildJob, DEFAULT_SETTINGS, type Run } from '../src/review/model';
import {
  applyRemainingOrder, counts, currentIndex, finish, navUrl, nextIndex, position, remaining, remainingRun,
  remainingSchedule, retry, skip, sgNumber, startRun, telHref, undoLast, whatsappHref, type ActiveRun,
} from '../src/run/model';
import { clearRun, loadNavApp, loadRun, RUN_RETENTION_MS, saveNavApp, saveRun } from '../src/run/runStore';
import { idbStore } from '../src/providers/idbStore';

const B = { lat: 1.35, lng: 103.82 };
const mkRun = (n = 6): Run => ({
  depot: B,
  items: Array.from({ length: n }, (_, i) => ({
    stop: { id: `s${i + 1}`, status: 'pending' as const, flags: [], unit: `#0${i + 1}-1${i}`, recipient: `Person ${i + 1}`, contact: '91234567' },
    place: { position: offset(B, (i + 1) * 1500, (i % 2) * 900), gated: false, confidence: 'map-data' } as Place,
    locked: false,
  })),
  settings: DEFAULT_SETTINGS,
  order: Array.from({ length: n }, (_, i) => i),
});
const start = (n = 6): ActiveRun => {
  const r = mkRun(n);
  return startRun(r, straightLineMatrix(buildJob(r).points));
};

describe('run mode state', () => {
  it('starts on the first stop with a fixed plan baseline', () => {
    const a = start();
    expect(currentIndex(a)).toBe(0);
    expect(nextIndex(a)).toBe(1);
    expect(Object.keys(a.planned)).toHaveLength(6);
    expect(position(a)).toEqual(B);
  });

  it('delivering out of order moves the stop into the done list and keeps the rest in order', () => {
    let a = start();
    a = finish(a, 3, 'delivered', 600);
    expect(a.run.order).toEqual([3, 0, 1, 2, 4, 5]);
    expect(remaining(a)).toEqual([0, 1, 2, 4, 5]);
    expect(currentIndex(a)).toBe(0);
    expect(position(a)).toEqual(a.run.items[3]!.place.position);
    expect(a.run.items[3]!.stop.status).toBe('delivered');
    expect(counts(a)).toEqual({ delivered: 1, failed: 0, skipped: 0, pending: 5 });
  });

  it('skip sends the stop to the end, never drops it, and it comes back when nothing else is pending', () => {
    let a = start(3);
    a = skip(a, 0);
    expect(remaining(a)).toEqual([1, 2, 0]);
    expect(currentIndex(a)).toBe(1);
    a = finish(a, 1, 'delivered', 600);
    a = finish(a, 2, 'failed', 610, 'no one home');
    expect(currentIndex(a)).toBe(0); // the skipped stop is revisited
    expect(a.run.items[0]!.stop.status).toBe('skipped');
    expect(a.log['s3']).toEqual({ atMin: 610, note: 'no one home' });
    expect(counts(a).skipped + counts(a).delivered + counts(a).failed).toBe(3);
  });

  it('undo makes the last stop current again; retry puts a failed stop back at the end', () => {
    let a = start(4);
    a = finish(a, 0, 'delivered', 600);
    a = finish(a, 1, 'failed', 610);
    a = undoLast(a);
    expect(currentIndex(a)).toBe(1);
    expect(a.run.items[1]!.stop.status).toBe('pending');
    expect(a.log['s2']).toBeUndefined();
    a = finish(a, 1, 'failed', 612);
    a = retry(a, 1);
    expect(remaining(a)).toEqual([2, 3, 1]);
    expect(a.run.items[1]!.stop.status).toBe('pending');
    expect(a.doneOrder).toEqual([0]);
  });

  it('finishing the same stop twice changes nothing', () => {
    let a = start(3);
    a = finish(a, 0, 'delivered', 600);
    expect(finish(a, 0, 'failed', 601)).toBe(a);
  });
});

describe('plan baseline', () => {
  const at = (h: number, m: number): number => new Date(2026, 10, 15, h, m).getTime();
  it('a late start measures drift from now, not from the planned 09:00', () => {
    const r = mkRun(4);
    const m = straightLineMatrix(buildJob(r).points);
    const late = startRun(r, m, {}, at(18, 0));
    expect(late.run.settings.startMin).toBe(18 * 60);
    expect(Math.min(...Object.values(late.planned))).toBeGreaterThan(18 * 60);
    // starting early keeps the planned departure
    const early = startRun(r, m, {}, at(8, 40));
    expect(early.run.settings.startMin).toBe(9 * 60);
    expect(Math.min(...Object.values(early.planned))).toBeGreaterThan(9 * 60);
  });
});

describe('re-optimize the remaining stops', () => {
  it('slices the cached matrix: sub-run point 0 is the driver, others are the remaining stops', () => {
    let a = start(5);
    // make the matrix distinctive so a wrong slice is caught
    a = { ...a, matrix: { durations: a.matrix.durations.map((r, i) => r.map((v, j) => v + i * 1000 + j)), distances: a.matrix.distances } };
    a = finish(a, 2, 'delivered', 600);
    a = skip(a, 0);
    const r = remainingRun(a, 620);
    expect(r.itemMap).toEqual([1, 3, 4, 0]);
    const base = [3, 2, 4, 5, 1]; // driver is at item 2 (base index 3); then items 1,3,4,0
    r.matrix.durations.forEach((row, i) => row.forEach((v, j) => expect(v).toBe(a.matrix.durations[base[i]!]![base[j]!])));
    expect(r.run.depot).toEqual(a.run.items[2]!.place.position);
    expect(r.run.settings.startMin).toBe(620);
    expect(r.run.settings.end).toBe('last');
  });

  it('writes a new order back without touching done stops, and deadlines are measured from now', () => {
    let a = start(5);
    a = finish(a, 0, 'delivered', 600);
    const r = remainingRun(a, 12 * 60);
    const sol = solve(buildJob(r.run), r.matrix);
    const b = applyRemainingOrder(a, r, sol.order.filter((p) => p !== 0).map((p) => p - 1));
    expect(b.doneOrder).toEqual([0]);
    expect(b.run.order[0]).toBe(0);
    expect([...b.run.order].sort()).toEqual([0, 1, 2, 3, 4]);
    // a stop due 12:30 from a 12:00 departure has 1800 s
    const c = start(3);
    c.run.items[1]!.stop.deadlineMin = 12 * 60 + 30;
    expect(buildJob(remainingRun(c, 12 * 60).run).deadlineSec[2]).toBe(1800);
  });

  it('remaining schedule starts from now and ignores finished stops', () => {
    let a = start(4);
    a = finish(a, 0, 'delivered', 600);
    const s = remainingSchedule(a, 700);
    expect(Object.keys(s.arrive).sort()).toEqual(['s2', 's3', 's4']);
    expect(s.arrive['s2']).toBeGreaterThan(700);
    expect(remainingSchedule(finish(finish(finish(finish(start(1), 0, 'delivered', 1), 0, 'delivered', 1), 0, 'delivered', 1), 0, 'delivered', 1), 800).totalMin).toBe(0);
  });

  it('keeps locked stops in their slots when re-optimizing', () => {
    let a = start(5);
    a = finish(a, 0, 'delivered', 600);
    a = { ...a, run: { ...a.run, items: a.run.items.map((it, i) => (i === 3 ? { ...it, locked: true } : it)) } };
    const r = remainingRun(a, 620);
    expect(r.run.items[r.itemMap.indexOf(3)]!.locked).toBe(true);
  });
});

describe('hand-offs', () => {
  it('navigation links carry coordinates only: no unit, name or phone', () => {
    const a = start(2);
    const it = a.run.items[0]!;
    for (const app of ['google', 'waze', 'apple'] as const) {
      const u = navUrl(app, it.place.position);
      expect(u).toMatch(/1\.3\d{4,},103\.8\d{4,}/);
      for (const secret of [it.stop.unit!, it.stop.recipient!, it.stop.contact!, 'Person', '91234567', '#']) expect(u).not.toContain(secret);
    }
    expect(navUrl('waze', B)).toBe('https://waze.com/ul?ll=1.350000,103.820000&navigate=yes');
  });

  it('normalizes Singapore numbers and refuses things that are not numbers', () => {
    expect(sgNumber('9123 4567')).toBe('6591234567');
    expect(sgNumber('+65 9123-4567')).toBe('6591234567');
    expect(sgNumber('6591234567')).toBe('6591234567');
    expect(sgNumber('0065 6123 4567')).toBe('6561234567');
    expect(sgNumber('12345')).toBeNull();
    expect(sgNumber(undefined)).toBeNull();
    expect(telHref('91234567')).toBe('tel:+6591234567');
    expect(whatsappHref('91234567', 'On my way, around 14:20')).toBe('https://wa.me/6591234567?text=On%20my%20way%2C%20around%2014%3A20');
    expect(whatsappHref('nope')).toBeNull();
  });
});

describe('run persistence', () => {
  it('saves, reloads and purges after the retention period', async () => {
    const store = idbStore('t-run-persist');
    const a = start(3);
    await saveRun(store, a);
    expect((await loadRun(store, a.updatedAt + 1000))?.run.items).toHaveLength(3);
    expect(await loadRun(store, a.updatedAt + RUN_RETENTION_MS + 1)).toBeUndefined();
    expect(await store.get('activeRun')).toBeUndefined(); // purged, not just hidden
    await saveRun(store, a);
    await clearRun(store);
    expect(await loadRun(store)).toBeUndefined();
  });

  it('remembers the navigation app, defaulting to Google Maps', async () => {
    const store = idbStore('t-run-nav');
    expect(await loadNavApp(store)).toBe('google');
    await saveNavApp(store, 'waze');
    expect(await loadNavApp(store)).toBe('waze');
  });
});
