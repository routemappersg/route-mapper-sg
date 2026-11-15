/**
 * Review model: pure functions that turn resolved stops into an optimizer job, apply a
 * visit order, and recompute arrival times from the CACHED matrix (so dragging a stop
 * never calls a provider). Personal fields never appear here: only ids, positions and times.
 */
import type { LatLng, Place, Stop } from '../domain/types';
import { evaluate } from '../optimize/evaluate';
import type { OptimizeJob, TimeMatrix } from '../providers/types';

export interface RunSettings {
  /** Departure time, minutes after midnight. */
  startMin: number;
  /** Default time at each stop, seconds. */
  stopSec: number;
  /** Extra time at gated stops to register with security, seconds. */
  gateSec: number;
  end: 'round' | 'last';
}

export const DEFAULT_SETTINGS: RunSettings = { startMin: 9 * 60, stopSec: 180, gateSec: 180, end: 'last' };

export interface RunItem {
  stop: Stop;
  place: Place;
  locked: boolean;
}

export interface Run {
  depot: LatLng;
  items: RunItem[];
  settings: RunSettings;
  /** Visit order as indices into `items`. */
  order: number[];
}

/**
 * Base job, used to fetch the travel matrix ONCE. Point 0 is the depot; point k+1 is items[k].
 * The cached matrix is always indexed this way, whatever the current visit order is.
 */
export function buildJob(run: Run): OptimizeJob {
  const { items, settings } = run;
  return {
    points: [run.depot, ...items.map((i) => i.place.position)],
    start: 0,
    end: settings.end === 'round' ? 0 : null,
    serviceSec: [0, ...items.map((i) => settings.stopSec + (i.place.gated ? settings.gateSec : 0))],
    deadlineSec: [null, ...items.map((i) => (i.stop.deadlineMin === undefined ? null : i.stop.deadlineMin * 60 - settings.startMin * 60))],
    locked: [],
  };
}

export interface OptimizeInputs {
  job: OptimizeJob;
  matrix: TimeMatrix;
  /** itemOf[p] = item index of point p in this job (itemOf[0] = -1 for the depot). */
  itemOf: number[];
}

/**
 * Job for the optimizer. Points are laid out in the CURRENT visit order, because the optimizer
 * treats a locked index as "this point keeps its slot". The cached matrix is permuted to match.
 */
export function optimizeInputs(run: Run, matrix: TimeMatrix): OptimizeInputs {
  const base = buildJob(run);
  const perm = pointOrder(run.order); // perm[p] = base index of point p
  const pick = <T>(m: T[][]): T[][] => perm.map((i) => perm.map((j) => m[i]![j]!));
  const itemOf = perm.map((b) => b - 1);
  return {
    job: {
      ...base,
      points: perm.map((b) => base.points[b]!),
      serviceSec: perm.map((b) => base.serviceSec[b] ?? 0),
      deadlineSec: perm.map((b) => base.deadlineSec[b] ?? null),
      locked: itemOf.flatMap((k, p) => (k >= 0 && run.items[k]!.locked ? [p] : [])),
    },
    matrix: { durations: pick(matrix.durations), distances: pick(matrix.distances) },
    itemOf,
  };
}

/** Convert an optimizer result (indices into OptimizeInputs.job.points) back to an item order. */
export const orderFromResult = (inputs: OptimizeInputs, pointsOrder: number[]): number[] =>
  pointsOrder.filter((p) => p !== 0).map((p) => inputs.itemOf[p]!);

/** Point order for the job (depot first) from an item order. */
export const pointOrder = (order: number[]): number[] => [0, ...order.map((k) => k + 1)];

/** Item order from a point order. */
export const itemOrder = (points: number[]): number[] => points.filter((p) => p !== 0).map((p) => p - 1);

export interface Row {
  /** 1-based position on the route. */
  n: number;
  item: RunItem;
  itemIndex: number;
  /** Arrival, minutes after midnight. */
  arriveMin: number;
  /** Leg from the previous stop, minutes. */
  legMin: number;
  lateMin: number;
}

export interface Schedule {
  rows: Row[];
  totalMin: number;
  totalKm: number;
  finishMin: number;
  lateCount: number;
}

export function schedule(run: Run, matrix: TimeMatrix): Schedule {
  const job = buildJob(run);
  const pts = pointOrder(run.order);
  const ev = evaluate(job, matrix, pts);
  const rows: Row[] = run.order.map((k, i) => {
    const p = k + 1;
    const prev = pts[i]!;
    return {
      n: i + 1,
      item: run.items[k]!,
      itemIndex: k,
      arriveMin: run.settings.startMin + ev.etaSec[p]! / 60,
      legMin: matrix.durations[prev]![p]! / 60,
      lateMin: ev.lateBySec[p]! / 60,
    };
  });
  return {
    rows,
    totalMin: ev.totalSec / 60,
    totalKm: ev.totalMeters / 1000,
    finishMin: run.settings.startMin + ev.totalSec / 60,
    lateCount: rows.filter((r) => r.lateMin > 0).length,
  };
}

/**
 * Move the stop at position `from` to position `to` (0-based, in the visit order).
 * Locked stops keep their slots: the move is applied among the unlocked stops only,
 * and a locked stop cannot be dragged.
 */
export function moveStop(run: Run, from: number, to: number): number[] {
  const order = run.order;
  const moving = order[from];
  if (moving === undefined || run.items[moving]!.locked || from === to) return order;
  const slots = order.map((k, i) => ({ k, i })).filter(({ k }) => !run.items[k]!.locked);
  const fi = slots.findIndex((s) => s.i === from);
  // Target slot: nearest unlocked slot to `to`.
  let ti = slots.findIndex((s) => s.i >= to);
  if (ti < 0) ti = slots.length - 1;
  if (fi < 0 || ti === fi) return order;
  const seq = slots.map((s) => s.k);
  const [m] = seq.splice(fi, 1);
  seq.splice(ti, 0, m!);
  const out = [...order];
  slots.forEach((s, j) => { out[s.i] = seq[j]!; });
  return out;
}

export function toggleLock(run: Run, k: number): Run {
  return { ...run, items: run.items.map((it, i) => (i === k ? { ...it, locked: !it.locked } : it)) };
}

/** Clock text such as "09:41". */
export function clock(min: number): string {
  const m = Math.round(min);
  const h = Math.floor(m / 60) % 24;
  return `${String(h).padStart(2, '0')}:${String(((m % 60) + 60) % 60).padStart(2, '0')}`;
}

/** Latest-arrival time shown as "by 13:00" if present. */
export const deadlineText = (s: Stop): string | null => (s.deadlineMin === undefined ? null : clock(s.deadlineMin));
