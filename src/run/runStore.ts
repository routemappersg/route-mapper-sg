import type { KeyValueStore } from '../providers/types';
import type { NavApp } from './model';
import type { ActiveRun } from './model';

const RUN = 'activeRun';
const NAV = 'navApp';
/** A run is a day's work: keep it for two days so a late night or a restart does not lose it. */
export const RUN_RETENTION_MS = 2 * 86_400_000;

/** The active run holds personal fields, so it lives in IndexedDB on this device only. */
export const saveRun = (store: KeyValueStore, a: ActiveRun): Promise<void> => store.set(RUN, a);

export async function loadRun(store: KeyValueStore, now = Date.now()): Promise<ActiveRun | undefined> {
  const a = await store.get<ActiveRun>(RUN);
  if (!a) return undefined;
  if (now - a.updatedAt > RUN_RETENTION_MS) {
    await store.delete(RUN);
    return undefined;
  }
  return a;
}

export const clearRun = (store: KeyValueStore): Promise<void> => store.delete(RUN);

export const saveNavApp = (store: KeyValueStore, app: NavApp): Promise<void> => store.set(NAV, app);
export async function loadNavApp(store: KeyValueStore): Promise<NavApp> {
  const v = await store.get<NavApp>(NAV);
  return v === 'waze' || v === 'apple' ? v : 'google';
}
