// ABOUTME: IndexedDB persistence for drafts and submitted bugs — rrweb recordings are far too
// ABOUTME: large for localStorage. Tiny promise wrapper, two object stores, id-keyed.
const DB_NAME = "bugfinder";
const DB_VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("drafts")) db.createObjectStore("drafts", { keyPath: "id" });
      if (!db.objectStoreNames.contains("bugs")) db.createObjectStore("bugs", { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(store: "drafts" | "bugs", mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = run(t.objectStore(store));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    t.oncomplete = () => db.close();
  });
}

export const idb = {
  getAll<T>(store: "drafts" | "bugs"): Promise<T[]> {
    return tx<T[]>(store, "readonly", (s) => s.getAll() as IDBRequest<T[]>).catch(() => []);
  },
  get<T>(store: "drafts" | "bugs", id: string): Promise<T | undefined> {
    return tx<T | undefined>(store, "readonly", (s) => s.get(id) as IDBRequest<T | undefined>).catch(() => undefined);
  },
  put(store: "drafts" | "bugs", value: unknown): Promise<unknown> {
    return tx(store, "readwrite", (s) => s.put(value)).catch(() => undefined);
  },
  /** Like put, but rejects on failure — for writes whose durability something else depends on
   *  (e.g. acknowledging the extension's hand-off only after the capture is actually stored). */
  putStrict(store: "drafts" | "bugs", value: unknown): Promise<unknown> {
    return tx(store, "readwrite", (s) => s.put(value));
  },
  delete(store: "drafts" | "bugs", id: string): Promise<unknown> {
    return tx(store, "readwrite", (s) => s.delete(id)).catch(() => undefined);
  },
};
