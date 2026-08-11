// ABOUTME: One Filter control for the sessions list. Replaces two full rows of always-on status
// ABOUTME: and severity chips that cost a third of the screen before a single session was visible.
// ABOUTME: Everything folds into a popover; only the filters actually set stay on screen as pills.
import { useEffect, useRef, useState } from "react";
import { Check, LayoutGrid, List, ListFilter, X } from "lucide-react";
import type { Reporter } from "@/lib/types";
import { BUG_SEVERITY_ORDER, BUG_STATUS_META, BUG_STATUS_ORDER } from "@/components/common/bits";
import { cn } from "@/lib/utils";

/** Relative rather than absolute dates: "in the last week" is the question people actually ask of
 *  a QA queue, and it stays true tomorrow without anyone editing the URL. */
export const TIME_RANGES = [
  { value: "all", label: "Any time" },
  { value: "1", label: "Last 24 hours" },
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
] as const;

export interface FilterValues {
  status: string;
  severity: string;
  reporter: string;
  since: string;
  tag: string;
}

export type LayoutMode = "list" | "grid";

const CAP = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function SessionFilters({
  values,
  showStatus,
  reporters,
  tags,
  onChange,
  onClear,
  showDismissed,
  onToggleDismissed,
}: {
  values: FilterValues;
  /** Sidebar views already constrain status; two status filters could contradict each other. */
  showStatus: boolean;
  /** Everyone who actually reported something in the current scope, so the list can never offer
   *  a name that would return nothing. */
  reporters: Reporter[];
  /** Tags present in scope, most-used first, with their counts. Same rule as reporters: only
   *  offer what is actually there. */
  tags: { tag: string; count: number }[];
  onChange: (key: keyof FilterValues, value: string) => void;
  onClear: () => void;
  /** "Not a bug" is a verdict, not work, so it is out of the list by default. This is how you
   *  get it back — a toggle rather than a filter value, because it changes what the list means
   *  rather than narrowing it. */
  showDismissed: boolean;
  onToggleDismissed: (v: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const statusOpts = [
    { value: "all", label: "Any status" },
    ...BUG_STATUS_ORDER.map((s) => ({ value: s, label: BUG_STATUS_META[s].label })),
  ];
  const severityOpts = [
    { value: "all", label: "Any severity" },
    ...BUG_SEVERITY_ORDER.map((s) => ({ value: s, label: CAP(s) })),
  ];
  const reporterOpts = [
    { value: "all", label: "Anyone" },
    ...reporters.map((r) => ({ value: r.id, label: r.name })),
  ];
  const tagOpts = [
    { value: "all", label: "Any tag" },
    ...tags.map((t) => ({ value: t.tag, label: `${t.tag} (${t.count})` })),
  ];

  // Only what is actually set, so the row next to the button reads as "what am I looking at".
  const active: { key: keyof FilterValues; label: string }[] = [];
  if (showStatus && values.status !== "all")
    active.push({ key: "status", label: BUG_STATUS_META[values.status as keyof typeof BUG_STATUS_META]?.label ?? values.status });
  if (values.severity !== "all") active.push({ key: "severity", label: CAP(values.severity) });
  if (values.reporter !== "all")
    active.push({ key: "reporter", label: reporters.find((r) => r.id === values.reporter)?.name ?? "Unknown reporter" });
  if (values.since !== "all")
    active.push({ key: "since", label: TIME_RANGES.find((t) => t.value === values.since)?.label ?? values.since });
  if (values.tag !== "all") active.push({ key: "tag", label: `#${values.tag}` });

  return (
    <div className="flex flex-wrap items-center gap-1.5" ref={wrap}>
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          data-testid="sessions-filter-button"
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[12.5px] font-medium transition-colors",
            active.length
              ? "border-primary/50 bg-primary/10 text-foreground"
              : "border-border/60 bg-card text-muted-foreground hover:text-foreground",
          )}
        >
          <ListFilter className="size-3.5" />
          Filter
          {active.length > 0 && (
            <span className="grid size-4 place-items-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
              {active.length}
            </span>
          )}
        </button>

        {/* Anchored right, not left: this button sits at the end of the control row, so a
            left-anchored panel runs off the edge of the window. */}
        {open && (
          <div className="absolute right-0 top-full z-30 mt-1.5 w-60 rounded-xl border border-border/60 bg-popover p-1.5 shadow-lg">
            {showStatus && <Group label="Status" value={values.status} options={statusOpts} onPick={(v) => onChange("status", v)} />}
            <Group label="Severity" value={values.severity} options={severityOpts} onPick={(v) => onChange("severity", v)} />
            <Group label="Reported by" value={values.reporter} options={reporterOpts} onPick={(v) => onChange("reporter", v)} />
            {tags.length > 0 && <Group label="Tag" value={values.tag} options={tagOpts} onPick={(v) => onChange("tag", v)} />}
            <Group
              label="Time"
              value={values.since}
              options={TIME_RANGES.map((t) => ({ value: t.value, label: t.label }))}
              onPick={(v) => onChange("since", v)}
            />
            <label className="mt-1 flex cursor-pointer items-center gap-2 rounded-md border-t border-border/60 px-2 pb-1 pt-2 text-[12px] text-muted-foreground transition-colors hover:text-foreground">
              <input
                type="checkbox"
                className="size-3.5 cursor-pointer accent-primary"
                checked={showDismissed}
                onChange={(e) => onToggleDismissed(e.target.checked)}
                data-testid="sessions-show-dismissed"
              />
              Show “Not a bug”
            </label>
            {active.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  onClear();
                  setOpen(false);
                }}
                className="mt-1 w-full rounded-md px-2 py-1.5 text-left text-[12px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                Clear all filters
              </button>
            )}
          </div>
        )}
      </div>

      {active.map((a) => (
        <button
          key={a.key}
          type="button"
          onClick={() => onChange(a.key, "all")}
          aria-label={`Remove ${a.label} filter`}
          className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-card py-0.5 pl-2 pr-1 text-[11.5px] font-medium transition-colors hover:border-destructive/40 hover:text-destructive"
        >
          {a.label}
          <X className="size-3" />
        </button>
      ))}
    </div>
  );
}

/** A labelled group of single-choice rows. A native <select> per group would be four dropdowns to
 *  open one at a time; this shows the whole set at a glance, which is the point of folding them in. */
function Group({
  label,
  value,
  options,
  onPick,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onPick: (v: string) => void;
}) {
  return (
    <div className="mb-1 last:mb-0">
      <p className="px-2 pb-0.5 pt-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">{label}</p>
      <div className="max-h-44 overflow-y-auto scroll-thin">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onPick(o.value)}
            className={cn(
              "flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-[12px] transition-colors hover:bg-accent",
              value === o.value ? "font-medium text-foreground" : "text-muted-foreground",
            )}
          >
            <Check className={cn("size-3 shrink-0", value === o.value ? "opacity-100" : "opacity-0")} />
            <span className="truncate">{o.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** List or cards. A preference, not a filter, so it lives beside the filter rather than inside it —
 *  and it persists per person instead of riding in the URL, where it would follow a shared link and
 *  override the recipient's own choice. */
export function LayoutToggle({ value, onChange }: { value: LayoutMode; onChange: (v: LayoutMode) => void }) {
  const opts: { mode: LayoutMode; icon: typeof List; label: string }[] = [
    { mode: "list", icon: List, label: "List view" },
    { mode: "grid", icon: LayoutGrid, label: "Card view" },
  ];
  return (
    <span className="inline-flex items-center gap-0.5 rounded-lg border border-border/60 bg-card p-0.5">
      {opts.map(({ mode, icon: Icon, label }) => (
        <button
          key={mode}
          type="button"
          onClick={() => onChange(mode)}
          title={label}
          aria-label={label}
          aria-pressed={value === mode}
          data-testid={`sessions-layout-${mode}`}
          className={cn(
            "grid size-[26px] place-items-center rounded-md transition-colors",
            value === mode ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Icon className="size-3.5" />
        </button>
      ))}
    </span>
  );
}
