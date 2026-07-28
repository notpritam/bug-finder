// ABOUTME: The bugs list — search + status/severity filter chips over rows of filed bugs,
// ABOUTME: each with replay length, error count, reporter, and inline status.
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AlertTriangle, Bug as BugIcon, Clapperboard, Search } from "lucide-react";
import type { Bug, BugSeverity, BugStatus } from "@/lib/types";
import type { SidebarView } from "@/components/shell/Sidebar";
import { ME } from "@/lib/data";
import { cn, formatDuration, hostOf, relativeTime } from "@/lib/utils";
import {
  BUG_SEVERITY_ORDER,
  BUG_STATUS_META,
  BUG_STATUS_ORDER,
  BugSeverityPill,
  BugTagChips,
  UserAvatar,
} from "@/components/common/bits";

type StatusFilter = BugStatus | "all";
type SeverityFilter = BugSeverity | "all";

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

export function BugsPage({
  bugs,
  view,
  onOpenBug,
  onStatusChange,
}: {
  bugs: Bug[];
  view: SidebarView;
  onOpenBug: (id: string) => void;
  onStatusChange: (id: string, status: BugStatus) => void;
}) {
  // Filters + search live in the URL so any filtered view is shareable.
  const [params, setParams] = useSearchParams();
  const statusFilter = (params.get("status") as StatusFilter) ?? "all";
  const severityFilter = (params.get("severity") as SeverityFilter) ?? "all";
  const search = params.get("q") ?? "";
  const setParam = (key: string, value: string) => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value === "all" || value === "") next.delete(key);
        else next.set(key, value);
        return next;
      },
      { replace: true },
    );
  };
  const setStatusFilter = (v: StatusFilter) => setParam("status", v);
  const setSeverityFilter = (v: SeverityFilter) => setParam("severity", v);
  const setSearch = (v: string) => setParam("q", v);
  const [activeIndex, setActiveIndex] = useState(-1);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const activeRowRef = useRef<HTMLLIElement | null>(null);

  // The sidebar view narrows first; chips narrow further.
  const scoped = useMemo(() => {
    switch (view) {
      case "open":
        return bugs.filter((b) => b.status === "open");
      case "in_progress":
        return bugs.filter((b) => b.status === "in_progress");
      case "resolved":
        return bugs.filter((b) => b.status === "resolved");
      case "mine":
        return bugs.filter((b) => b.assignee?.id === ME.id);
      default:
        return bugs;
    }
  }, [bugs, view]);

  const query = search.trim().toLowerCase();
  const visible = useMemo(
    () =>
      scoped.filter(
        (b) =>
          (statusFilter === "all" || b.status === statusFilter) &&
          (severityFilter === "all" || b.severity === severityFilter) &&
          (query === "" ||
            b.title.toLowerCase().includes(query) ||
            b.humanId.toLowerCase().includes(query) ||
            b.pageUrl.toLowerCase().includes(query) ||
            b.tags.some((t) => t.toLowerCase().includes(query))),
      ),
    [scoped, statusFilter, severityFilter, query],
  );

  const statusCounts = useMemo(() => {
    const counts = new Map<BugStatus, number>();
    for (const b of scoped) counts.set(b.status, (counts.get(b.status) ?? 0) + 1);
    return BUG_STATUS_ORDER.map((s) => ({ status: s, count: counts.get(s) ?? 0 })).filter((x) => x.count > 0);
  }, [scoped]);

  useEffect(() => {
    setActiveIndex((i) => (i >= visible.length ? visible.length - 1 : i));
  }, [visible.length]);
  useEffect(() => {
    activeRowRef.current?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  // "/" focuses search, ↑/↓ move the highlight, ↵ opens.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target;
      const allowNav = t === searchRef.current || t === document.body || t === document.documentElement;
      if (e.key === "/" && !isTypingTarget(t)) {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === "ArrowDown" && allowNav) {
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, visible.length - 1));
      } else if (e.key === "ArrowUp" && allowNav) {
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter" && allowNav && activeIndex >= 0 && visible[activeIndex]) {
        e.preventDefault();
        onOpenBug(visible[activeIndex].id);
      } else if (e.key === "Escape" && t === searchRef.current) {
        searchRef.current?.blur();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, activeIndex, onOpenBug]);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto scroll-thin bg-background px-8 py-8">
      <div className="mx-auto w-full">
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <BugIcon className="size-5 text-primary" />
          <h1 className="text-[20px] font-bold tracking-tight">Bugs</h1>
          <div className="relative ml-auto w-full sm:w-64">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setActiveIndex(-1);
              }}
              placeholder="Search bugs…"
              aria-label="Search bugs"
              className="h-8 w-full rounded-lg border border-border/60 bg-card pl-8 pr-8 text-[13px] outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary/50 focus-visible:ring-2 focus-visible:ring-ring/40"
            />
            <kbd className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded border border-border/60 bg-muted px-1 font-mono text-[10px] text-muted-foreground sm:block">
              /
            </kbd>
          </div>
        </div>

        <div className="mb-5 space-y-2">
          <FilterChips
            label="Status"
            value={statusFilter}
            options={[
              { value: "all" as StatusFilter, label: "All" },
              ...BUG_STATUS_ORDER.map((s) => ({ value: s as StatusFilter, label: BUG_STATUS_META[s].label })),
            ]}
            onChange={setStatusFilter}
          />
          <FilterChips
            label="Severity"
            value={severityFilter}
            options={[
              { value: "all" as SeverityFilter, label: "All" },
              ...BUG_SEVERITY_ORDER.map((s) => ({
                value: s as SeverityFilter,
                label: s.charAt(0).toUpperCase() + s.slice(1),
              })),
            ]}
            onChange={setSeverityFilter}
          />
        </div>

        <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          <p className="text-[11.5px] text-muted-foreground/80">
            {visible.length === scoped.length
              ? `${scoped.length} ${scoped.length === 1 ? "bug" : "bugs"}`
              : `${visible.length} of ${scoped.length}`}
          </p>
          {statusCounts.length > 1 && (
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
              {statusCounts.map(({ status, count }) => (
                <button
                  key={status}
                  type="button"
                  onClick={() => setStatusFilter(statusFilter === status ? "all" : status)}
                  className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                >
                  <span className="size-2 rounded-full" style={{ background: BUG_STATUS_META[status].color }} />
                  {BUG_STATUS_META[status].label} <span className="font-medium text-foreground">{count}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <ul className="flex flex-col gap-1.5">
          {visible.map((bug, i) => {
            const errors = bug.console.filter((c) => c.level === "error").length;
            return (
              <li
                key={bug.id}
                ref={i === activeIndex ? activeRowRef : null}
                className={cn(
                  "card-rise flex items-center gap-3 rounded-xl border bg-card px-3.5 py-3 transition-colors",
                  i === activeIndex
                    ? "border-primary/60 ring-1 ring-primary/30"
                    : "border-border/60 hover:border-primary/40 hover:bg-accent/40",
                )}
                style={{ "--stagger": i } as React.CSSProperties}
              >
                <button
                  type="button"
                  onClick={() => onOpenBug(bug.id)}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  <span className="w-14 shrink-0 font-mono text-[11px] font-medium tracking-wide text-muted-foreground">
                    {bug.humanId}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-semibold text-foreground">{bug.title}</p>
                    <p className="mt-0.5 flex items-center gap-2 text-[11.5px] text-muted-foreground">
                      <span className="truncate">{hostOf(bug.pageUrl)}</span>
                      <span className="inline-flex shrink-0 items-center gap-1">
                        <Clapperboard className="size-3" />
                        {formatDuration(bug.durationMs)}
                      </span>
                      {errors > 0 && (
                        <span className="inline-flex shrink-0 items-center gap-1 font-medium text-red-600">
                          <AlertTriangle className="size-3" />
                          {errors} {errors === 1 ? "error" : "errors"}
                        </span>
                      )}
                    </p>
                    {bug.tags.length > 0 && <BugTagChips tags={bug.tags} className="mt-1" />}
                  </div>
                  <BugSeverityPill severity={bug.severity} />
                  <span className="hidden w-8 shrink-0 justify-center sm:flex">
                    <UserAvatar name={bug.reporter.name} seed={bug.reporter.id} size={24} />
                  </span>
                  <span className="w-14 shrink-0 text-right text-[11px] text-muted-foreground">
                    {relativeTime(bug.createdAt)}
                  </span>
                </button>
                <InlineStatus status={bug.status} onChange={(s) => onStatusChange(bug.id, s)} />
              </li>
            );
          })}
          {visible.length === 0 && (
            <p className="py-10 text-center text-[13px] text-muted-foreground">
              {scoped.length === 0
                ? "No bugs in this view."
                : query
                  ? "No bugs match your search."
                  : "No bugs match these filters."}
            </p>
          )}
        </ul>
      </div>
    </div>
  );
}

function FilterChips<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 w-14 shrink-0 text-[11.5px] font-medium text-muted-foreground/70">{label}</span>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={cn(
            "rounded-full px-2.5 py-1 text-[12px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50",
            value === o.value
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Native select styled as a chip — change status from the list without opening the bug. */
function InlineStatus({ status, onChange }: { status: BugStatus; onChange: (s: BugStatus) => void }) {
  return (
    <label className="relative inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-border/60 bg-card px-2 py-1 text-[11.5px] font-medium transition-colors hover:bg-accent">
      <span className="size-2 rounded-full" style={{ background: BUG_STATUS_META[status].color }} />
      {BUG_STATUS_META[status].label}
      <select
        value={status}
        onChange={(e) => onChange(e.target.value as BugStatus)}
        aria-label="Change status"
        className="absolute inset-0 cursor-pointer opacity-0"
      >
        {BUG_STATUS_ORDER.map((s) => (
          <option key={s} value={s}>
            {BUG_STATUS_META[s].label}
          </option>
        ))}
      </select>
    </label>
  );
}
