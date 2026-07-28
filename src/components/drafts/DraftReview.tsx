// ABOUTME: Review a captured session before filing it — play/scrub the replay, trim it with
// ABOUTME: handles, add flags at timestamps, inspect evidence, fill the report, then submit.
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Flag, Scissors, Send, Trash2, X } from "lucide-react";
import type { Bug, BugSeverity, Draft } from "@/lib/types";
import { cn, formatDuration, formatOffset, hostOf } from "@/lib/utils";
import { BUG_SEVERITY_ORDER } from "@/components/common/bits";
import { ReplayPlayer, type Trim } from "@/components/replay/ReplayPlayer";
import { useReplayClock } from "@/components/replay/useReplayClock";
import { InspectorRail } from "@/components/bugs/InspectorRail";

export function DraftReview({
  draft,
  onChange,
  onSubmit,
  onDiscard,
  onBack,
}: {
  draft: Draft;
  onChange: (draft: Draft) => void;
  onSubmit: (draft: Draft) => void;
  onDiscard: (id: string) => void;
  onBack: () => void;
}) {
  const clock = useReplayClock(draft.durationMs);
  const [selectedPick, setSelectedPick] = useState<number | null>(null);
  const trim: Trim = draft.trim ?? { in: 0, out: draft.durationMs };
  const isTrimmed = trim.in > 0 || trim.out < draft.durationMs;

  // Stage + inspector consume a Bug-shaped view of the draft (no status/identity yet).
  const bugView = useMemo<Bug>(
    () => ({
      id: draft.id,
      humanId: "DRAFT",
      title: draft.title ?? draft.pageTitle,
      description: draft.description ?? "",
      status: "open",
      severity: draft.severity ?? "medium",
      tags: draft.tags ?? [],
      pageUrl: draft.pageUrl,
      reporter: { id: "me", name: "You", email: "" },
      assignee: null,
      createdAt: draft.createdAt,
      updatedAt: draft.createdAt,
      durationMs: draft.durationMs,
      scenario: draft.scenario,
      replay: draft.replay,
      markers: draft.markers,
      visits: draft.visits,
      console: draft.console,
      network: draft.network,
      pickedElements: draft.pickedElements,
      environment: draft.environment,
      notes: draft.notes,
      events: [],
    }),
    [draft],
  );

  // Playback respects the trim window: play jumps into it, and pauses at the out edge.
  useEffect(() => {
    if (!clock.playing) return;
    if (clock.t < trim.in) clock.seek(trim.in);
    else if (clock.t >= trim.out) {
      clock.pause();
      clock.seek(trim.out);
    }
  }, [clock, clock.t, clock.playing, trim.in, trim.out]);

  // Space toggles playback here too.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target;
      const typing =
        el instanceof HTMLElement &&
        (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
      if (e.key === " " && !typing) {
        e.preventDefault();
        clock.toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [clock]);

  const highlightRect = selectedPick != null ? (draft.pickedElements[selectedPick]?.rect ?? null) : null;

  const addFlag = () => {
    const t = Math.round(clock.t);
    onChange({ ...draft, markers: [...draft.markers, { t, label: "Flagged moment", kind: "user" }] });
  };

  const canSubmit = (draft.title ?? "").trim().length > 0;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto scroll-thin bg-background">
      <div className="w-full space-y-4 px-6 py-5">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[12.5px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <ArrowLeft className="size-4" /> Drafts
          </button>
          <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-amber-700">
            Draft — not submitted yet
          </span>
          <span className="ml-auto text-[12px] text-muted-foreground">
            {hostOf(draft.pageUrl)} · recorded {formatDuration(draft.durationMs)}
            {isTrimmed && (
              <>
                {" "}
                → keeping <span className="font-semibold text-foreground">{formatDuration(trim.out - trim.in)}</span>
              </>
            )}
          </span>
        </div>

        <div className="soft-fade grid h-[max(460px,calc(100vh-330px))] grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_clamp(340px,30%,560px)]">
          <div className="flex min-h-0 flex-col gap-2.5">
            <ReplayPlayer
              bug={bugView}
              clock={clock}
              highlightRect={highlightRect}
              trim={trim}
              onTrimChange={(next) => onChange({ ...draft, trim: next })}
            />
            {/* Review toolbar — everything acts at the playhead */}
            <div className="flex shrink-0 flex-wrap items-center gap-2 rounded-xl border border-border/60 bg-card px-3 py-2 shadow-card">
              <button
                type="button"
                onClick={addFlag}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-2.5 py-1.5 text-[12px] font-semibold text-primary-foreground transition hover:opacity-90"
                title="Drop a flag at the current playhead"
              >
                <Flag className="size-3.5" /> Add flag at {formatOffset(clock.t)}
              </button>
              <span className="inline-flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
                <Scissors className="size-3.5" />
                Drag the amber handles on the timeline to trim what gets submitted
              </span>
              {isTrimmed && (
                <button
                  type="button"
                  onClick={() => onChange({ ...draft, trim: undefined })}
                  className="ml-auto inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11.5px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <X className="size-3.5" /> Reset trim
                </button>
              )}
            </div>
          </div>

          <div className="flex min-h-0 flex-col gap-4">
            <ReportForm draft={draft} onChange={onChange} />
            <div className="min-h-0 flex-1">
              <InspectorRail bug={bugView} clock={clock} selectedPick={selectedPick} onSelectPick={setSelectedPick} />
            </div>
          </div>
        </div>

        {/* Flags list */}
        {draft.markers.length > 0 && (
          <section className="rounded-xl border border-border/60 bg-card p-4 shadow-card">
            <h2 className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/80">
              Flags ({draft.markers.length})
            </h2>
            <ul className="flex flex-col gap-1.5">
              {draft.markers.map((m, i) => (
                <li key={`${m.t}-${i}`} className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => clock.seek(m.t)}
                    className="inline-flex w-14 items-center gap-1 font-mono text-[11.5px] font-semibold text-foreground/80 transition-colors hover:text-foreground"
                    title="Jump to this moment"
                  >
                    <Flag
                      className="size-3"
                      style={{ color: m.kind === "error" ? "var(--ev-error)" : "var(--ev-marker)" }}
                      fill="currentColor"
                    />
                    {formatOffset(m.t)}
                  </button>
                  <input
                    type="text"
                    value={m.label ?? ""}
                    placeholder="What happens here?"
                    onChange={(e) =>
                      onChange({
                        ...draft,
                        markers: draft.markers.map((mm, ii) => (ii === i ? { ...mm, label: e.target.value } : mm)),
                      })
                    }
                    className="h-7 flex-1 rounded-lg border border-border/60 bg-card px-2 text-[12px] outline-none transition-colors focus:border-primary/50"
                  />
                  <button
                    type="button"
                    onClick={() => onChange({ ...draft, markers: draft.markers.filter((_, ii) => ii !== i) })}
                    className="grid size-7 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-destructive"
                    title="Remove flag"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Submit bar */}
        <div className="flex items-center gap-3 pb-8">
          <button
            type="button"
            disabled={!canSubmit}
            onClick={() => onSubmit(draft)}
            title={canSubmit ? "File this bug" : "Add a title first"}
            className={cn(
              "inline-flex items-center gap-2 rounded-lg px-4 py-2 text-[13px] font-bold transition",
              canSubmit
                ? "bg-primary text-primary-foreground shadow-card hover:opacity-90"
                : "cursor-not-allowed bg-muted text-muted-foreground",
            )}
          >
            <Send className="size-4" /> Submit bug
          </button>
          {!canSubmit && <span className="text-[12px] text-muted-foreground">Give it a title to submit.</span>}
          <button
            type="button"
            onClick={() => {
              if (window.confirm("Discard this draft? The recording will be lost.")) onDiscard(draft.id);
            }}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[12.5px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-destructive"
          >
            <Trash2 className="size-4" /> Discard draft
          </button>
        </div>
      </div>
    </div>
  );
}

function ReportForm({ draft, onChange }: { draft: Draft; onChange: (d: Draft) => void }) {
  // Tags need a raw text buffer — parsing on every keystroke would eat the commas being typed.
  const [tagsText, setTagsText] = useState(() => (draft.tags ?? []).join(", "));
  return (
    <section className="shrink-0 space-y-3 rounded-xl border border-border/60 bg-card p-4 shadow-card">
      <div>
        <label htmlFor="draft-title" className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/80">
          Title
        </label>
        <input
          id="draft-title"
          type="text"
          value={draft.title ?? ""}
          placeholder="What's broken, in one line"
          onChange={(e) => onChange({ ...draft, title: e.target.value })}
          className="h-9 w-full rounded-lg border border-border/60 bg-card px-2.5 text-[13px] font-medium outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary/50"
        />
      </div>
      <div className="flex gap-3">
        <div className="flex-1">
          <label htmlFor="draft-severity" className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/80">
            Severity
          </label>
          <select
            id="draft-severity"
            value={draft.severity ?? "medium"}
            onChange={(e) => onChange({ ...draft, severity: e.target.value as BugSeverity })}
            className="h-8 w-full rounded-lg border border-border/60 bg-card px-2 text-[12.5px] outline-none focus:border-primary/50"
          >
            {BUG_SEVERITY_ORDER.map((s) => (
              <option key={s} value={s}>
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex-1">
          <label htmlFor="draft-tags" className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/80">
            Tags
          </label>
          <input
            id="draft-tags"
            type="text"
            value={tagsText}
            placeholder="checkout, payments"
            onChange={(e) => {
              setTagsText(e.target.value);
              onChange({ ...draft, tags: e.target.value.split(",").map((t) => t.trim()).filter(Boolean) });
            }}
            className="h-8 w-full rounded-lg border border-border/60 bg-card px-2 text-[12.5px] outline-none placeholder:text-muted-foreground/60 focus:border-primary/50"
          />
        </div>
      </div>
      <div>
        <label htmlFor="draft-desc" className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/80">
          Description
        </label>
        <textarea
          id="draft-desc"
          value={draft.description ?? ""}
          placeholder="What did you expect, and what happened instead?"
          onChange={(e) => onChange({ ...draft, description: e.target.value })}
          className="h-20 w-full resize-none rounded-lg border border-border/60 bg-card p-2.5 text-[12.5px] leading-relaxed outline-none placeholder:text-muted-foreground/60 focus:border-primary/50"
        />
      </div>
    </section>
  );
}
