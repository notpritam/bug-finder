// ABOUTME: Small shared visual atoms — status badges, severity pills, avatars, tag chips.
import type { BugSeverity, BugStatus } from "@/lib/types";
import { cn, initials } from "@/lib/utils";

export const BUG_STATUS_ORDER: BugStatus[] = ["open", "in_progress", "resolved", "not_a_bug", "wont_fix"];

export const BUG_STATUS_META: Record<BugStatus, { label: string; color: string }> = {
  open: { label: "Open", color: "var(--status-open)" },
  in_progress: { label: "In progress", color: "var(--status-in_progress)" },
  resolved: { label: "Resolved", color: "var(--status-resolved)" },
  not_a_bug: { label: "Not a bug", color: "var(--status-not_a_bug)" },
  wont_fix: { label: "Won't fix", color: "var(--status-wont_fix)" },
};

export const BUG_SEVERITY_ORDER: BugSeverity[] = ["critical", "high", "medium", "low"];

export function BugStatusBadge({ status }: { status: BugStatus }) {
  const meta = BUG_STATUS_META[status];
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-0.5 text-[11.5px] font-semibold text-foreground/80">
      <span className="size-2 rounded-full" style={{ background: meta.color }} />
      {meta.label}
    </span>
  );
}

export function BugSeverityPill({ severity }: { severity: BugSeverity }) {
  return (
    <span className={cn("pill-severity", `pill-${severity}`)}>
      {severity.charAt(0).toUpperCase() + severity.slice(1)}
    </span>
  );
}

export function BugTagChips({ tags, className }: { tags: string[]; className?: string }) {
  if (tags.length === 0) return null;
  return (
    <span className={cn("flex flex-wrap items-center gap-1", className)}>
      {tags.map((t) => (
        <span key={t} className="rounded-full bg-secondary px-2 py-px text-[10.5px] font-medium text-secondary-foreground">
          {t}
        </span>
      ))}
    </span>
  );
}

const AVATAR_HUES = [212, 262, 152, 22, 322, 182];

export function UserAvatar({ name, seed, size = 24 }: { name: string; seed: string; size?: number }) {
  const hue = AVATAR_HUES[[...seed].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_HUES.length];
  return (
    <span
      className="grid shrink-0 place-items-center rounded-full font-semibold text-white"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.38,
        background: `oklch(0.55 0.13 ${hue})`,
      }}
      title={name}
    >
      {initials(name)}
    </span>
  );
}
