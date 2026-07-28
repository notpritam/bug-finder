// ABOUTME: Local account system (registry + session in localStorage) until a real backend
// ABOUTME: exists. Passwords are SHA-256 hashed; the session snapshot is what the extension reads.
import type { Role } from "./meta";
import type { Reporter } from "./types";

export interface AuthUser extends Reporter {
  role: Role;
  team: string;
}

interface StoredUser extends AuthUser {
  passwordHash: string;
}

const USERS_KEY = "bf.users";
/** Session snapshot — also read by the extension's bridge content script to gate recording. */
const SESSION_KEY = "bf.session-user";

async function hash(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function loadUsers(): StoredUser[] {
  try {
    return JSON.parse(localStorage.getItem(USERS_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function saveUsers(users: StoredUser[]) {
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

function setSession(user: AuthUser | null) {
  if (user) localStorage.setItem(SESSION_KEY, JSON.stringify(user));
  else localStorage.removeItem(SESSION_KEY);
  // Nudge the extension bridge (when the dashboard tab hosts one) to re-sync.
  window.postMessage({ source: "bugfinder-dashboard", type: "user-sync" }, "*");
}

export function loadSession(): AuthUser | null {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) ?? "null");
  } catch {
    return null;
  }
}

export async function signUp(input: {
  name: string;
  email: string;
  password: string;
  role: Role;
  team: string;
}): Promise<AuthUser> {
  const email = input.email.trim().toLowerCase();
  if (!input.name.trim()) throw new Error("Name is required.");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("Enter a valid email address.");
  if (input.password.length < 6) throw new Error("Password needs at least 6 characters.");
  const users = loadUsers();
  if (users.some((u) => u.email === email)) throw new Error("An account with this email already exists — sign in instead.");
  const user: StoredUser = {
    id: `u-${Date.now().toString(36)}`,
    name: input.name.trim(),
    email,
    role: input.role,
    team: input.team,
    passwordHash: await hash(input.password),
  };
  saveUsers([...users, user]);
  const { passwordHash: _ph, ...session } = user;
  setSession(session);
  return session;
}

export async function signIn(email: string, password: string): Promise<AuthUser> {
  const users = loadUsers();
  const user = users.find((u) => u.email === email.trim().toLowerCase());
  if (!user || user.passwordHash !== (await hash(password))) {
    throw new Error("Wrong email or password.");
  }
  const { passwordHash: _ph, ...session } = user;
  setSession(session);
  return session;
}

export function signOut() {
  setSession(null);
}

/** Everyone with an account — assignee options alongside the demo roster. */
export function listAccountUsers(): AuthUser[] {
  return loadUsers().map(({ passwordHash: _ph, ...u }) => u);
}
