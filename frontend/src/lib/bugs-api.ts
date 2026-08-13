// ABOUTME: Client for the dashboard's own bug endpoints — publish snapshots, poll for
// ABOUTME: agent comments, and copy the "agent share" URL that identifies this bug.
import type { Annotation, Bug } from "./types";
import { authToken } from "./auth";

const BASE = import.meta.env.REACT_APP_BACKEND_URL as string | undefined;

/** Bearer token for WRITE endpoints (PUT/POST/DELETE). Reads stay open by design — agents
 *  consume them without accounts. Sent even before the backend enforces it (harmless), and
 *  when no one is signed in the request still goes out so the server's 401 surfaces as a
 *  visible publish failure rather than a silent local decision. */
function authHeaders(): Record<string, string> {
  const token = authToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * A block of a structured finding. `html` on the three prose kinds was sanitised by the server at
 * write time — that is the only reason it is safe to render, so do not build these client-side and
 * do not widen this union without adding the matching server-side validation.
 */
export type CommentBlock =
  | { type: "markdown"; html: string }
  | { type: "callout"; level: "info" | "warn" | "error" | "success"; title?: string; html: string }
  | { type: "html"; html: string }
  | { type: "code"; lang?: string; src: string; highlight?: number[]; caption?: string }
  | { type: "diagram"; lang: "mermaid"; src: string; caption?: string }
  | { type: "table"; columns: string[]; rows: string[][]; caption?: string }
  | { type: "keyvalue"; items: { k: string; v: string; mono?: boolean }[]; caption?: string }
  | {
      type: "evidence";
      ref: { kind: string; index?: number; t?: number; selector?: string };
      note?: string;
    };

export interface AgentComment {
  id: string;
  bugHumanId: string;
  actor: string;
  kind: string;
  body: string;
  at: number;
  source: "agent" | "dashboard";
  /** Always present — the server synthesises one from `body` for comments predating blocks. */
  blocks: CommentBlock[];
}

/**
 * Ask the server for the next bug number.
 *
 * Numbers were computed in the browser from whatever bugs that browser happened to hold, so a
 * fresh profile restarted at BF-101 and its publish silently overwrote someone else's bug. The
 * server allocates atomically, and passing `draftId` makes it idempotent — a retried filing gets
 * the id it already has rather than burning a new one.
 *
 * Returns null when the server cannot be reached, so the caller can fall back to local numbering
 * and still let someone file offline.
 */
export async function allocateHumanId(draftId: string): Promise<string | null> {
  if (!BASE) return null;
  try {
    const res = await fetch(`${BASE}/api/bugs/allocate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ draftId }),
    });
    if (!res.ok) return null;
    const { humanId } = (await res.json()) as { humanId?: string };
    return humanId ?? null;
  } catch {
    return null;
  }
}

export function agentShareUrl(humanId: string): string {
  return `${BASE ?? ""}/api/mcp/bugs/${humanId}`;
}

/**
 * The MCP endpoint an agent connects to. Falls back to the page's own origin so a deployment that
 * never set REACT_APP_BACKEND_URL still shows a working address rather than a bare path — this
 * string gets pasted into a terminal, where a relative URL is not an address at all.
 */
export function mcpEndpointUrl(): string {
  return `${BASE || window.location.origin}/api/mcp`;
}

/** Raised when the server rejected the snapshot. Publishing stays non-blocking, but it must not
 *  be silent: a bug that looks filed and exists only in this browser is the worst outcome this
 *  product can produce, and swallowing the error is exactly how BF-102..106 went missing. */
export class PublishFailed extends Error {
  status: number;
  humanId: string;
  bytes: number;

  constructor(status: number, humanId: string, bytes: number, message: string) {
    super(message);
    this.name = "PublishFailed";
    this.status = status;
    this.humanId = humanId;
    this.bytes = bytes;
  }
}

/** MongoDB refuses any document over 16MB, and the backend surfaces that as a 500. Checking here
 *  turns an opaque server error into a diagnosable one. */
export const MONGO_DOC_LIMIT = 16 * 1024 * 1024;

/** Upsert the snapshot agents read. Resolves true when the server accepted it, false when there
 *  is no backend to publish to; rejects (PublishFailed) when the server refused it — callers
 *  surface that to the user instead of letting a bug quietly exist in one browser only. */
export async function publishBug(bug: Bug): Promise<boolean> {
  if (!BASE) return false;
  const body = JSON.stringify(bug);
  if (body.length > MONGO_DOC_LIMIT) {
    throw new PublishFailed(
      413,
      bug.humanId,
      body.length,
      `Capture is ${(body.length / 1e6).toFixed(1)}MB — over the 16MB document limit. Evidence must be offloaded to files before it can be saved.`,
    );
  }
  const res = await fetch(`${BASE}/api/bugs/${bug.humanId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body,
  });
  if (!res.ok) {
    throw new PublishFailed(res.status, bug.humanId, body.length, `Server refused the snapshot (HTTP ${res.status}).`);
  }
  return true;
}

/** Drop the snapshot agents read. Best-effort like publishing — the local delete is what the
 *  user sees, and a failure here must not leave the UI pretending nothing happened. */
export function unpublishBug(humanId: string): void {
  if (!BASE) return;
  void fetch(`${BASE}/api/bugs/${humanId}`, { method: "DELETE", headers: authHeaders() }).catch(() => undefined);
}

export async function fetchAgentComments(humanId: string, sinceMs = 0): Promise<AgentComment[]> {
  if (!BASE) return [];
  const res = await fetch(
    `${BASE}/api/bugs/${humanId}/comments?since=${sinceMs}`,
    { headers: { Accept: "application/json" } },
  );
  if (!res.ok) return [];
  return (await res.json()) as AgentComment[];
}

/**
 * Every filed session the team can see, newest first, without the heavy evidence.
 *
 * The dashboard used to render only what its own IndexedDB held, which made it a private notebook:
 * two people on two machines each saw a different subset of the same project. Reads stay open so a
 * shared link works before anyone signs in.
 */
export async function listBugs(): Promise<Bug[]> {
  if (!BASE) return [];
  try {
    const res = await fetch(`${BASE}/api/bugs`, { headers: { Accept: "application/json" } });
    return res.ok ? ((await res.json()) as Bug[]) : [];
  } catch {
    return []; // offline: the local rows are still there, so show those rather than nothing
  }
}

/** One session with its evidence resolved — what a teammate's capture needs before it can be read,
 *  since the list deliberately omits the recording, network bodies and console. */
export async function fetchBug(humanId: string): Promise<Bug | null> {
  if (!BASE) return null;
  try {
    const res = await fetch(`${BASE}/api/bugs/${humanId}`, { headers: { Accept: "application/json" } });
    return res.ok ? ((await res.json()) as Bug) : null;
  } catch {
    return null;
  }
}

/** Change named fields on a filed session. Field-level on purpose: republishing the whole snapshot
 *  on every edit is what let one person's change silently revert another's. */
export async function patchBug(humanId: string, patch: Record<string, unknown>): Promise<Bug | null> {
  if (!BASE || !Object.keys(patch).length) return null;
  try {
    const res = await fetch(`${BASE}/api/bugs/${humanId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(patch),
    });
    return res.ok ? ((await res.json()) as Bug) : null;
  } catch {
    return null;
  }
}

/** Post to the shared thread. The server names the author from the token, so a comment always
 *  carries the account that actually wrote it. */
export async function postComment(humanId: string, body: string): Promise<AgentComment | null> {
  if (!BASE) return null;
  try {
    const res = await fetch(`${BASE}/api/bugs/${humanId}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ body, kind: "comment" }),
    });
    return res.ok ? ((await res.json()) as AgentComment) : null;
  } catch {
    return null;
  }
}

/* ---------------- annotations ---------------- */

/**
 * Flags added to a session after it was filed.
 *
 * These go to the server directly rather than through the bug snapshot, and that is the point: a
 * snapshot PUT rewrites the whole document, which is how two people editing one session used to
 * silently revert each other. Each call here appends, edits, or removes exactly one entry.
 *
 * Every one throws on failure. An annotation that fails to save must not look like one that saved —
 * the caller shows the error and puts the text back, because the alternative is a reviewer who
 * believes they left a note that nobody will ever see.
 */
async function annotationCall<T>(path: string, init: RequestInit): Promise<T> {
  if (!BASE) throw new Error("No backend configured — annotations need one.");
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...authHeaders(), ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    // The server's own words where it gave any — "Sign in to do that." and "You can only edit
    // annotations you added." are both better than anything this layer could invent.
    const detail = await res.json().then((b) => b?.detail).catch(() => null);
    throw new Error(typeof detail === "string" ? detail : `Could not save that (${res.status}).`);
  }
  return (await res.json()) as T;
}

export const addAnnotation = (humanId: string, t: number, label: string): Promise<Annotation> =>
  annotationCall<Annotation>(`/api/bugs/${encodeURIComponent(humanId)}/annotations`, {
    method: "POST",
    body: JSON.stringify({ t: Math.round(t), label }),
  });

export const editAnnotation = (humanId: string, id: string, label: string): Promise<Annotation> =>
  annotationCall<Annotation>(`/api/bugs/${encodeURIComponent(humanId)}/annotations/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ label }),
  });

export const deleteAnnotation = (humanId: string, id: string): Promise<{ ok: string }> =>
  annotationCall<{ ok: string }>(`/api/bugs/${encodeURIComponent(humanId)}/annotations/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
