// ABOUTME: Client for the /api/ai/draft-fill backend endpoint (Claude Sonnet 4.5).
// ABOUTME: Turns a captured draft's raw evidence into suggested title/description/tags/etc.
import type { Draft, Reporter } from "./types";
import { authToken } from "./auth";

const BASE = import.meta.env.REACT_APP_BACKEND_URL as string | undefined;

export interface DraftFillResponse {
  title?: string | null;
  description?: string | null;
  severity?: "low" | "medium" | "high" | "critical" | null;
  tags: string[];
  assigneeId?: string | null;
  assigneeReason?: string | null;
  initiative?: string | null;
}

export type FillField = "all" | "title" | "description" | "severity" | "tags" | "assignee" | "initiative";

/** Ask the backend to auto-fill (all or a single field). Errors bubble up to the caller. */
export async function aiDraftFill(opts: {
  draft: Draft;
  allowedTags: string[];
  initiatives: string[];
  team: Reporter[];
  field?: FillField;
}): Promise<DraftFillResponse> {
  if (!BASE) throw new Error("REACT_APP_BACKEND_URL not configured");

  const { draft } = opts;
  const consoleErrors = draft.console
    .filter((c) => c.level === "error" || c.level === "warn")
    .slice(0, 20)
    .map((c) => ({ level: c.level, text: c.text }));
  const networkErrors = draft.network
    .filter((n) => n.status >= 400)
    .slice(0, 20)
    .map((n) => ({ method: n.method, url: n.url, status: n.status }));
  const pickedElements = draft.pickedElements.slice(0, 10).map((p) => ({
    tag: p.tag,
    selector: p.selector,
    text: p.text,
  }));

  const body = {
    pageUrl: draft.pageUrl,
    pageTitle: draft.pageTitle,
    notes: draft.notes ?? "",
    consoleErrors,
    networkErrors,
    pickedElements,
    allowedTags: opts.allowedTags,
    initiatives: opts.initiatives,
    team: opts.team.map((r) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      role: r.role,
      team: r.team,
    })),
    field: opts.field && opts.field !== "all" ? opts.field : null,
    // Always send the current draft — Claude uses it as the reporter's own words.
    current: {
      title: draft.title ?? "",
      description: draft.description ?? "",
      severity: draft.severity ?? null,
      tags: draft.tags ?? [],
      initiative: draft.initiative ?? "",
      assigneeId: draft.assigneeId ?? null,
    },
  };

  // The endpoint spends money on every call, so the backend requires a signed-in caller. Same
  // bearer token the publish/allocate/delete writes send.
  const token = authToken();
  const res = await fetch(`${BASE}/api/ai/draft-fill`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`AI fill failed (${res.status}): ${detail.slice(0, 200)}`);
  }
  return (await res.json()) as DraftFillResponse;
}
