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

export const ENV_META: Record<Env, { label: string; color: string }> = {
  prod: { label: "Production", color: "#ef4444" },
  canary: { label: "Canary", color: "#f59e0b" },
  staging: { label: "Staging", color: "#8b5cf6" },
  ephemeral: { label: "Ephemeral", color: "#14b8a6" },
  local: { label: "Local", color: "#64748b" },
  dev: { label: "Dev", color: "#0ea5e9" },
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
