// ABOUTME: Initiatives — shared units of dev work QA files bugs against. API client,
// ABOUTME: status metadata, and the metric math (quality score + dev scoreboard).
import type { Bug, Reporter } from "./types";

const BASE = import.meta.env.REACT_APP_BACKEND_URL as string | undefined;

export type InitiativeStatus = "in_qa" | "shipped" | "archived";

export interface Initiative {
  id: string;
  name: string;
  description: string;
  team: string | null;
  owner: Reporter;
  status: InitiativeStatus;
  createdAt: number;
  updatedAt: number;
  shippedAt: number | null;
}

export const INITIATIVE_STATUS_META: Record<InitiativeStatus, { label: string; color: string }> = {
  in_qa: { label: "In QA", color: "#0ea5e9" },
  shipped: { label: "Shipped", color: "#10b981" },
  archived: { label: "Archived", color: "#64748b" },
};

async function fail(res: Response, fallback: string): Promise<never> {
  const detail = (await res.json().catch(() => null))?.detail;
  throw new Error(typeof detail === "string" ? detail : fallback);
}

export async function listInitiatives(): Promise<Initiative[]> {
  if (!BASE) return [];
  const res = await fetch(`${BASE}/api/initiatives`);
  if (!res.ok) return [];
  return (await res.json()) as Initiative[];
}

export async function createInitiative(input: {
  name: string;
  description?: string;
  team?: string | null;
  owner: Reporter;
}): Promise<Initiative> {
  const res = await fetch(`${BASE}/api/initiatives`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: input.name,
      description: input.description ?? "",
      team: input.team ?? null,
      owner: { id: input.owner.id, name: input.owner.name, email: input.owner.email },
    }),
  });
  if (!res.ok) await fail(res, `Create failed (${res.status})`);
  return (await res.json()) as Initiative;
}

export async function updateInitiative(
  id: string,
  requesterId: string,
  patch: Partial<Pick<Initiative, "name" | "description" | "team" | "status">> & { owner?: Reporter },
): Promise<Initiative> {
  const body: Record<string, unknown> = { requesterId, ...patch };
  if (patch.owner) body.owner = { id: patch.owner.id, name: patch.owner.name, email: patch.owner.email };
  const res = await fetch(`${BASE}/api/initiatives/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) await fail(res, `Update failed (${res.status})`);
  return (await res.json()) as Initiative;
}

/** Bugs filed against this initiative (id match, with legacy name fallback). */
export function bugsForInitiative(bugs: Bug[], initiative: Initiative): Bug[] {
  return bugs.filter(
    (b) => b.initiativeId === initiative.id || (!b.initiativeId && b.initiative === initiative.name),
  );
}

export interface InitiativeMetrics {
  total: number;
  open: number;
  inProgress: number;
  fixed: number;
  /** not_a_bug + wont_fix — excluded from the quality math. */
  excluded: number;
  /** total − excluded: the bugs that actually count. */
  valid: number;
  /** fixed / valid (0..1) — null when there are no valid bugs yet. */
  score: number | null;
}

export function initiativeMetrics(bugs: Bug[]): InitiativeMetrics {
  const total = bugs.length;
  const open = bugs.filter((b) => b.status === "open").length;
  const inProgress = bugs.filter((b) => b.status === "in_progress").length;
  const fixed = bugs.filter((b) => b.status === "resolved").length;
  const excluded = bugs.filter((b) => b.status === "not_a_bug" || b.status === "wont_fix").length;
  const valid = total - excluded;
  return { total, open, inProgress, fixed, excluded, valid, score: valid > 0 ? fixed / valid : null };
}

export interface DevScore {
  owner: Reporter;
  initiatives: number;
  shipped: number;
  validBugs: number;
  fixed: number;
  fixRate: number | null;
  /** Valid bugs per initiative — lower is cleaner work. */
  avgBugs: number | null;
  /** Combined 0..100: cleanliness 50% + fix rate 50%. */
  score: number;
}

/** Per-dev scoreboard across their initiatives. Invalid reports never count against a dev. */
export function devScoreboard(initiatives: Initiative[], bugs: Bug[]): DevScore[] {
  const byOwner = new Map<string, { owner: Reporter; inis: Initiative[] }>();
  for (const ini of initiatives) {
    const entry = byOwner.get(ini.owner.id) ?? { owner: ini.owner, inis: [] };
    entry.inis.push(ini);
    byOwner.set(ini.owner.id, entry);
  }
  const rows: DevScore[] = [];
  for (const { owner, inis } of byOwner.values()) {
    let validBugs = 0;
    let fixed = 0;
    for (const ini of inis) {
      const m = initiativeMetrics(bugsForInitiative(bugs, ini));
      validBugs += m.valid;
      fixed += m.fixed;
    }
    const fixRate = validBugs > 0 ? fixed / validBugs : null;
    const avgBugs = inis.length > 0 ? validBugs / inis.length : null;
    const cleanliness = 1 / (1 + (avgBugs ?? 0));
    const score = Math.round(((fixRate ?? 1) * 50 + cleanliness * 50) * 10) / 10;
    rows.push({
      owner,
      initiatives: inis.length,
      shipped: inis.filter((i) => i.status === "shipped").length,
      validBugs,
      fixed,
      fixRate,
      avgBugs,
      score,
    });
  }
  return rows.sort((a, b) => b.score - a.score);
}
