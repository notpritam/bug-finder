// ABOUTME: Client for the Emergent File Storage API — rrweb recordings are uploaded as JSON
// ABOUTME: files and read back via their download URL, keeping IndexedDB rows light.
const STORAGE_API = import.meta.env.REACT_APP_STORAGE_API_URL as string;

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
    pending = fetch(storageDownloadUrl(fileId)).then(async (res) => {
      if (!res.ok) throw new Error(`download failed: ${res.status}`);
      // The extension gzips JSON artefacts before upload (a capture's evidence goes from tens of
      // megabytes to under one on the wire). Detect it from the two magic bytes rather than a
      // filename or header, so files uploaded before that change keep working unchanged.
      const buf = await res.arrayBuffer();
      const head = new Uint8Array(buf, 0, Math.min(2, buf.byteLength));
      if (head[0] === 0x1f && head[1] === 0x8b) {
        const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"));
        return JSON.parse(await new Response(stream).text());
      }
      return JSON.parse(new TextDecoder().decode(buf));
    });
    // A failed fetch shouldn't poison the cache — allow a retry on next mount.
    pending.catch(() => jsonCache.delete(fileId));
    jsonCache.set(fileId, pending);
  }
  return pending as Promise<T>;
}
