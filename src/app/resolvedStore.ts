import type { Place } from '../domain/types';
import type { KeyValueStore } from '../providers/types';

/** Resolved positions (postal code + coordinates, non-personal) kept on the device so reopening the app does not repeat lookups. */
const KEY = 'resolved';

export interface CachedResolution {
  place: Place;
  flags: string[];
}

export type ResolutionCache = Record<string, CachedResolution>;

export async function loadResolutions(store: KeyValueStore, stopIds: string[]): Promise<ResolutionCache> {
  const all = (await store.get<ResolutionCache>(KEY)) ?? {};
  const out: ResolutionCache = {};
  for (const id of stopIds) if (all[id]) out[id] = all[id];
  return out;
}

/** Only found positions are kept: a failed lookup is retried next time. */
export async function saveResolutions(store: KeyValueStore, cache: ResolutionCache): Promise<void> {
  await store.set<ResolutionCache>(KEY, cache);
}
