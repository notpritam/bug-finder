// ABOUTME: Client for the dashboard's own bug endpoints — publish snapshots, poll for
// ABOUTME: agent comments, and copy the "agent share" URL that identifies this bug.
import type { Bug } from "./types";

const BASE = import.meta.env.REACT_APP_BACKEND_URL as string | undefined;

export interface AgentComment {
  id: string;
  bugHumanId: string;
  actor: string;
  kind: string;
  body: string;
  at: number;
  source: "agent" | "dashboard";
}

export function agentShareUrl(humanId: string): string {
  return `${BASE ?? ""}/api/mcp/bugs/${humanId}`;
}

/** Fire-and-forget upsert of the current bug snapshot. Errors are swallowed —
 *  agent sync is best-effort and never blocks the user. */
export function publishBug(bug: Bug): void {
  if (!BASE) return;
  void fetch(`${BASE}/api/bugs/${bug.humanId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(bug),
  }).catch(() => undefined);
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
