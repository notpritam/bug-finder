// ABOUTME: Draft persistence + conversion — IndexedDB-backed until the real API exists.
// ABOUTME: Accepts extension payloads and turns a reviewed draft into a filed Bug.
import type { Bug, BugSeverity, DeepCapture, Draft, ReplayEvent, Reporter } from "./types";
import { envFromUrl } from "./meta";
import { idb } from "./store";
import { uploadJson } from "./storage-api";
import { broadcast } from "./sync";
import { publishBug, unpublishBug } from "./bugs-api";

const DRAFTS_KEY = "bf.drafts";
const SUBMITTED_KEY = "bf.submitted";

/** Async load from IndexedDB, migrating any pre-IDB localStorage payloads on first run. */
export async function loadDrafts(): Promise<Draft[]> {
  try {
    const legacy = localStorage.getItem(DRAFTS_KEY);
    if (legacy) {
      const parsed: Draft[] = JSON.parse(legacy);
      for (const d of parsed) await idb.put("drafts", d);
      localStorage.removeItem(DRAFTS_KEY);
    }
  } catch {
    /* legacy payload unreadable — skip */
  }
  const drafts = await idb.getAll<Draft>("drafts");
  return drafts.sort((a, b) => b.createdAt - a.createdAt);
}

export function persistDraft(draft: Draft) {
  void idb.put("drafts", draft);
  broadcast({ kind: "draft-put", draft });
}

/** Like persistDraft, but resolves only once the write is durable — and rejects when it is not.
 *  The extension bridge drops its copy of a capture the moment we acknowledge it, so the ack
 *  must be sequenced after this resolves or a crash in between loses the capture everywhere. */
export async function persistDraftDurable(draft: Draft): Promise<void> {
  await idb.putStrict("drafts", draft);
  broadcast({ kind: "draft-put", draft });
}

export function removeDraft(id: string) {
  void idb.delete("drafts", id);
  broadcast({ kind: "draft-remove", id });
}

export async function loadSubmittedBugs(): Promise<Bug[]> {
  try {
    const legacy = localStorage.getItem(SUBMITTED_KEY);
    if (legacy) {
      const parsed: Bug[] = JSON.parse(legacy);
      for (const b of parsed) await idb.put("bugs", b);
      localStorage.removeItem(SUBMITTED_KEY);
    }
  } catch {
    /* skip */
  }
  const bugs = await idb.getAll<Bug>("bugs");
  // Older double-submits may persist as two rows with one humanId — surface only the newest.
  return dedupeByHumanId(bugs.sort((a, b) => b.createdAt - a.createdAt));
}

/** The fields with unbounded size — every response body, every console stack, every state patch,
 *  every cookie, the interaction replay, an inline rrweb stream. ALWAYS uploaded as one storage
 *  file and replaced by `evidenceFileId`, unconditionally, so the Mongo document stays a light
 *  record (title/status/counts/refs) no matter how big the capture was. The dashboard itself
 *  never reads the server copy — it renders from IndexedDB, which keeps the full row.
 *
 *  BACKEND CONTRACT: the evidence file at `evidenceFileId` is one JSON object holding exactly
 *  the keys below that were present on the bug — `{ network: […], console: […], … }` — served
 *  by `${STORAGE_API}/files/{id}/download`. Agent reads resolve offloaded fields from it. */
export const OFFLOADED_EVIDENCE_KEYS = [
  "network",
  "console",
  "replay",
  "rrweb",
  "stateSources",
  "stateChanges",
  "cookiesAtStart",
  "cookiesAtStop",
  "cookieChanges",
  "storageAtStart",
  "storageAtStop",
  "storageChanges",
  "indexedDb",
  "cacheStorage",
  "browserLog",
  "layoutDebug",
  "debugState",
] as const satisfies readonly (keyof Bug)[];

/** Leave the server a document that is always small.
 *
 * MongoDB refuses anything over 16MB, and "under the limit" still meant multi-MB documents for
 * every read. So the heavy evidence is moved to the storage service on every publish — not just
 * past a threshold — and the document keeps counts plus the file id. Same trade the rrweb
 * recording already makes, applied to all of it. */
async function shrinkForServer(bug: Bug): Promise<Bug> {
  const asRecord = bug as unknown as Record<string, unknown>;
  const heavy: Record<string, unknown> = {};
  for (const key of OFFLOADED_EVIDENCE_KEYS) {
    if (asRecord[key] !== undefined) heavy[key] = asRecord[key];
  }

  const slim: Record<string, unknown> = { ...asRecord };
  for (const key of OFFLOADED_EVIDENCE_KEYS) delete slim[key];
  // Local bookkeeping, not part of the shared record.
  delete slim.syncState;
  delete slim.syncError;
  // Counts survive inline so summaries and the agent briefing stay truthful without a fetch.
  const len = (v: unknown) => (Array.isArray(v) ? v.length : 0);
  slim.evidenceCounts = {
    network: len(bug.network),
    console: len(bug.console),
    replay: len(bug.replay),
    stateSources: len(bug.stateSources),
    stateChanges: len(bug.stateChanges),
    cookies: len(bug.cookiesAtStop ?? bug.cookiesAtStart),
    cookieChanges: len(bug.cookieChanges),
    browserLog: len(bug.browserLog),
    storageChanges: len(bug.storageChanges),
    rrwebEvents: len(bug.rrweb),
  };
  if (Object.keys(heavy).length) {
    slim.evidenceFileId = await uploadJson(`${bug.humanId}-evidence.json`, heavy);
  }
  return slim as unknown as Bug;
}

/** Outcome of a store-and-publish, returned to the CALLING tab directly. The BroadcastChannel
 *  never delivers to its own sender, so this promise — not a broadcast — is how the filing tab
 *  learns its bug never reached the server. */
export interface SyncResult {
  /** The row as persisted, syncState/syncError stamped. */
  bug: Bug;
  /** False when the publish FAILED (server refused, upload failed, offline). "No backend
   *  configured" counts as ok — there is nothing to reach, not something unreached. */
  ok: boolean;
  /** Human-readable reason when not ok. */
  error?: string;
}

/** Write the full row to IndexedDB — the copy this browser renders, no 16MB ceiling. Rejects if
 *  the write failed, because callers sequence irreversible steps (dropping the draft, acking the
 *  extension) on this row being durable. */
export async function storeBugLocal(bug: Bug): Promise<void> {
  await idb.putStrict("bugs", bug);
  broadcast({ kind: "bug-put", bug });
}

/** Publish the server snapshot for an already-stored bug and stamp the outcome on the stored
 *  row (so "never reached the server" survives a reload). Never rejects — the failure IS the
 *  result. Edits made while the publish was in flight are preserved: the stamp merges onto the
 *  freshest stored row, and a row deleted mid-flight stays deleted. */
export async function publishStoredBug(bug: Bug): Promise<SyncResult> {
  let syncState: Bug["syncState"];
  let syncError: string | undefined;
  let ok: boolean;
  try {
    const delivered = await publishBug(await shrinkForServer(bug));
    syncState = delivered ? "synced" : "local-only"; // false ⇔ no backend configured
    ok = true;
  } catch (err) {
    console.error("[bug-finder] snapshot did not reach the server:", err);
    const offline = typeof navigator !== "undefined" && navigator.onLine === false;
    // A network-level failure (offline, DNS, CORS-dead server) is "local-only": nothing
    // rejected the bug, it just never got there. An HTTP refusal is "failed".
    syncState = offline || err instanceof TypeError ? "local-only" : "failed";
    syncError = err instanceof Error ? err.message : String(err);
    ok = false;
  }
  const current = await idb.get<Bug>("bugs", bug.id);
  const final: Bug = { ...(current ?? bug), syncState, syncError };
  if (current !== undefined) {
    await idb.put("bugs", final);
    broadcast({ kind: "bug-put", bug: final });
  }
  return { bug: final, ok, error: syncError };
}

/** Store locally, then publish. Resolves with the outcome — callers show it, never swallow it.
 *  A bug that looks filed but reaches nobody is the worst outcome this product can produce. */
export async function persistSubmittedBug(bug: Bug): Promise<SyncResult> {
  try {
    await storeBugLocal(bug);
  } catch (err) {
    const failed: Bug = { ...bug, syncState: "failed", syncError: `Could not write to local storage: ${String(err)}` };
    return { bug: failed, ok: false, error: failed.syncError };
  }
  return publishStoredBug(bug);
}

/** Collapse duplicate humanIds, keeping the newest row. Two dashboard tabs (or a double-submit)
 *  filing the same capture both get the same server-allocated humanId but mint different local
 *  ids, so id-based dedup let both through — two rows, one unopenable. */
export function dedupeByHumanId(bugs: Bug[]): Bug[] {
  const newest = new Map<string, Bug>();
  for (const b of bugs) {
    const cur = newest.get(b.humanId);
    if (!cur || b.createdAt > cur.createdAt) newest.set(b.humanId, b);
  }
  return bugs.filter((b) => newest.get(b.humanId) === b);
}

/** Forget a filed bug. IndexedDB is what the UI reads and the backend snapshot is what agents
 *  read, so both have to go or a "deleted" bug stays visible to one of them. */
export function removeBug(bug: Bug) {
  void idb.delete("bugs", bug.id);
  broadcast({ kind: "bug-remove", id: bug.id });
  unpublishBug(bug.humanId);
}

/** The extension's DraftPayload → our Draft. Shapes already align; fill in dashboard-only fields. */
export function draftFromExtension(payload: Record<string, unknown>, reporter?: Reporter): Draft {
  const env = (payload.environment ?? {}) as Draft["environment"];
  return {
    id: String(payload.id ?? `d-${Date.now().toString(36)}`),
    reporter,
    createdAt: Number(payload.capturedAt ?? Date.now()),
    pageUrl: String(payload.pageUrl ?? ""),
    pageTitle: String(payload.pageTitle ?? "Captured session"),
    durationMs: Number(payload.durationMs ?? 0),
    scenario: "generic",
    replay: (payload.replay as Draft["replay"]) ?? [],
    console: (payload.console as Draft["console"]) ?? [],
    network: (payload.network as Draft["network"]) ?? [],
    pickedElements: (payload.pickedElements as Draft["pickedElements"]) ?? [],
    markers: (payload.markers as Draft["markers"]) ?? [],
    visits: (payload.visits as Draft["visits"]) ?? [],
    environment: {
      browser: env.browser ?? "Unknown",
      os: env.os ?? "Unknown",
      viewport: env.viewport ?? { w: 1440, h: 900 },
      dpr: env.dpr ?? 1,
      language: env.language ?? "en",
      timezone: env.timezone ?? "UTC",
      online: env.online ?? true,
      cores: env.cores,
      memoryGb: env.memoryGb,
    },
    perf: (payload.perf as Draft["perf"]) ?? undefined,
    preRollMs: payload.preRollMs ? Number(payload.preRollMs) : undefined,
    notes: payload.notes ? String(payload.notes) : undefined,
    // First-level report fields the extension's side panel collected before hand-off.
    title: payload.title ? String(payload.title) : undefined,
    description: payload.description ? String(payload.description) : undefined,
    severity: (payload.severity as Draft["severity"]) ?? undefined,
    tags: Array.isArray(payload.tags) ? (payload.tags as string[]) : undefined,
    env: payload.env ? String(payload.env) : envFromUrl(String(payload.pageUrl ?? "")),
    jobId: payload.jobId ? String(payload.jobId) : undefined,
    // Chosen in the extension's side panel at capture time.
    initiative: payload.initiative ? String(payload.initiative) : undefined,
    initiativeId: payload.initiativeId ? String(payload.initiativeId) : undefined,
    rrweb: Array.isArray(payload.rrweb) && payload.rrweb.length > 1 ? (payload.rrweb as unknown[]) : undefined,
    rrwebFileId: payload.rrwebFileId ? String(payload.rrwebFileId) : undefined,
    videoFileId: payload.videoFileId ? String(payload.videoFileId) : undefined,
    shots: Array.isArray(payload.shots) ? (payload.shots as Draft["shots"]) : undefined,
    // Layout-debugger evidence the extension pulled off the page at stop (slot table, overlap
    // verdicts, measurement ledger tail). Opaque passthrough — rendered by inspector + summary.
    layoutDebug: payload.layoutDebug ?? undefined,
    // Build identity + loaded chunks, and the app's opt-in state snapshot — same pull.
    appInfo: payload.appInfo ?? undefined,
    // Narrowed rather than passed through: payload is Record<string, unknown>, so this is
    // `unknown` and does not satisfy `number | undefined`.
    captureSchemaVersion: typeof payload.captureSchemaVersion === "number" ? payload.captureSchemaVersion : undefined,
    debugState: payload.debugState ? String(payload.debugState) : undefined,
    ...pickDeepCapture(payload),
  };
}

/** Clip an event list to the kept window and re-zero timestamps. `lower` sits before zero on
 *  an untrimmed draft: console and network entries captured before the user pressed record
 *  carry a negative `t`, and they are usually where the bug actually started. */
function clip<T extends { t: number }>(items: T[], lower: number, upper: number, zero: number): T[] {
  return items.filter((i) => i.t >= lower && i.t <= upper).map((i) => ({ ...i, t: i.t - zero }));
}

/** The deep-capture fields, copied verbatim from a source object.
 *
 *  One helper used by both mappings below. They each enumerate their fields explicitly, and that
 *  is how all fifteen of these were lost in silence once already: the extension sent them, both
 *  mappings ignored them, nothing errored, and the filed bug looked complete. Keeping the list in
 *  a single place means a future schema bump has one place to fail rather than two. */
function pickDeepCapture(src: Record<string, unknown> | Draft): DeepCapture {
  const s = src as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of DEEP_CAPTURE_KEYS) {
    if (s[key] !== undefined) out[key] = s[key];
  }
  return out as DeepCapture;
}

const DEEP_CAPTURE_KEYS = [
  "stateSources",
  "stateChanges",
  "harFileId",
  "harSavedAs",
  "harEntryCount",
  "cookiesAtStart",
  "cookiesAtStop",
  "cookieChanges",
  "storageAtStart",
  "storageAtStop",
  "storageChanges",
  "indexedDb",
  "cacheStorage",
  "browserLog",
  "cdp",
  // Added late, and the comment above turned out to be prophetic: the extension had been
  // attaching this to every capture since the memory-safety release and both mappings ignored
  // it, so every filed bug reported a healthy capture whether or not the extension had been
  // crashing. It is the ONLY route an extension crash has to anyone who could fix it.
  "diagnostics",
] as const satisfies readonly (keyof DeepCapture)[];

let submitSeq = 0;

/** A reviewed draft → a filed Bug. Applies the trim window and stamps identity/history. */
export function bugFromDraft(
  draft: Draft,
  existing: Bug[],
  reporter: Reporter,
  people: Reporter[] = [],
  /** Issued by the server. Omitted only when the server was unreachable, in which case the local
   *  guess below is used so filing still works offline — and may collide, which is exactly why
   *  the server is asked first. */
  allocatedHumanId?: string | null,
): Bug {
  const t0 = draft.trim?.in ?? 0;
  const t1 = draft.trim?.out ?? draft.durationMs;
  // Trimming is an explicit choice about what to keep, so it drops the pre-roll too. Leave the
  // draft untrimmed and everything from before the recording rides along.
  const lower = draft.trim ? t0 : -(draft.preRollMs ?? 0);
  const maxNum = Math.max(100, ...existing.map((b) => Number(b.humanId.split("-")[1]) || 100));
  const now = Date.now();

  // Keep the last visit at-or-before the trim start so the replay knows its starting URL.
  const visitsBefore = draft.visits.filter((v) => v.t <= t0);
  const startVisit = visitsBefore[visitsBefore.length - 1];
  const visits = [
    ...(startVisit ? [{ ...startVisit, t: 0 }] : []),
    ...clip(draft.visits.filter((v) => v.t > t0), t0, t1, t0),
  ];

  // Same for replay nav events: the stage needs a nav at t=0 to know which page it starts on.
  const replay = clip(draft.replay, lower, t1, t0) as ReplayEvent[];
  if (startVisit && !replay.some((e) => e.kind === "nav" && e.t === 0)) {
    replay.unshift({ t: 0, kind: "nav", url: startVisit.url });
  }

  return {
    id: `b-${now.toString(36)}-${submitSeq++}`,
    humanId: allocatedHumanId ?? `BF-${maxNum + 1}`,
    title: draft.title?.trim() || draft.pageTitle || "Untitled bug",
    description: draft.description?.trim() ?? "",
    status: "open",
    severity: (draft.severity ?? "medium") as BugSeverity,
    tags: draft.tags ?? [],
    pageUrl: draft.pageUrl,
    reporter,
    assignee: (draft.assigneeId ? people.find((p) => p.id === draft.assigneeId) : null) ?? null,
    createdAt: now,
    updatedAt: now,
    durationMs: t1 - t0,
    scenario: draft.scenario,
    replay,
    markers: clip(draft.markers, lower, t1, t0),
    visits,
    console: clip(draft.console, lower, t1, t0),
    network: clip(draft.network, lower, t1, t0),
    pickedElements: clip(
      draft.pickedElements.map((p) => ({ ...p, t: p.t ?? 0 })),
      t0,
      t1,
      t0,
    ),
    environment: draft.environment,
    perf: draft.perf,
    preRollMs: draft.trim ? undefined : draft.preRollMs,
    draftId: draft.id,
    notes: draft.notes,
    env: draft.env ?? envFromUrl(draft.pageUrl),
    initiative: draft.initiative?.trim() || undefined,
    initiativeId: draft.initiativeId || undefined,
    // A name typed in the extension counts as much as a picked id — the mirror needs a
    // dashboard tab to have been open, and that shouldn't decide what kind of bug this is.
    category: draft.initiativeId || draft.initiative?.trim() ? "initiative" : "production",
    jobId: draft.jobId?.trim() || undefined,
    credentials:
      draft.credentials && (draft.credentials.username || draft.credentials.password || draft.credentials.notes)
        ? draft.credentials
        : undefined,
    events: [{ id: "e0", actor: reporter.name, kind: "created", detail: "reported this bug via the extension", at: now }],
    // The rrweb stream keeps its full length (the DOM snapshot lives at the start); the
    // trim start becomes a playback offset instead.
    rrweb: draft.rrweb,
    rrwebFileId: draft.rrwebFileId,
    videoFileId: draft.videoFileId,
    // Shots keep their own `t`; they are evidence about a moment, not part of the event stream,
    // so trimming does not discard them.
    shots: draft.shots,
    // Same rule as shots: point-in-time evidence, not part of the event stream — trimming
    // never discards it.
    layoutDebug: draft.layoutDebug,
    appInfo: draft.appInfo,
    captureSchemaVersion: draft.captureSchemaVersion,
    debugState: draft.debugState,
    rrwebOffset: draft.rrweb || draft.rrwebFileId ? t0 : undefined,
    // Carried whole, never clipped. State changes are deltas from a baseline captured at t=0,
    // so dropping the ones before the trim start would leave the rest replaying onto a state
    // that never existed — the same reason the rrweb stream keeps its full length above. The
    // snapshots and the HAR are point-in-time evidence, like shots.
    ...pickDeepCapture(draft),
  };
}
