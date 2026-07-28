// ABOUTME: A single bug — header with status/severity/assignee, the replay player + inspector rail
// ABOUTME: (the PostHog-style core), then description, reporter notes, and the bug's history.
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ArrowLeft, Clock, ExternalLink, Link2, StickyNote } from "lucide-react";
import type { Bug, BugStatus } from "@/lib/types";
import { cn, formatDateTime, formatDuration, hostOf, relativeTime } from "@/lib/utils";
import {
  BUG_STATUS_META,
  BUG_STATUS_ORDER,
  BugSeverityPill,
  BugTagChips,
  UserAvatar,
} from "@/components/common/bits";
import { ReplayPlayer } from "@/components/replay/ReplayPlayer";
import { useReplayClock } from "@/components/replay/useReplayClock";
import { InspectorRail } from "./InspectorRail";

export function BugDetail({
  bug,
  onBack,
  onStatusChange,
}: {
  bug: Bug;
  onBack: () => void;
  onStatusChange: (id: string, status: BugStatus) => void;
}) {
  const clock = useReplayClock(bug.durationMs);
  const [selectedPick, setSelectedPick] = useState<number | null>(null);
  const highlightRect = selectedPick != null ? (bug.pickedElements[selectedPick]?.rect ?? null) : null;

  // Shareable playhead: ?t=12.5 seeks on load; pausing/seeking keeps the URL in sync (replace,
  // so scrubbing doesn't pollute history).
  const [params, setParams] = useSearchParams();
  const seededT = useRef(false);
  useEffect(() => {
    if (seededT.current) return;
    seededT.current = true;
    const t = Number(params.get("t"));
    if (Number.isFinite(t) && t > 0) clock.seek(Math.min(t * 1000, bug.durationMs));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (clock.playing) return;
    const timer = setTimeout(() => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (clock.t > 0) next.set("t", (clock.t / 1000).toFixed(1));
          else next.delete("t");
          return next;
        },
        { replace: true },
      );
    }, 300);
    return () => clearTimeout(timer);
  }, [clock.t, clock.playing, setParams]);

  // Space toggles playback anywhere on the page (except in form fields).
  // Esc peels back one layer: clear an element highlight first, then leave the bug.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target;
      const typing =
        t instanceof HTMLElement && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
      if (typing) return;
      if (e.key === " ") {
        e.preventDefault();
        clock.toggle();
      } else if (e.key === "Escape") {
        if (selectedPick != null) setSelectedPick(null);
        else onBack();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [clock, onBack, selectedPick]);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto scroll-thin bg-background">
      <div className="w-full space-y-4 px-6 py-5">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[12.5px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <ArrowLeft className="size-4" /> All bugs
          <kbd className="ml-1 rounded border border-border/60 bg-muted px-1 font-mono text-[9.5px]">esc</kbd>
        </button>

        {/* Header */}
        <header className="soft-fade space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[12px] font-medium tracking-wide text-muted-foreground">{bug.humanId}</span>
            <StatusSelect status={bug.status} onChange={(s) => onStatusChange(bug.id, s)} />
            <BugSeverityPill severity={bug.severity} />
            <BugTagChips tags={bug.tags} />
            <span className="ml-auto flex items-center gap-3 text-[11.5px] text-muted-foreground">
              <span className="inline-flex items-center gap-1" title={formatDateTime(bug.createdAt)}>
                <Clock className="size-3.5" /> {relativeTime(bug.createdAt)}
              </span>
              <a
                href={bug.pageUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-medium text-foreground/80 transition-colors hover:text-foreground"
              >
                <Link2 className="size-3.5" /> {hostOf(bug.pageUrl)} <ExternalLink className="size-3" />
              </a>
            </span>
          </div>
          <h1 className="text-[19px] font-bold leading-snug tracking-tight">{bug.title}</h1>
          <div className="flex flex-wrap items-center gap-4 text-[12px] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <UserAvatar name={bug.reporter.name} seed={bug.reporter.id} size={20} />
              Reported by <span className="font-medium text-foreground">{bug.reporter.name}</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              {bug.assignee ? (
                <>
                  <UserAvatar name={bug.assignee.name} seed={bug.assignee.id} size={20} />
                  Assigned to <span className="font-medium text-foreground">{bug.assignee.name}</span>
                </>
              ) : (
                <span className="italic">Unassigned</span>
              )}
            </span>
            <span>
              Recording <span className="font-medium text-foreground">{formatDuration(bug.durationMs)}</span>
            </span>
          </div>
        </header>

        {/* Replay + inspector — the core */}
        <div className="soft-fade grid h-auto grid-cols-1 gap-4 lg:h-[max(480px,calc(100vh-300px))] lg:grid-cols-[minmax(0,1fr)_clamp(340px,30%,560px)]">
          <div className="relative h-[min(64vh,580px)] lg:h-auto lg:min-h-0">
            <ReplayPlayer bug={bug} clock={clock} highlightRect={highlightRect} />
            {selectedPick != null && (
              <button
                type="button"
                onClick={() => setSelectedPick(null)}
                className="absolute right-3 top-12 z-40 inline-flex items-center gap-1 rounded-full bg-foreground/80 px-2.5 py-1 text-[11px] font-semibold text-background shadow-pop transition hover:bg-foreground"
                title="Clear the element highlight (esc)"
              >
                ✕ Clear highlight
              </button>
            )}
          </div>
          <div className="h-[440px] lg:h-auto lg:min-h-0">
            <InspectorRail bug={bug} clock={clock} selectedPick={selectedPick} onSelectPick={setSelectedPick} />
          </div>
        </div>

        {/* Below-the-fold cards */}
        <div className="grid grid-cols-1 gap-4 pb-10 lg:grid-cols-3">
          <Card title="Description" className="lg:col-span-2">
            <p className="max-w-[75ch] whitespace-pre-wrap text-[13px] leading-relaxed text-foreground/85">{bug.description}</p>
            {bug.notes && (
              <div className="mt-3 flex gap-2 rounded-lg border border-amber-200/70 bg-amber-50/60 p-3">
                <StickyNote className="mt-0.5 size-4 shrink-0 text-amber-600" />
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-700">Reporter notes</p>
                  <p className="mt-1 whitespace-pre-wrap text-[12.5px] leading-relaxed text-foreground/85">{bug.notes}</p>
                </div>
              </div>
            )}
          </Card>

          <Card title="History">
            <ol className="space-y-3">
              {[...bug.events].sort((a, b) => b.at - a.at).map((ev) => (
                <li key={ev.id} className="flex gap-2.5">
                  <UserAvatar name={ev.actor} seed={ev.actor} size={22} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] leading-snug">
                      <span className="font-semibold">{ev.actor}</span>{" "}
                      <span className="text-foreground/80">{ev.detail}</span>
                    </p>
                    <p className="mt-0.5 text-[10.5px] text-muted-foreground">{relativeTime(ev.at)}</p>
                  </div>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Card({ title, className, children }: { title: string; className?: string; children: React.ReactNode }) {
  return (
    <section className={cn("rounded-xl border border-border/60 bg-card p-4 shadow-card", className)}>
      <h2 className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/80">{title}</h2>
      {children}
    </section>
  );
}

/** Status as a native-select chip, colored by the current status. */
function StatusSelect({ status, onChange }: { status: BugStatus; onChange: (s: BugStatus) => void }) {
  return (
    <label className="relative inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-muted px-2.5 py-0.5 text-[11.5px] font-semibold text-foreground/80 transition-colors hover:bg-accent">
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
