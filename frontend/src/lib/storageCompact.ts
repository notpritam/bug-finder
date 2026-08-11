// ABOUTME: Rebuild web-storage writes the extension compacted. An analytics SDK rewriting its whole
// ABOUTME: state blob per event made one capture 53MB, 48MB of it a single key — so the extension
// ABOUTME: now drops each write's oldValue when it is byte-identical to the previous write's
// ABOUTME: newValue, and stores repeat writes as RFC 6902 patches against the value before them.
// ABOUTME: Nothing was discarded: this puts every original string back. Mirrors the extension's
// ABOUTME: src/lib/storageCompact.ts — the two must stay in step.
import { applyPatch } from "fast-json-patch";

export interface StorageWrite {
  t: number;
  area: string;
  origin?: string;
  op: string;
  key?: string;
  oldValue?: string;
  newValue?: string;
  /** Set by the extension: oldValue is the previous write's newValue for this slot. */
  oldFromPrev?: true;
  /** Set by the extension: newValue is this patch applied to the previous write's newValue. */
  newPatch?: unknown[];
}

/** Writes are tracked per area, per origin, per key — two origins can hold the same key with
 *  completely different values, and sharing a baseline between them would corrupt both. */
const slot = (w: StorageWrite) => `${w.area}|${w.origin ?? ""}|${w.key ?? ""}`;

/**
 * Restore full values. Safe on an uncompacted list — writes without the markers pass through
 * untouched — so callers never need to know which form they were handed.
 */
export function expandStorageChanges(writes: StorageWrite[]): StorageWrite[] {
  const last = new Map<string, string>();
  return writes.map((w) => {
    const id = slot(w);
    const prev = last.get(id);
    const out: StorageWrite = { ...w };

    if (out.oldFromPrev) {
      if (prev !== undefined) out.oldValue = prev;
      delete out.oldFromPrev;
    }

    if (out.newPatch) {
      if (prev !== undefined) {
        try {
          const rebuilt = applyPatch(JSON.parse(prev), out.newPatch as never, false, false).newDocument;
          out.newValue = JSON.stringify(rebuilt);
        } catch {
          // Leave newValue absent rather than invent one. A missing value is honest; a wrong one
          // sends a developer chasing state the page never held.
        }
      }
      delete out.newPatch;
    }

    if (out.newValue !== undefined) last.set(id, out.newValue);
    else if (out.op === "remove" || out.op === "clear") last.delete(id);
    return out;
  });
}
