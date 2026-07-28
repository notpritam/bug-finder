// ABOUTME: Client for the Emergent File Storage API — rrweb recordings are uploaded as JSON
// ABOUTME: files and read back via their download URL, keeping IndexedDB rows light.
const STORAGE_API = "https://storage-api-docs.internal.emergent.host/api";

export function storageDownloadUrl(fileId: string): string {
  return `${STORAGE_API}/files/${fileId}/download`;
}

/** Upload a JSON payload as a file; returns the storage file id. Throws on failure. */
export async function uploadJson(filename: string, data: unknown): Promise<string> {
  const form = new FormData();
  form.append("file", new Blob([JSON.stringify(data)], { type: "application/json" }), filename);
  const res = await fetch(`${STORAGE_API}/files/upload`, { method: "POST", body: form });
  if (!res.ok) throw new Error(`upload failed: ${res.status}`);
  const body = (await res.json()) as { id: string };
  if (!body.id) throw new Error("upload response missing id");
  return body.id;
}

/** In-flight/finished download cache so remounting a player never refetches a recording. */
const jsonCache = new Map<string, Promise<unknown>>();

export function fetchStoredJson<T>(fileId: string): Promise<T> {
  let pending = jsonCache.get(fileId);
  if (!pending) {
    pending = fetch(storageDownloadUrl(fileId)).then((res) => {
      if (!res.ok) throw new Error(`download failed: ${res.status}`);
      return res.json();
    });
    // A failed fetch shouldn't poison the cache — allow a retry on next mount.
    pending.catch(() => jsonCache.delete(fileId));
    jsonCache.set(fileId, pending);
  }
  return pending as Promise<T>;
}
