/** Pure helpers for the chat-style stop list: what each stop row says about its lookup. */
import type { Stop } from '../domain/types';
import type { Resolved } from '../app/resolveAll';

export type RowState = 'finding' | 'pinned' | 'gated' | 'check' | 'notfound';

export interface RowStatus {
  state: RowState;
  /** Resolver flag keys worth showing next to the row. */
  flags: string[];
}

/** Flags that mean "pinned, but please look at it". */
const CHECK = new Set(['postal-mismatch', 'block-mismatch', 'ambiguous', 'confirm-address', 'gate-unverified', 'check-pin']);

/**
 * `r` is undefined while the lookup is still running. A stop that cannot be placed is shown as
 * not found, never hidden.
 */
export function rowStatus(r: Resolved | undefined): RowStatus {
  if (!r) return { state: 'finding', flags: [] };
  if (!r.place) return { state: 'notfound', flags: r.flags.filter((f) => f !== 'not-found') };
  const flags = r.flags.filter((f) => f !== 'demo');
  if (flags.some((f) => CHECK.has(f))) return { state: 'check', flags };
  return { state: r.place.gated ? 'gated' : 'pinned', flags };
}

/** How many of these stops are still being looked up. */
export const pendingCount = (stops: Stop[], done: Map<string, Resolved>): number => stops.filter((s) => !done.has(s.id)).length;

/** Resolved list in stop order. Stops with no answer yet are reported as not found, never dropped. */
export function inOrder(stops: Stop[], done: Map<string, Resolved>): Resolved[] {
  return stops.map((stop) => done.get(stop.id) ?? { stop, place: null, flags: ['not-found'] });
}

/** First lines of what the driver sent, for the chat bubble (the full text is never re-shown or kept). */
export function preview(text: string, maxLines = 4): string {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return lines.length <= maxLines ? lines.join('\n') : `${lines.slice(0, maxLines).join('\n')}\n… +${lines.length - maxLines}`;
}
