// ABOUTME: Client for the Emergent File Storage API — a session's evidence and its rrweb recording
// ABOUTME: are uploaded as files and read back by id, keeping the Mongo document and IndexedDB rows
// ABOUTME: light. Everything is gzipped on the way out: a real capture's evidence measured 62.4MB
// ABOUTME: raw and 8.0MB gzipped, which is the difference between a 20-second wait and a 2-second
// ABOUTME: one on an ordinary connection.
const STORAGE_API = import.meta.env.REACT_APP_STORAGE_API_URL as string;

export function storageDownloadUrl(fileId: string): string {
  return `${STORAGE_API}/files/${fileId}/download`;
}

/**
 * Gzip a string in the browser, or return it unchanged where that is not possible.
 *
 * `CompressionStream` is unavailable in older Safari and in any non-secure context. Returning the
 * raw bytes there is safe rather than a silent downgrade, because the reader identifies gzip by its
 * magic bytes and not by a filename or header — so a compressed and an uncompressed upload are both
 * readable, forever, with no flag to keep in sync.
 */
async function gzip(text: string): Promise<{ body: BlobPart; compressed: boolean }> {
  if (typeof CompressionStream === "undefined") return { body: text, compressed: false };
  try {
    const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
    return { body: await new Response(stream).blob(), compressed: true };
  } catch {
    return { body: text, compressed: false };
  }
}

/**
 * Upload a JSON payload as a file; returns the storage file id. Throws on failure.
 *
 * The evidence blob is by far the largest thing this product moves, and it was being sent raw —
 * to a reader that has always been able to decompress. 62.4MB of a real capture becomes 8.0MB
 * (7.8x), and the compression itself costs about a second of CPU against twenty seconds of wire
 * time it removes.
 */
export async function uploadJson(filename: string, data: unknown): Promise<string> {
  const json = JSON.stringify(data);
  const { body, compressed } = await gzip(json);
  const form = new FormData();
  form.append(
    "file",
    new Blob([body], { type: compressed ? "application/gzip" : "application/json" }),
    // The extension names its gzipped artefacts `.gz` too. Purely descriptive — nothing reads it.
    compressed ? `${filename}.gz` : filename,
  );
  const res = await fetch(`${STORAGE_API}/files/upload`, { method: "POST", body: form });
  if (!res.ok) throw new Error(`upload failed: ${res.status}`);
  const out = (await res.json()) as { id: string };
  if (!out.id) throw new Error("upload response missing id");
  return out.id;
}

/**
 * Finished/in-flight downloads, so remounting a player never refetches a recording.
 *
 * BOUNDED, which it was not. A parsed evidence blob is tens of megabytes of live objects, and this
 * map was module-level with no eviction — opening five large sessions in one tab kept five of them
 * resident for the life of the page. That is the same class of leak the extension spent its 0.2.x
 * releases removing, reintroduced on the reading side.
 *
 * Two is deliberate: the only access pattern that benefits from caching is going back to the
 * session you just left. Anything beyond that is holding memory for a page nobody is looking at.
 */
const MAX_CACHED = 2;
const jsonCache = new Map<string, Promise<unknown>>();

function remember(fileId: string, pending: Promise<unknown>): void {
  jsonCache.set(fileId, pending);
  // Map preserves insertion order, so the first key is always the least recently added.
  while (jsonCache.size > MAX_CACHED) {
    const oldest = jsonCache.keys().next().value;
    if (oldest === undefined) break;
    jsonCache.delete(oldest);
  }
}

/** Drop everything held. Called when leaving a session, so a big capture does not outlive the
 *  screen that needed it. */
export function clearStoredJsonCache(): void {
  jsonCache.clear();
}

export function fetchStoredJson<T>(fileId: string): Promise<T> {
  const cached = jsonCache.get(fileId);
  if (cached) {
    // Re-insert so the most recently READ entry is the one that survives eviction, not merely the
    // most recently fetched.
    jsonCache.delete(fileId);
    jsonCache.set(fileId, cached);
    return cached as Promise<T>;
  }

  const pending = fetch(storageDownloadUrl(fileId)).then(async (res) => {
    if (!res.ok) throw new Error(`download failed: ${res.status}`);
    // Identified by the two gzip magic bytes rather than a filename or a header, so files uploaded
    // before compression existed keep working and no flag has to stay in sync with the data.
    const buf = await res.arrayBuffer();
    const head = new Uint8Array(buf, 0, Math.min(2, buf.byteLength));
    if (head[0] === 0x1f && head[1] === 0x8b) {
      const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"));
      return JSON.parse(await new Response(stream).text());
    }
    return JSON.parse(new TextDecoder().decode(buf));
  });

  // A failed fetch must not poison the cache — allow a retry on the next mount.
  pending.catch(() => jsonCache.delete(fileId));
  remember(fileId, pending);
  return pending as Promise<T>;
}
