// ABOUTME: Client for the change feed — what moved on the sessions and initiatives you follow.
// ABOUTME: Polling, because the server is honest about being a poll underneath (standalone Mongo,
// ABOUTME: two replicas, and the newest MCP revision has no push channel at all). One request every
// ABOUTME: interval beats a held-open connection per viewer for a second of latency.
import { authToken } from "./auth";

const BASE = import.meta.env.REACT_APP_BACKEND_URL as string | undefined;

export type UpdateKind = "comment" | "bug_filed" | "status" | "severity" | "assignment" | "evidence";

export interface FeedUpdate {
  at: number;
  kind: UpdateKind;
  summary: string;
  bugHumanId?: string | null;
  initiativeId?: string | null;
  actorName?: string | null;
}

export interface Following {
  initiatives: string[];
  sessions: string[];
}

/** Every kind the feed can emit, with the label the preferences list shows. Kept here so the
 *  filter UI and the server's EVENT_KINDS cannot drift into disagreeing about what exists. */
export const UPDATE_KINDS: { key: UpdateKind; label: string }[] = [
  { key: "comment", label: "Comments" },
  { key: "bug_filed", label: "New sessions" },
  { key: "status", label: "Status changes" },
  { key: "severity", label: "Severity changes" },
  { key: "assignment", label: "Assignments" },
  { key: "evidence", label: "New evidence" },
];

function headers(): HeadersInit {
  const token = authToken();
  return token ? { Authorization: "Bearer " + token } : {};
}

export async function fetchUpdates(opts: { since?: number; initiativeId?: string; humanId?: string } = {}) {
  if (!BASE) return { count: 0, since: 0, updates: [] as FeedUpdate[] };
  const q = new URLSearchParams();
  if (opts.since) q.set("since", String(opts.since));
  if (opts.initiativeId) q.set("initiativeId", opts.initiativeId);
  if (opts.humanId) q.set("humanId", opts.humanId);
  try {
    const res = await fetch(`${BASE}/api/updates?${q}`, { headers: headers() });
    if (!res.ok) return { count: 0, since: 0, updates: [] as FeedUpdate[] };
    return (await res.json()) as { count: number; since: number; updates: FeedUpdate[] };
  } catch {
    // A dropped poll is not worth surfacing — the next one is a few seconds away.
    return { count: 0, since: 0, updates: [] as FeedUpdate[] };
  }
}

export async function markRead(at: number): Promise<void> {
  if (!BASE) return;
  try {
    await fetch(`${BASE}/api/updates/read?at=${at}`, { method: "POST", headers: headers() });
  } catch {
    /* the bell will simply still show a count */
  }
}

export async function fetchFollowing(): Promise<Following> {
  const empty: Following = { initiatives: [], sessions: [] };
  if (!BASE) return empty;
  try {
    const res = await fetch(`${BASE}/api/updates/following`, { headers: headers() });
    return res.ok ? ((await res.json()) as Following) : empty;
  } catch {
    return empty;
  }
}

export async function setWatching(
  target: { initiativeId?: string; humanId?: string },
  following: boolean,
): Promise<Following> {
  const empty: Following = { initiatives: [], sessions: [] };
  if (!BASE) return empty;
  const q = new URLSearchParams();
  if (target.initiativeId) q.set("initiativeId", target.initiativeId);
  if (target.humanId) q.set("humanId", target.humanId);
  if (!following) q.set("stop", "true");
  try {
    const res = await fetch(`${BASE}/api/updates/watch?${q}`, { method: "POST", headers: headers() });
    if (!res.ok) return empty;
    return ((await res.json()) as { following: Following }).following;
  } catch {
    return empty;
  }
}

/* ---------------- local preferences ---------------- */

const PREFS_KEY = "bf.update-prefs";

export interface UpdatePrefs {
  kinds: UpdateKind[];
  pollSeconds: number;
}

/** Filtering client-side on purpose: which kinds a person wants to see is a display preference,
 *  and putting it on the server would mean the count in the bell and the rows in the panel could
 *  disagree the moment two tabs held different settings. */
export const DEFAULT_PREFS: UpdatePrefs = {
  kinds: UPDATE_KINDS.map((k) => k.key),
  pollSeconds: 30,
};

export function loadPrefs(): UpdatePrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) || "null");
    if (!raw || !Array.isArray(raw.kinds)) return DEFAULT_PREFS;
    return {
      kinds: raw.kinds.filter((k: string) => UPDATE_KINDS.some((u) => u.key === k)),
      pollSeconds: Math.min(Math.max(Number(raw.pollSeconds) || 30, 10), 300),
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function savePrefs(prefs: UpdatePrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* private mode — the defaults are fine */
  }
}
