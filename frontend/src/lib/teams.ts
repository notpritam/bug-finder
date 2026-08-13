// ABOUTME: Teams — the group a person belongs to (Frontend, Retention, NDR, Growth) and the
// ABOUTME: sessions filed by its members. API client only; the scoping itself is the server's job,
// ABOUTME: because a filter the client applies is a filter the client can forget to apply.
import type { Bug } from "./types";
import { authToken } from "./auth";

const BASE = import.meta.env.REACT_APP_BACKEND_URL as string | undefined;

/** Reads stay open — a guest reporter choosing who their capture belongs to is a flow worth
 *  keeping. Writes carry the token and let the server's 401 surface in the normal error path. */
function authHeaders(): Record<string, string> {
  const token = authToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export interface Team {
  id: string;
  name: string;
  /** Punctuation- and case-free handle. Two teams can never share one. */
  slug: string;
  description: string;
  createdAt?: number;
  createdBy?: { id?: string; name?: string };
  memberCount?: number;
  /** Whether the caller is in it — resolved server-side, including via the legacy `team` string. */
  joined?: boolean;
  /** Only on create: the name already existed and you were joined to it instead. */
  alreadyExisted?: boolean;
}

export interface TeamDetail extends Team {
  members: { id: string; name: string; email: string; role: string }[];
}

async function fail(res: Response, fallback: string): Promise<never> {
  const detail = (await res.json().catch(() => null))?.detail;
  throw new Error(typeof detail === "string" ? detail : fallback);
}

export async function listTeams(): Promise<Team[]> {
  if (!BASE) return [];
  const res = await fetch(`${BASE}/api/teams`, { headers: authHeaders() });
  if (!res.ok) return [];
  return (await res.json()) as Team[];
}

export async function getTeam(id: string): Promise<TeamDetail | null> {
  if (!BASE) return null;
  const res = await fetch(`${BASE}/api/teams/${encodeURIComponent(id)}`, { headers: authHeaders() });
  if (!res.ok) return null;
  return (await res.json()) as TeamDetail;
}

/** Creating a team joins you to it. A name that already exists joins that one instead of
 *  duplicating it — check `alreadyExisted` if you want to say so. */
export async function createTeam(name: string, description = ""): Promise<Team> {
  if (!BASE) throw new Error("No backend configured — teams need one.");
  const res = await fetch(`${BASE}/api/teams`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ name, description }),
  });
  if (!res.ok) return fail(res, "Could not create that team.");
  return (await res.json()) as Team;
}

async function membership(id: string, action: "join" | "leave"): Promise<void> {
  if (!BASE) throw new Error("No backend configured — teams need one.");
  const res = await fetch(`${BASE}/api/teams/${encodeURIComponent(id)}/${action}`, {
    method: "POST",
    headers: authHeaders(),
  });
  if (!res.ok) await fail(res, action === "join" ? "Could not join that team." : "Could not leave that team.");
}

export const joinTeam = (id: string) => membership(id, "join");
export const leaveTeam = (id: string) => membership(id, "leave");

export async function renameTeam(id: string, patch: { name?: string; description?: string }): Promise<Team> {
  if (!BASE) throw new Error("No backend configured — teams need one.");
  const res = await fetch(`${BASE}/api/teams/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(patch),
  });
  if (!res.ok) return fail(res, "Could not rename that team.");
  return (await res.json()) as Team;
}

/** This team's filed sessions, newest first. Scoped by the server: `teamIds` is stamped on a
 *  session when it is filed, so this is a real query rather than a client-side guess. */
export async function teamSessions(id: string): Promise<Bug[]> {
  if (!BASE) return [];
  const res = await fetch(`${BASE}/api/teams/${encodeURIComponent(id)}/sessions`);
  if (!res.ok) return [];
  return (await res.json()) as Bug[];
}
