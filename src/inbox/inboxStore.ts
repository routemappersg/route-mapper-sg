import type { Stop } from '../domain/types';
import type { KeyValueStore } from '../providers/types';

const KEY = 'inbox';
export const DEFAULT_RETENTION_DAYS = 7;

interface Saved {
  savedAt: number;
  stops: Stop[];
}

export async function saveInbox(store: KeyValueStore, stops: Stop[], now = Date.now()): Promise<void> {
  await store.set<Saved>(KEY, { savedAt: now, stops });
}

/** Load the saved inbox. Anything older than the retention period is purged, not returned. */
export async function loadInbox(
  store: KeyValueStore,
  retentionDays = DEFAULT_RETENTION_DAYS,
  now = Date.now(),
): Promise<Stop[]> {
  const saved = await store.get<Saved>(KEY);
  if (!saved) return [];
  if (now - saved.savedAt > retentionDays * 86_400_000) {
    await store.delete(KEY);
    return [];
  }
  return saved.stops;
}

/** "Wipe all data" button. */
export async function wipeAll(store: KeyValueStore): Promise<void> {
  for (const k of await store.keys()) await store.delete(k);
}
