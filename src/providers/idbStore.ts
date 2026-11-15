import type { KeyValueStore } from './types';

const STORE = 'kv';

function open(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function run<T>(db: IDBDatabase, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** On-device key-value store (IndexedDB). Personal stop data lives only here. */
export function idbStore(dbName = 'route-mapper-sg'): KeyValueStore {
  const db = open(dbName);
  return {
    async get<T>(key: string) {
      return (await run(await db, 'readonly', (s) => s.get(key))) as T | undefined;
    },
    async set<T>(key: string, value: T) {
      await run(await db, 'readwrite', (s) => s.put(value, key));
    },
    async delete(key: string) {
      await run(await db, 'readwrite', (s) => s.delete(key));
    },
    async keys() {
      return (await run(await db, 'readonly', (s) => s.getAllKeys())).map(String);
    },
  };
}
