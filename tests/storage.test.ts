import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { idbStore } from '../src/providers/idbStore';
import { loadInbox, saveInbox, wipeAll } from '../src/inbox/inboxStore';
import type { Stop } from '../src/domain/types';

const stop: Stop = { id: 's1', status: 'pending', flags: [], postal: '123456', unit: '#01-01', recipient: 'Test' };
const DAY = 86_400_000;

describe('on-device inbox storage', () => {
  it('round-trips stops through IndexedDB', async () => {
    const store = idbStore('t-roundtrip');
    await saveInbox(store, [stop]);
    expect(await loadInbox(store)).toEqual([stop]);
  });

  it('purges data older than the retention period', async () => {
    const store = idbStore('t-purge');
    const t0 = 1_000_000_000_000;
    await saveInbox(store, [stop], t0);
    expect(await loadInbox(store, 7, t0 + 6 * DAY)).toHaveLength(1);
    expect(await loadInbox(store, 7, t0 + 8 * DAY)).toEqual([]);
    expect(await store.keys()).toEqual([]);
  });

  it('wipe removes everything', async () => {
    const store = idbStore('t-wipe');
    await saveInbox(store, [stop]);
    await store.set('other', 1);
    await wipeAll(store);
    expect(await store.keys()).toEqual([]);
  });
});
