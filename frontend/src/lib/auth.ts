// ABOUTME: Accounts, served by the backend. Previously a localStorage-only registry: accounts
// ABOUTME: existed per-browser (so a password "worked" on one machine and nowhere else),
// ABOUTME: passwords were unsalted SHA-256, and admin was decided by client code anyone could
// ABOUTME: edit. The session snapshot in localStorage stays because the extension bridge reads it
// ABOUTME: to attribute captures - it is now a cache of the server's answer, not the truth.
import type { Role } from "./meta";
import type { Reporter } from "./types";

export interface AuthUser extends Reporter {
  role: Role;
  team: string;
  isAdmin?: boolean;
}

/** Stand-in reporter for submissions made without an account. */
export const ANONYMOUS: Reporter = { id: "anon", name: "Anonymous", email: "" };

const BASE = import.meta.env.REACT_APP_BACKEND_URL as string | undefined;
const SESSION_KEY = "bf.session-user";
const TOKEN_KEY = "bf.session-token";

/** Admin comes from the server now, which the client cannot edit. This local read only hides
 *  controls; the server is what actually decides. */
export function isAdmin(user: { isAdmin?: boolean } | null | undefined): boolean {
  return Boolean(user?.isAdmin);
}

export function authToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

function setSession(user: AuthUser | null, token?: string | null) {
  if (user) localStorage.setItem(SESSION_KEY, JSON.stringify(user));
  else localStorage.removeItem(SESSION_KEY);
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else if (token === null) localStorage.removeItem(TOKEN_KEY);
  window.postMessage({ source: "bugfinder-dashboard", type: "user-sync" }, "*");
}

/** The cached session, for a synchronous first paint. verifySession() confirms it against the
 *  server afterwards, so a revoked or expired token cannot keep someone signed in forever. */
export function loadSession(): AuthUser | null {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) ?? "null");
  } catch {
    return null;
  }
}

async function call<T>(path: string, body: unknown): Promise<T> {
  if (!BASE) throw new Error("Accounts are unavailable: the dashboard has no backend configured.");
  const res = await fetch(BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { detail?: string } & T;
  if (!res.ok) throw new Error(data.detail || "Something went wrong. Try again.");
  return data;
}

export async function signUp(input: {
  name: string;
  email: string;
  password: string;
  role: Role;
  team: string;
}): Promise<AuthUser> {
  if (input.password.length < 8) throw new Error("Password needs at least 8 characters.");
  const { token, user } = await call<{ token: string; user: AuthUser }>("/api/auth/register", {
    name: input.name.trim(),
    email: input.email.trim().toLowerCase(),
    password: input.password,
    role: input.role,
    team: input.team,
  });
  setSession(user, token);
  return user;
}

export async function signIn(email: string, password: string): Promise<AuthUser> {
  const { token, user } = await call<{ token: string; user: AuthUser }>("/api/auth/login", {
    email: email.trim().toLowerCase(),
    password,
  });
  setSession(user, token);
  return user;
}

export function signOut() {
  setSession(null, null);
}

/** Confirm the cached session is still real. Clears it when the server disowns the token, so the
 *  UI never presents someone as signed in to an account that no longer exists. */
export async function verifySession(): Promise<AuthUser | null> {
  const token = authToken();
  if (!BASE) return null;
  if (!token) {
    // A cached session with no token is a leftover from the localStorage-only auth this replaced.
    // It cannot authenticate anything: every write 401s while the UI still presents someone as
    // signed in, and admin-gated controls stay invisible because the stale snapshot has no
    // isAdmin. Clearing it is the only honest option — sign in again and get a real one.
    if (loadSession()) setSession(null, null);
    return null;
  }
  try {
    const res = await fetch(BASE + "/api/auth/me", { headers: { Authorization: "Bearer " + token } });
    if (!res.ok) {
      setSession(null, null);
      return null;
    }
    const user = (await res.json()) as AuthUser;
    setSession(user, token);
    return user;
  } catch {
    // Offline: keep the cached session rather than signing someone out over a flaky network.
    return loadSession();
  }
}

/** Everyone with an account - assignee options. */
export async function listAccountUsers(): Promise<AuthUser[]> {
  const token = authToken();
  if (!token || !BASE) return [];
  try {
    const res = await fetch(BASE + "/api/auth/users", { headers: { Authorization: "Bearer " + token } });
    return res.ok ? ((await res.json()) as AuthUser[]) : [];
  } catch {
    return [];
  }
}
