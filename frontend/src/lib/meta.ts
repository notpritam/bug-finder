// ABOUTME: Shared org vocabulary — roles, teams, initiatives, preset tags, and environments
// ABOUTME: (with URL auto-detection). One place to grow as the org does.

export const ROLES = [
  "Frontend Developer",
  "Backend Developer",
  "Fullstack Developer",
  "Mobile App Developer",
  "QA Engineer",
  "Product Manager",
  "Engineering Manager",
  "Designer",
  "DevOps / SRE",
] as const;
export type Role = (typeof ROLES)[number];

export const DEFAULT_TEAMS = ["Platform", "Checkout", "Growth", "Mobile", "Infra"];
const TEAMS_KEY = "bf.teams";

export function listTeams(): string[] {
  try {
    const custom: string[] = JSON.parse(localStorage.getItem(TEAMS_KEY) ?? "[]");
    return [...new Set([...DEFAULT_TEAMS, ...custom])];
  } catch {
    return DEFAULT_TEAMS;
  }
}

export function addTeam(name: string) {
  const clean = name.trim();
  if (!clean) return;
  try {
    const custom: string[] = JSON.parse(localStorage.getItem(TEAMS_KEY) ?? "[]");
    if (!custom.includes(clean) && !DEFAULT_TEAMS.includes(clean)) {
      localStorage.setItem(TEAMS_KEY, JSON.stringify([...custom, clean]));
    }
  } catch {
    /* ignore */
  }
}

export const INITIATIVES = [
  "Checkout Revamp",
  "Mobile Launch",
  "Q3 Reliability",
  "Performance Sprint",
  "Onboarding Overhaul",
];

export const PRESET_TAGS = [
  "checkout",
  "payments",
  "auth",
  "ui",
  "api",
  "performance",
  "a11y",
  "mobile",
  "data",
  "regression",
];

export type Env = "prod" | "canary" | "staging" | "ephemeral" | "local" | "dev";

/**
 * Environment is CONTEXT, not status — so it no longer carries a hue.
 *
 * These six colours used to be hardcoded hexes that were byte-identical to the event tokens:
 * prod #ef4444 === --ev-error, canary #f59e0b === --ev-warn, staging #8b5cf6 === --ev-nav,
 * ephemeral #14b8a6 === --ev-net, dev #0ea5e9 === --ev-input. So on a session page a red dot
 * meant "Production" in the header and "error" in the inspector a few inches below it. Colour was
 * not reserved for data; it was reserved for three schemas that overwrote each other.
 *
 * `color` is kept on the type and points at a token, because a couple of call sites still want a
 * tint — but prod deliberately reuses the same neutral as the rest. Environment reads as a label.
 */
export const ENV_META: Record<Env, { label: string; color: string }> = {
  prod: { label: "Production", color: "var(--foreground)" },
  canary: { label: "Canary", color: "var(--muted-foreground)" },
  staging: { label: "Staging", color: "var(--muted-foreground)" },
  ephemeral: { label: "Ephemeral", color: "var(--muted-foreground)" },
  local: { label: "Local", color: "var(--muted-foreground)" },
  dev: { label: "Dev", color: "var(--muted-foreground)" },
};
export const ENVS = Object.keys(ENV_META) as Env[];

/** Best-effort environment from a captured URL — editable in the draft form. */
export function envFromUrl(url: string): Env {
  let host = "";
  try {
    host = new URL(url).host.toLowerCase();
  } catch {
    return "prod";
  }
  if (host.includes("localhost") || host.startsWith("127.") || host.endsWith(".local")) return "local";
  if (host.includes("canary")) return "canary";
  if (host.includes("staging") || host.includes("stg.")) return "staging";
  if (host.includes("eph") || host.includes("preview") || host.includes("pr-")) return "ephemeral";
  if (host.includes("dev.") || host.startsWith("dev-")) return "dev";
  return "prod";
}
