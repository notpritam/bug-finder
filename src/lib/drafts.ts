// ABOUTME: Draft persistence + conversion — localStorage-backed until the real API exists.
// ABOUTME: Accepts extension payloads, seeds one demo draft, and turns a reviewed draft into a Bug.
import type { Bug, BugSeverity, Draft, ReplayEvent } from "./types";
import { BUGS, ME } from "./data";

import { idb } from "./store";

const DRAFTS_KEY = "bf.drafts";
const SUBMITTED_KEY = "bf.submitted";
const SEEDED_KEY = "bf.drafts.seeded";

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
  if (drafts.length === 0 && !localStorage.getItem(SEEDED_KEY)) {
    localStorage.setItem(SEEDED_KEY, "1");
    const demo = demoDraft();
    await idb.put("drafts", demo);
    return [demo];
  }
  return drafts.sort((a, b) => b.createdAt - a.createdAt);
}

export function persistDraft(draft: Draft) {
  void idb.put("drafts", draft);
}

export function removeDraft(id: string) {
  void idb.delete("drafts", id);
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
  return bugs.sort((a, b) => b.createdAt - a.createdAt);
}

export function persistSubmittedBug(bug: Bug) {
  void idb.put("bugs", bug);
}

/** The extension's DraftPayload → our Draft. Shapes already align; fill in dashboard-only fields. */
export function draftFromExtension(payload: Record<string, unknown>): Draft {
  const env = (payload.environment ?? {}) as Draft["environment"];
  return {
    id: String(payload.id ?? `d-${Date.now().toString(36)}`),
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
    notes: payload.notes ? String(payload.notes) : undefined,
    rrweb: Array.isArray(payload.rrweb) && payload.rrweb.length > 1 ? (payload.rrweb as unknown[]) : undefined,
    rrwebFileId: payload.rrwebFileId ? String(payload.rrwebFileId) : undefined,
  };
}

/** Clip an event list to [in, out] and re-zero timestamps. */
function clip<T extends { t: number }>(items: T[], t0: number, t1: number): T[] {
  return items.filter((i) => i.t >= t0 && i.t <= t1).map((i) => ({ ...i, t: i.t - t0 }));
}

let submitSeq = 0;

/** A reviewed draft → a filed Bug. Applies the trim window and stamps identity/history. */
export function bugFromDraft(draft: Draft, existing: Bug[]): Bug {
  const t0 = draft.trim?.in ?? 0;
  const t1 = draft.trim?.out ?? draft.durationMs;
  const maxNum = Math.max(100, ...existing.map((b) => Number(b.humanId.split("-")[1]) || 100));
  const now = Date.now();

  // Keep the last visit at-or-before the trim start so the replay knows its starting URL.
  const visitsBefore = draft.visits.filter((v) => v.t <= t0);
  const startVisit = visitsBefore[visitsBefore.length - 1];
  const visits = [
    ...(startVisit ? [{ ...startVisit, t: 0 }] : []),
    ...clip(draft.visits.filter((v) => v.t > t0), t0, t1),
  ];

  // Same for replay nav events: the stage needs a nav at t=0 to know which page it starts on.
  const replay = clip(draft.replay, t0, t1) as ReplayEvent[];
  if (startVisit && !replay.some((e) => e.kind === "nav" && e.t === 0)) {
    replay.unshift({ t: 0, kind: "nav", url: startVisit.url });
  }

  return {
    id: `b-${now.toString(36)}-${submitSeq++}`,
    humanId: `BF-${maxNum + 1}`,
    title: draft.title?.trim() || draft.pageTitle || "Untitled bug",
    description: draft.description?.trim() ?? "",
    status: "open",
    severity: (draft.severity ?? "medium") as BugSeverity,
    tags: draft.tags ?? [],
    pageUrl: draft.pageUrl,
    reporter: ME,
    assignee: null,
    createdAt: now,
    updatedAt: now,
    durationMs: t1 - t0,
    scenario: draft.scenario,
    replay,
    markers: clip(draft.markers, t0, t1),
    visits,
    console: clip(draft.console, t0, t1),
    network: clip(draft.network, t0, t1),
    pickedElements: clip(
      draft.pickedElements.map((p) => ({ ...p, t: p.t ?? 0 })),
      t0,
      t1,
    ),
    environment: draft.environment,
    notes: draft.notes,
    events: [{ id: "e0", actor: ME.name, kind: "created", detail: "reported this bug via the extension", at: now }],
    // The rrweb stream keeps its full length (the DOM snapshot lives at the start); the
    // trim start becomes a playback offset instead.
    rrweb: draft.rrweb,
    rrwebFileId: draft.rrwebFileId,
    rrwebOffset: draft.rrweb || draft.rrwebFileId ? t0 : undefined,
  };
}

/** One seeded example so the draft flow is explorable before the extension is installed. */
function demoDraft(): Draft {
  const src = BUGS.find((b) => b.humanId === "BF-103")!;
  return {
    id: "d-demo",
    createdAt: Date.now() - 6 * 60_000,
    pageUrl: src.pageUrl,
    pageTitle: "Profile settings · Acme",
    durationMs: src.durationMs,
    scenario: src.scenario,
    replay: src.replay,
    console: src.console,
    network: src.network,
    pickedElements: src.pickedElements,
    markers: src.markers,
    visits: src.visits,
    environment: src.environment,
    notes: "Recorded while re-testing uploads on staging.",
  };
}
