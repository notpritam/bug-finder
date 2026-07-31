// ABOUTME: Cross-tab sync — IndexedDB writes in one dashboard tab are announced on a
// ABOUTME: BroadcastChannel so every other open tab updates its state without a refresh.
import type { Bug, Draft } from "./types";

export type SyncMessage =
  | { kind: "draft-put"; draft: Draft }
  | { kind: "draft-remove"; id: string }
  | { kind: "bug-put"; bug: Bug };

const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("bf-sync") : null;

/** Announce a store mutation to other open tabs (the sender never hears its own message). */
export function broadcast(msg: SyncMessage) {
  try {
    channel?.postMessage(msg);
  } catch {
    /* payload not cloneable or channel closed — other tabs just stay stale until refresh */
  }
}

export function onSync(fn: (msg: SyncMessage) => void): () => void {
  if (!channel) return () => {};
  const handler = (e: MessageEvent) => fn(e.data as SyncMessage);
  channel.addEventListener("message", handler);
  return () => channel.removeEventListener("message", handler);
}
