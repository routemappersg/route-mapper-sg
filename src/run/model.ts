/**
 * Run Mode model: pure functions over the on-device run state. Nothing here touches the
 * network. Personal fields (unit, recipient, contact) stay inside Stop; the only things that
 * ever leave are coordinates (navigation hand-off, optimizer) and a phone number the driver
 * taps to call or message (handed to the phone's own apps, never to our providers).
 */
import type { LatLng } from '../domain/types';
import type { TimeMatrix } from '../providers/types';
import { schedule, type Run } from '../review/model';

export type Outcome = 'delivered' | 'failed';

export interface LogEntry {
  atMin: number;
  note?: string;
}

export interface ActiveRun {
  /** Items keep their position; `order` is: done stops in completion order, then the rest. */
  run: Run;
  /** Cached road matrix over [depot, items...] (base indexing). Re-used for every re-plan. */
  matrix: TimeMatrix;
  /** Item indices in the order they were finished. */
  doneOrder: number[];
  /** Outcome log by stop id. */
  log: Record<string, LogEntry>;
  /** Planned arrival (minutes after midnight) per stop id, fixed when the run starts, to show drift. */
  planned: Record<string, number>;
  /** Resolver flags per stop id, kept for the current-stop card. */
  flags: Record<string, string[]>;
  /** True when travel times are straight-line estimates, not road times. */
  estimated: boolean;
  startedAt: number;
  updatedAt: number;
}

const minuteOfDay = (ms: number): number => {
  const d = new Date(ms);
  return d.getHours() * 60 + d.getMinutes();
};

/**
 * Start the run. You cannot leave before now, so the plan baseline (what "behind plan" is
 * measured against) departs at the later of the planned start and the current time.
 */
export function startRun(run: Run, matrix: TimeMatrix, flags: Record<string, string[]> = {}, now = Date.now(), estimated = false): ActiveRun {
  run = { ...run, settings: { ...run.settings, startMin: Math.max(run.settings.startMin, minuteOfDay(now)) } };
  const s = schedule(run, matrix);
  const planned: Record<string, number> = {};
  for (const r of s.rows) planned[r.item.stop.id] = r.arriveMin;
  const items = run.items.map((it) => ({ ...it, stop: { ...it.stop, status: 'pending' as const } }));
  return { run: { ...run, items }, matrix, doneOrder: [], log: {}, planned, flags, estimated, startedAt: now, updatedAt: now };
}

const isDone = (a: ActiveRun, k: number): boolean => a.doneOrder.includes(k);

/** Stops still to visit, in visit order. */
export const remaining = (a: ActiveRun): number[] => a.run.order.filter((k) => !isDone(a, k));

/** The stop to go to now: first pending stop; if only skipped stops are left, the first of those. */
export function currentIndex(a: ActiveRun): number | null {
  const rest = remaining(a);
  return rest.find((k) => a.run.items[k]!.stop.status === 'pending') ?? rest[0] ?? null;
}

/** The stop after the current one, for the "next" preview. */
export function nextIndex(a: ActiveRun): number | null {
  const cur = currentIndex(a);
  const rest = remaining(a).filter((k) => k !== cur);
  return rest.find((k) => a.run.items[k]!.stop.status === 'pending') ?? rest[0] ?? null;
}

/** Where the driver is, as far as we know: the last finished stop, else the start. */
export function position(a: ActiveRun): LatLng {
  const last = a.doneOrder[a.doneOrder.length - 1];
  return last === undefined ? a.run.depot : a.run.items[last]!.place.position;
}

const withOrder = (a: ActiveRun, doneOrder: number[], rest: number[], items = a.run.items): ActiveRun => ({
  ...a, doneOrder, run: { ...a.run, items, order: [...doneOrder, ...rest] },
});

const setStatus = (a: ActiveRun, k: number, status: 'pending' | 'delivered' | 'failed' | 'skipped'): Run['items'] =>
  a.run.items.map((it, i) => (i === k ? { ...it, stop: { ...it.stop, status } } : it));

/** Delivered / Failed. A stop finished out of order moves into the done list; the rest keep their order. */
export function finish(a: ActiveRun, k: number, outcome: Outcome, atMin: number, note?: string): ActiveRun {
  if (isDone(a, k) || a.run.items[k] === undefined) return a;
  const id = a.run.items[k]!.stop.id;
  const out = withOrder(a, [...a.doneOrder, k], remaining(a).filter((x) => x !== k), setStatus(a, k, outcome));
  return { ...out, log: { ...a.log, [id]: { atMin, ...(note ? { note } : {}) } }, updatedAt: Date.now() };
}

/** Skip for now: the stop goes to the end of the list. It is never dropped and comes back round. */
export function skip(a: ActiveRun, k: number): ActiveRun {
  if (isDone(a, k) || a.run.items[k] === undefined) return a;
  const rest = remaining(a).filter((x) => x !== k);
  return { ...withOrder(a, a.doneOrder, [...rest, k], setStatus(a, k, 'skipped')), updatedAt: Date.now() };
}

/** Undo the last Delivered/Failed: the stop becomes the current stop again. */
export function undoLast(a: ActiveRun): ActiveRun {
  const k = a.doneOrder[a.doneOrder.length - 1];
  if (k === undefined) return a;
  const id = a.run.items[k]!.stop.id;
  const { [id]: _removed, ...log } = a.log;
  void _removed;
  const out = withOrder(a, a.doneOrder.slice(0, -1), [k, ...remaining(a)], setStatus(a, k, 'pending'));
  return { ...out, log, updatedAt: Date.now() };
}

/** Put a failed stop back to be tried again at the end of the run. */
export function retry(a: ActiveRun, k: number): ActiveRun {
  if (a.run.items[k]?.stop.status !== 'failed') return a;
  const id = a.run.items[k]!.stop.id;
  const { [id]: _removed, ...log } = a.log;
  void _removed;
  const out = withOrder(a, a.doneOrder.filter((x) => x !== k), [...remaining(a), k], setStatus(a, k, 'pending'));
  return { ...out, log, updatedAt: Date.now() };
}

export interface Remaining {
  /** A run over the stops still to do, departing from the driver's position. */
  run: Run;
  /** The cached matrix picked down to [position, remaining...]: no network call needed. */
  matrix: TimeMatrix;
  /** itemMap[i] = full item index of sub-run item i. */
  itemMap: number[];
}

/**
 * The remaining stops as a small run starting now from the driver's position. The matrix is
 * sliced from the cached one, so re-optimizing costs no routing call. The return leg of a
 * round trip is not part of this plan (the sub-run finishes at its last stop).
 */
export function remainingRun(a: ActiveRun, nowMin: number): Remaining {
  const rest = remaining(a);
  const last = a.doneOrder[a.doneOrder.length - 1];
  const startBase = last === undefined ? 0 : last + 1;
  const baseIdx = [startBase, ...rest.map((k) => k + 1)];
  const pick = <T>(m: T[][]): T[][] => baseIdx.map((i) => baseIdx.map((j) => m[i]![j]!));
  const items = rest.map((k) => a.run.items[k]!);
  return {
    run: {
      depot: position(a),
      items,
      settings: { ...a.run.settings, startMin: nowMin, end: 'last' },
      order: items.map((_, i) => i),
    },
    matrix: { durations: pick(a.matrix.durations), distances: pick(a.matrix.distances) },
    itemMap: rest,
  };
}

/** Write a re-optimized order for the remaining stops back into the run. Done stops are untouched. */
export function applyRemainingOrder(a: ActiveRun, r: Remaining, subOrder: number[]): ActiveRun {
  const rest = subOrder.map((i) => r.itemMap[i]!);
  return { ...withOrder(a, a.doneOrder, rest), updatedAt: Date.now() };
}

/** Arrival times for the remaining stops if the driver leaves now. */
export function remainingSchedule(a: ActiveRun, nowMin: number): { arrive: Record<string, number>; totalMin: number; finishMin: number } {
  const r = remainingRun(a, nowMin);
  if (r.run.items.length === 0) return { arrive: {}, totalMin: 0, finishMin: nowMin };
  const s = schedule(r.run, r.matrix);
  const arrive: Record<string, number> = {};
  for (const row of s.rows) arrive[row.item.stop.id] = row.arriveMin;
  return { arrive, totalMin: s.totalMin, finishMin: s.finishMin };
}

export const counts = (a: ActiveRun): { delivered: number; failed: number; skipped: number; pending: number } => {
  const c = { delivered: 0, failed: 0, skipped: 0, pending: 0 };
  for (const it of a.run.items) c[it.stop.status]++;
  return c;
};

// --- hand-offs: coordinates only for navigation; the number goes only to the phone's own apps ---

export type NavApp = 'google' | 'waze' | 'apple';
export const NAV_APPS: NavApp[] = ['google', 'waze', 'apple'];

/** One leg: from the driver's current location to this stop's point (the gate, for gated stops). */
export function navUrl(app: NavApp, to: LatLng): string {
  const c = `${to.lat.toFixed(6)},${to.lng.toFixed(6)}`;
  switch (app) {
    case 'google': return `https://www.google.com/maps/dir/?api=1&destination=${c}&travelmode=driving`;
    case 'waze': return `https://waze.com/ul?ll=${c}&navigate=yes`;
    case 'apple': return `https://maps.apple.com/?daddr=${c}&dirflg=d`;
  }
}

/** Singapore number to E.164 digits (no plus), or null if it does not look like one. */
export function sgNumber(raw: string | undefined): string | null {
  if (!raw) return null;
  const d = raw.replace(/[^\d+]/g, '').replace(/^\+/, '').replace(/^00/, '');
  if (/^[3689]\d{7}$/.test(d)) return `65${d}`;
  if (/^65[3689]\d{7}$/.test(d)) return d;
  return null;
}

export const telHref = (raw: string | undefined): string | null => {
  const n = sgNumber(raw);
  return n ? `tel:+${n}` : null;
};

/** WhatsApp link with an optional "on the way" message (no name, no unit in the text). */
export function whatsappHref(raw: string | undefined, text?: string): string | null {
  const n = sgNumber(raw);
  return n ? `https://wa.me/${n}${text ? `?text=${encodeURIComponent(text)}` : ''}` : null;
}
