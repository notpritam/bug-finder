// ABOUTME: The bugs list — search + status/severity filter chips over rows of filed bugs,
// ABOUTME: each with replay length, error count, reporter, and inline status.
import { useEffect, useMemo, useRef, useState } from "react";
import { CopyLink } from "@/components/common/CopyLink";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AlertTriangle, Bug as BugIcon, Clapperboard, Search, Trash2 } from "lucide-react";
import type { Bug, BugSeverity, BugStatus, Reporter } from "@/lib/types";
import type { SidebarView } from "@/components/shell/Sidebar";
import { cn, formatDuration, hostOf, relativeTime } from "@/lib/utils";
import {
  BUG_STATUS_META,
  BUG_STATUS_ORDER,
  BugSeverityPill,
  BugTagChips,
  UserAvatar,
  isClosedStatus,
} from "@/components/common/bits";
import { isUnsynced, SyncBadge } from "@/components/common/SyncBadge";
import { LayoutToggle, SessionFilters, type LayoutMode } from "./SessionFilters";

type StatusFilter = BugStatus | "all";
type SeverityFilter = BugSeverity | "all";

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

/** Each view names itself. One page serves six sidebar entries, and with a single fixed heading
 *  there was nothing on screen telling you which one you were looking at. */
const VIEW_TITLE: Partial<Record<SidebarView, string>> = {
  all: "All sessions",
  open: "Open",
  in_progress: "In progress",
  resolved: "Resolved",
  mine: "My sessions",
  reported: "Reported by me",
};

export function BugsPage({
  bugs,
  me,
  view,
  onOpenBug,
  onStatusChange,
  canDelete = false,
  onDelete,
  onRetrySync,
}: {
  bugs: Bug[];
  me: Reporter | null;
  view: SidebarView;
  onOpenBug: (id: string) => void;
  onStatusChange: (id: string, status: BugStatus) => void;
  /** Admins only — deleting is irreversible and shared dashboards have read-only visitors. */
  canDelete?: boolean;
  onDelete?: (ids: string[]) => void;
  /** Re-publish a bug whose server snapshot never landed — wired to the "Not synced" badge. */
  onRetrySync?: (id: string) => Promise<void>;
}) {
  const navigate = useNavigate();
  // Filters + search live in the URL so any filtered view is shareable.
  const [params, setParams] = useSearchParams();
  const statusFilter = (params.get("status") as StatusFilter) ?? "all";
  const severityFilter = (params.get("severity") as SeverityFilter) ?? "all";
  const reporterFilter = params.get("reporter") ?? "all";
  // Days, not a timestamp: a shared link that said "since 3pm Tuesday" would mean something
  // different every time it was opened.
  const sinceFilter = params.get("since") ?? "all";
  // Finished sessions are hidden unless asked for. In the URL like every other filter, so a
  // link that shows them keeps showing them for whoever opens it.
  const showClosed = params.get("closed") === "1";
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
  const setSearch = (v: string) => setParam("q", v);
  // Tags are how a session gets associated with an initiative, so this is an exact match —
  // unlike the search box, where "auth" would also hit a title mentioning authentication.
  const tagFilter = params.get("tag") ?? "all";
  // A personal preference, so it lives in localStorage rather than the URL — in the URL it would
  // ride along on a shared link and override whatever the recipient had chosen.
  const [layout, setLayout] = useState<LayoutMode>(
    () => (localStorage.getItem("bf.sessions-layout") as LayoutMode) || "list",
  );
  const grid = layout === "grid";
  const setLayoutMode = (v: LayoutMode) => {
    setLayout(v);
    localStorage.setItem("bf.sessions-layout", v);
  };
  const [activeIndex, setActiveIndex] = useState(-1);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggleSelected = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const removeSelected = () => {
    const ids = [...selected];
    if (!ids.length || !onDelete) return;
    const ok = window.confirm(
      `Delete ${ids.length} ${ids.length === 1 ? "session" : "sessions"}?\n\n` +
        "This removes them from the board and from the agent API. It cannot be undone.",
    );
    if (!ok) return;
    onDelete(ids);
    setSelected(new Set());
  };
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
      case "reported":
        return me ? bugs.filter((b) => b.reporter?.id === me.id) : [];
      case "mine":
        return me ? bugs.filter((b) => b.assignee?.id === me.id) : [];
      default:
        return bugs;
    }
  }, [bugs, view, me]);

  // Status chips only exist on "All sessions" — sidebar views already constrain status, and two
  // competing status filters could contradict each other.
  const statusChipsVisible = view === "all" || view === "reported";
  const effectiveStatus = statusChipsVisible ? statusFilter : "all";

  const query = search.trim().toLowerCase();
  // Only people who have actually filed something here, so the menu can never offer a name that
  // returns an empty list.
  const reporters = useMemo(() => {
    const seen = new Map<string, Reporter>();
    for (const b of scoped) if (b.reporter?.id && !seen.has(b.reporter.id)) seen.set(b.reporter.id, b.reporter);
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [scoped]);
  const cutoff = sinceFilter === "all" ? 0 : Date.now() - Number(sinceFilter) * 86_400_000;
  // Tags actually present in this scope, most-used first. Derived rather than hardcoded, so a
  // tag someone invents in the extension shows up here on its first use.
  const tagCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const b of scoped) for (const t of b.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [scoped]);
  // Everything except the status filter — the status-counts strip breaks THIS set down,
  // so its numbers always sum to what's on screen.
  const preStatus = useMemo(
    () =>
      scoped.filter(
        (b) =>
          (severityFilter === "all" || b.severity === severityFilter) &&
          (reporterFilter === "all" || b.reporter?.id === reporterFilter) &&
          (cutoff === 0 || b.createdAt >= cutoff) &&
          (tagFilter === "all" || b.tags.includes(tagFilter)) &&
          (query === "" ||
            b.title.toLowerCase().includes(query) ||
            b.humanId.toLowerCase().includes(query) ||
            b.pageUrl.toLowerCase().includes(query) ||
            b.tags.some((t) => t.toLowerCase().includes(query))),
      ),
    [scoped, severityFilter, reporterFilter, cutoff, tagFilter, query],
  );
  const visible = useMemo(
    () =>
      preStatus.filter(
        (b) =>
          (effectiveStatus === "all" || b.status === effectiveStatus) &&
          // Resolved, not-a-bug and won't-fix have all been answered. Left in, they sit in the
          // queue forever and every count reads higher than the work that actually remains.
          // Asking for one of those statuses explicitly still shows them.
          (showClosed || isClosedStatus(effectiveStatus as BugStatus) || !isClosedStatus(b.status)),
      ),
    [preStatus, effectiveStatus, showClosed],
  );
  // Only meaningful on the unfiltered view: any other status filter excludes them anyway.
  const closedHidden =
    showClosed || effectiveStatus !== "all" ? 0 : preStatus.filter((b) => isClosedStatus(b.status)).length;

  const statusCounts = useMemo(() => {
    const counts = new Map<BugStatus, number>();
    for (const b of preStatus) counts.set(b.status, (counts.get(b.status) ?? 0) + 1);
    return BUG_STATUS_ORDER.map((s) => ({ status: s, count: counts.get(s) ?? 0 })).filter((x) => x.count > 0);
  }, [preStatus]);

  const filtersActive =
    effectiveStatus !== "all" || severityFilter !== "all" || reporterFilter !== "all" || sinceFilter !== "all" || query !== "";
  const clearFilters = () => setParams(new URLSearchParams(), { replace: true });

  useEffect(() => {
    setActiveIndex((i) => (i >= visible.length ? visible.length - 1 : i));
  }, [visible.length]);
  useEffect(() => {
    activeRowRef.current?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  // "/" focuses search, ↑/↓ move the highlight (from anywhere that isn't a text field —
  // arrows blur a focused chip so the next ↵ opens the highlighted row), ↵ opens.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target;
      const allowNav = t === searchRef.current || !isTypingTarget(t);
      const enterSafe = t === searchRef.current || t === document.body || t === document.documentElement;
      if (e.key === "/" && !isTypingTarget(t)) {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === "ArrowDown" && allowNav) {
        e.preventDefault();
        if (t instanceof HTMLElement && t !== searchRef.current) t.blur();
        setActiveIndex((i) => Math.min(i + 1, visible.length - 1));
      } else if (e.key === "ArrowUp" && allowNav) {
        e.preventDefault();
        if (t instanceof HTMLElement && t !== searchRef.current) t.blur();
        setActiveIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter" && enterSafe && activeIndex >= 0 && visible[activeIndex]) {
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
          <h1 className="text-[20px] font-bold tracking-tight">{VIEW_TITLE[view] ?? "All sessions"}</h1>
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
              placeholder="Search sessions…"
              aria-label="Search sessions"
              className="h-8 w-full rounded-lg border border-border/60 bg-card pl-8 pr-8 text-[13px] outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary/50 focus-visible:ring-2 focus-visible:ring-ring/40"
            />
            <kbd className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded border border-border/60 bg-muted px-1 font-mono text-[10px] text-muted-foreground sm:block">
              /
            </kbd>
          </div>
          <SessionFilters
            values={{
              status: statusFilter,
              severity: severityFilter,
              reporter: reporterFilter,
              since: sinceFilter,
              tag: tagFilter,
            }}
            showStatus={statusChipsVisible}
            reporters={reporters}
            tags={tagCounts.map(([tag, count]) => ({ tag, count }))}
            onChange={(key, value) => {
              setParam(key, value);
              setActiveIndex(-1);
            }}
            onClear={clearFilters}
            showClosed={showClosed}
            onToggleClosed={(v) => setParam("closed", v ? "1" : "")}
          />
          <LayoutToggle value={layout} onChange={setLayoutMode} />
        </div>

        <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          <p className="text-[11.5px] text-muted-foreground/80">
            {visible.length === scoped.length
              ? `${scoped.length} ${scoped.length === 1 ? "bug" : "bugs"}`
              : `${visible.length} of ${scoped.length}`}
          </p>
          {/* Never silently drop rows: say how many are held back and make the label reveal them. */}
          {closedHidden > 0 && (
            <button
              type="button"
              onClick={() => setParam("closed", "1")}
              className="text-[11.5px] text-muted-foreground/80 underline-offset-2 transition-colors hover:text-foreground hover:underline"
              title="Show resolved, not-a-bug and won’t-fix sessions"
            >
              {closedHidden} done · show
            </button>
          )}
          {showClosed && (
            <button
              type="button"
              onClick={() => setParam("closed", "")}
              className="text-[11.5px] text-muted-foreground/80 underline-offset-2 transition-colors hover:text-foreground hover:underline"
            >
              hide completed
            </button>
          )}
          {statusChipsVisible && statusCounts.length > 1 && (
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
          <span className="ml-auto hidden items-center gap-1 text-[10.5px] text-muted-foreground/70 lg:flex">
            <kbd className="rounded border border-border/60 bg-muted px-1 font-mono">↑↓</kbd> navigate
            <kbd className="rounded border border-border/60 bg-muted px-1 font-mono">↵</kbd> open
          </span>
        </div>

        <ul className={cn(grid ? "grid gap-2.5 sm:grid-cols-2 2xl:grid-cols-3" : "flex flex-col gap-1")}>
          {canDelete && selected.size > 0 ? (
            <li className="mb-1 flex items-center gap-3 rounded-lg border border-primary/40 bg-primary/5 px-3 py-2 text-[12px]">
              <span className="font-semibold">{selected.size} selected</span>
              <button
                type="button"
                className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                onClick={() => setSelected(new Set(visible.map((b) => b.id)))}
              >
                Select all {visible.length}
              </button>
              <button
                type="button"
                className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                onClick={() => setSelected(new Set())}
              >
                Clear
              </button>
              <button
                type="button"
                onClick={removeSelected}
                className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-red-600 px-2.5 py-1 font-semibold text-white hover:bg-red-700"
              >
                <Trash2 className="size-3.5" />
                Delete {selected.size}
              </button>
            </li>
          ) : null}
          {visible.map((bug, i) => {
            // A row from the shared list has no console attached — it is projected out of the list
            // response. Show nothing rather than a confident 0, and rather than throwing mid-render;
            // the real count appears when the session is opened and its evidence is fetched.
            const errors = bug.console ? bug.console.filter((c) => c.level === "error").length : 0;
            return (
              <li
                key={bug.id}
                ref={i === activeIndex ? activeRowRef : null}
                className={cn(
                  "group flex gap-3 rounded-lg border bg-card transition-colors",
                  grid ? "px-3.5 py-3" : "px-3 py-2",
                  grid ? "flex-col items-stretch" : "items-center",
                  i === activeIndex
                    ? "border-primary/60 shadow-[inset_3px_0_0_0_var(--primary)] ring-1 ring-primary/30"
                    : "border-border/60 hover:border-primary/40 hover:bg-accent/40",
                  selected.has(bug.id) && "border-primary/50 bg-primary/5",
                )}
                style={{ "--stagger": i } as React.CSSProperties}
              >
                {canDelete ? (
                  <input
                    type="checkbox"
                    checked={selected.has(bug.id)}
                    onChange={() => toggleSelected(bug.id)}
                    aria-label={`Select ${bug.humanId}`}
                    className="size-3.5 shrink-0 accent-[var(--primary)]"
                  />
                ) : null}
                <button
                  type="button"
                  onClick={() => onOpenBug(bug.id)}
                  className={cn(
                    "flex min-w-0 flex-1 cursor-pointer gap-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                    grid ? "flex-col items-start" : "items-center",
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <p className={cn("text-[13px] font-semibold text-foreground", grid ? "line-clamp-2" : "truncate")}>
                      {bug.title}
                    </p>
                    <p className="mt-0.5 flex items-center gap-2 text-[11.5px] text-muted-foreground">
                      <span className="truncate">{hostOf(bug.pageUrl)}</span>
                      <span className="inline-flex shrink-0 items-center gap-1">
                        <Clapperboard className="size-3" />
                        {formatDuration(bug.durationMs)}
                      </span>
                      {errors > 0 && (
                        <span className="inline-flex shrink-0 items-center gap-1 font-medium text-[color:var(--ev-error)]">
                          <AlertTriangle className="size-3" />
                          {errors} {errors === 1 ? "error" : "errors"}
                        </span>
                      )}
                      {/* Real numbers for rows filed by teammates. `bug.console` is projected out
                          of the list response, so the error count above is always 0 for them —
                          evidenceCounts rides on the row and is the only signal that survives. */}
                      {!bug.console?.length && bug.evidenceCounts?.network ? (
                        <span className="shrink-0 tabular-nums">{bug.evidenceCounts.network} req</span>
                      ) : null}
                      {/* Tags inline rather than on a third line — that line is what took the row
                          from 65px to 87px, and it carried one chip most of the time. */}
                      {!grid && bug.tags.length > 0 && <BugTagChips tags={bug.tags} className="shrink-0" />}
                    </p>
                    {grid && bug.tags.length > 0 && <BugTagChips tags={bug.tags} className="mt-1" />}
                  </div>
                  <span className={cn(grid ? "mt-auto flex w-full items-center gap-2 pt-1" : "contents")}>
                    <BugSeverityPill severity={bug.severity} />
                    <span className={cn("w-8 shrink-0 justify-center", grid ? "flex" : "hidden sm:flex")}>
                      <UserAvatar name={bug.reporter.name} seed={bug.reporter.id} size={24} />
                    </span>
                    <span
                      className={cn(
                        "shrink-0 text-[11px] text-muted-foreground",
                        grid ? "ml-auto" : "hidden w-14 text-right md:block",
                      )}
                      title={bug.reporter.name}
                    >
                      {relativeTime(bug.createdAt)}
                    </span>
                  </span>
                </button>
                {/* On a card these are stretched children of a column, so each would take a full
                    row of its own. Keep them on one line there; `contents` leaves the list untouched. */}
                <span
                  className={cn(
                    grid
                      ? "flex items-center gap-2"
                      : // Revealed on hover or keyboard focus. Sync failures stay visible always —
                        // that one is a warning, not an action.
                        "contents [&>*:not([data-always])]:opacity-0 group-hover:[&>*]:opacity-100 group-focus-within:[&>*]:opacity-100",
                  )}
                >
                  {isUnsynced(bug) && (
                    <span data-always>
                      <SyncBadge bug={bug} onRetry={onRetrySync ? () => onRetrySync(bug.id) : undefined} />
                    </span>
                  )}
                  <InlineStatus status={bug.status} onChange={(s) => onStatusChange(bug.id, s)} />
                  <CopyLink path={`/session/${bug.humanId}`} label={bug.title} />
                </span>
              </li>
            );
          })}
          {visible.length === 0 &&
            (bugs.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border bg-card/50 px-6 py-14 text-center">
                <p className="text-[13.5px] font-semibold text-foreground">No sessions yet</p>
                <p className="mx-auto mt-1.5 max-w-md text-[12.5px] leading-relaxed text-muted-foreground">
                  Record one with the <b>Bug Finder extension</b> on any site — the capture lands in{" "}
                  <b>Drafts</b> for review before it's filed. Or try the built-in demo capture to see the
                  whole flow right now.
                </p>
                <button
                  type="button"
                  onClick={() => navigate("/demo-capture")}
                  className="mt-4 rounded-lg bg-primary px-3.5 py-2 text-[12.5px] font-semibold text-primary-foreground shadow-card transition hover:opacity-90"
                >
                  Record a demo capture
                </button>
              </div>
            ) : (
              <div className="py-10 text-center">
                <p className="text-[13px] text-muted-foreground">
                  {scoped.length === 0
                    ? "No sessions in this view."
                    : query
                      ? `No sessions match "${search.trim()}"${severityFilter !== "all" ? ` with severity ${severityFilter}` : ""}.`
                      : "No sessions match these filters."}
                </p>
                {filtersActive && (
                  <button
                    type="button"
                    onClick={clearFilters}
                    className="mt-3 rounded-lg bg-primary px-3 py-1.5 text-[12px] font-semibold text-primary-foreground transition hover:opacity-90"
                  >
                    Clear filters
                  </button>
                )}
              </div>
            ))}
        </ul>
      </div>
    </div>
  );
}


/** Native select styled as a chip — change status from the list without opening the bug. */
function InlineStatus({ status, onChange }: { status: BugStatus; onChange: (s: BugStatus) => void }) {
  return (
    // Sized for a pointer: this is the control people reach for most on this page, and it was
    // a 22px-tall sliver of text.
    <label className="relative inline-flex h-8 shrink-0 cursor-pointer items-center gap-2 rounded-lg border border-border/60 bg-card px-3 text-[12.5px] font-medium transition-colors hover:border-primary/40 hover:bg-accent">
      <span className="size-2.5 rounded-full" style={{ background: BUG_STATUS_META[status].color }} />
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
