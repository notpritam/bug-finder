// ABOUTME: One Filter control for the sessions list. Replaces two full rows of always-on status
// ABOUTME: and severity chips that cost a third of the screen before a single session was visible.
// ABOUTME: Everything folds into a popover; only the filters actually set stay on screen as pills.
import { useEffect, useRef, useState } from "react";
import { Check, ListFilter, X } from "lucide-react";
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
}

const CAP = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function SessionFilters({
  values,
  showStatus,
  reporters,
  onChange,
  onClear,
}: {
  values: FilterValues;
  /** Sidebar views already constrain status; two status filters could contradict each other. */
  showStatus: boolean;
  /** Everyone who actually reported something in the current scope, so the list can never offer
   *  a name that would return nothing. */
  reporters: Reporter[];
  onChange: (key: keyof FilterValues, value: string) => void;
  onClear: () => void;
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

  // Only what is actually set, so the row next to the button reads as "what am I looking at".
  const active: { key: keyof FilterValues; label: string }[] = [];
  if (showStatus && values.status !== "all")
    active.push({ key: "status", label: BUG_STATUS_META[values.status as keyof typeof BUG_STATUS_META]?.label ?? values.status });
  if (values.severity !== "all") active.push({ key: "severity", label: CAP(values.severity) });
  if (values.reporter !== "all")
    active.push({ key: "reporter", label: reporters.find((r) => r.id === values.reporter)?.name ?? "Unknown reporter" });
  if (values.since !== "all")
    active.push({ key: "since", label: TIME_RANGES.find((t) => t.value === values.since)?.label ?? values.since });

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

        {open && (
          <div className="absolute left-0 top-full z-30 mt-1.5 w-60 rounded-xl border border-border/60 bg-popover p-1.5 shadow-lg">
            {showStatus && <Group label="Status" value={values.status} options={statusOpts} onPick={(v) => onChange("status", v)} />}
            <Group label="Severity" value={values.severity} options={severityOpts} onPick={(v) => onChange("severity", v)} />
            <Group label="Reported by" value={values.reporter} options={reporterOpts} onPick={(v) => onChange("reporter", v)} />
            <Group
              label="Time"
              value={values.since}
              options={TIME_RANGES.map((t) => ({ value: t.value, label: t.label }))}
              onPick={(v) => onChange("since", v)}
            />
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
