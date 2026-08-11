// ABOUTME: Admin API client — the team roster with its usage counts, creating a teammate's
// ABOUTME: account, editing role/team, granting or revoking admin, and deleting an account.
// ABOUTME: Every call is admin-gated server-side; a 403 here means the server said no.
import { authToken } from "./auth";

const BASE = import.meta.env.REACT_APP_BACKEND_URL as string | undefined;

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: string;
  team: string;
  isAdmin: boolean;
  /** Admin granted in code rather than in the database — the UI cannot revoke it. */
  isBootstrapAdmin: boolean;
  createdAt: number | null;
  assignedCount: number;
  reportedCount: number;
}

export interface DeleteResult {
  ok: true;
  deleted: { id: string; name: string; email: string };
  bugsUnassigned: number;
  initiativesReassigned: number;
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = authToken();
  if (!BASE) throw new Error("The dashboard has no backend configured.");
  if (!token) throw new Error("Sign in to do that.");
  const res = await fetch(BASE + path, {
    ...init,
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      Authorization: "Bearer " + token,
      ...(init.headers ?? {}),
    },
  });
  const data = (await res.json().catch(() => ({}))) as { detail?: string } & T;
  if (!res.ok) throw new Error(data.detail || "Something went wrong. Try again.");
  return data;
}

export function listUsers(): Promise<AdminUser[]> {
  return call<AdminUser[]>("/api/admin/users");
}

export function createUser(input: {
  name: string;
  email: string;
  password: string;
  role: string;
  team: string;
  isAdmin: boolean;
}): Promise<AdminUser> {
  return call<AdminUser>("/api/admin/users", { method: "POST", body: JSON.stringify(input) });
}

export function patchUser(
  id: string,
  patch: { name?: string; role?: string; team?: string; isAdmin?: boolean },
): Promise<AdminUser> {
  return call<AdminUser>(`/api/admin/users/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
}

export function deleteUser(id: string): Promise<DeleteResult> {
  return call<DeleteResult>(`/api/admin/users/${id}`, { method: "DELETE" });
}

export function deleteInitiative(id: string): Promise<{ ok: true }> {
  return call<{ ok: true }>(`/api/initiatives/${id}`, { method: "DELETE" });
}
