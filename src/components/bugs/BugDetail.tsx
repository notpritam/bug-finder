// ABOUTME: A single bug — header with status/severity/assignee, the replay player + inspector rail
// ABOUTME: (the PostHog-style core), then description, reporter notes, and the bug's history.
import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, Clock, ExternalLink, Flag, Link2, Link as LinkIcon, Send, StickyNote } from "lucide-react";
import type { Bug, BugSeverity, BugStatus, Reporter } from "@/lib/types";
import { ENV_META, type Env } from "@/lib/meta";
import { cn, formatDateTime, formatDuration, formatOffset, hostOf, relativeTime } from "@/lib/utils";
import {
  BUG_SEVERITY_ORDER,
  BUG_STATUS_META,
  BUG_STATUS_ORDER,
  BugSeverityPill,
  UserAvatar,
} from "@/components/common/bits";
import { ReplayPlayer } from "@/components/replay/ReplayPlayer";
import { useReplayClock } from "@/components/replay/useReplayClock";
import { InspectorRail } from "./InspectorRail";

export function BugDetail({
  bug,
  me,
  people,
  relatedBugs,
  onBack,
  onStatusChange,
  onSeverityChange,
  onAssigneeChange,
  onComment,
}: {
  bug: Bug;
  me: Reporter;
  /** Everyone assignable — you, registered accounts, the roster. */
  people: Reporter[];
  /** Bugs sharing a tag or host with this one — the "look here too" trail. */
  relatedBugs: Bug[];
  onBack: () => void;
  onStatusChange: (id: string, status: BugStatus) => void;
  onSeverityChange: (id: string, severity: BugSeverity) => void;
  onAssigneeChange: (id: string, assignee: Reporter | null) => void;
  onComment: (id: string, body: string) => void;
}) {
  const navigate = useNavigate();
  const [linkCopied, setLinkCopied] = useState(false);
  const copyLink = () => {
    const url = `${location.origin}/bug/${bug.humanId}${clock.t > 0 ? `?t=${(clock.t / 1000).toFixed(1)}` : ""}`;
    void navigator.clipboard?.writeText(url).then(() => {
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 1500);
    });
  };
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
            <SeveritySelect severity={bug.severity} onChange={(s) => onSeverityChange(bug.id, s)} />
            {bug.env && ENV_META[bug.env as Env] && (
              <span
                className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-0.5 text-[11.5px] font-semibold text-foreground/80"
                title="Environment this was reproduced on"
              >
                <span className="size-2 rounded-full" style={{ background: ENV_META[bug.env as Env].color }} />
                {ENV_META[bug.env as Env].label}
              </span>
            )}
            {/* tags link to the filtered list */}
            {bug.tags.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => navigate(`/bugs?q=${encodeURIComponent(tag)}`)}
                className="rounded-full bg-secondary px-2 py-px text-[10.5px] font-medium text-secondary-foreground transition-colors hover:bg-accent hover:text-foreground"
                title={`Show all bugs tagged "${tag}"`}
              >
                {tag}
              </button>
            ))}
            <span className="ml-auto flex items-center gap-3 text-[11.5px] text-muted-foreground">
              <button
                type="button"
                onClick={copyLink}
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-medium text-foreground/80 transition-colors hover:bg-accent hover:text-foreground"
                title="Copy a link to this bug at the current replay position"
              >
                <LinkIcon className="size-3.5" /> {linkCopied ? "Copied!" : "Copy link"}
              </button>
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
              {(bug.reporter.role || bug.reporter.team) && (
                <span className="text-muted-foreground/70">
                  ({[bug.reporter.role, bug.reporter.team].filter(Boolean).join(" · ")})
                </span>
              )}
            </span>
            <span className="inline-flex items-center gap-1.5">
              {bug.assignee && <UserAvatar name={bug.assignee.name} seed={bug.assignee.id} size={20} />}
              <label className="relative inline-flex cursor-pointer items-center gap-1 rounded-md px-1 py-0.5 transition-colors hover:bg-accent">
                {bug.assignee ? (
                  <>
                    Assigned to <span className="font-medium text-foreground">{bug.assignee.name}</span>
                  </>
                ) : (
                  <span className="italic">Unassigned — assign ▾</span>
                )}
                <select
                  value={bug.assignee?.id ?? ""}
                  onChange={(e) =>
                    onAssigneeChange(bug.id, people.find((u) => u.id === e.target.value) ?? null)
                  }
                  aria-label="Change assignee"
                  className="absolute inset-0 cursor-pointer opacity-0"
                >
                  <option value="">Unassigned</option>
                  {people.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </label>
            </span>
            <span>
              Recording <span className="font-medium text-foreground">{formatDuration(bug.durationMs)}</span>
            </span>
            {bug.initiative && (
              <span>
                Initiative <span className="font-medium text-foreground">{bug.initiative}</span>
              </span>
            )}
            {bug.jobId && (
              <span>
                Job <span className="font-mono text-[11.5px] font-medium text-foreground">{bug.jobId}</span>
              </span>
            )}
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

        {/* Key moments — the reporter's flags + auto error markers, one click from any of them */}
        {bug.markers.length > 0 && (
          <div className="soft-fade flex flex-wrap items-center gap-2 rounded-xl border border-border/60 bg-card px-3 py-2 shadow-card">
            <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/80">
              Key moments
            </span>
            {[...bug.markers]
              .sort((a, b) => a.t - b.t)
              .map((m, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => {
                    clock.pause();
                    clock.seek(m.t);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border/60 px-2.5 py-1 text-[11.5px] font-medium transition-colors hover:border-primary/40 hover:bg-accent"
                  title="Jump the replay to this moment"
                >
                  <Flag
                    className="size-3"
                    style={{ color: m.kind === "error" ? "var(--ev-error)" : "var(--ev-marker)" }}
                    fill="currentColor"
                  />
                  <span className="font-mono text-[10.5px] text-muted-foreground">{formatOffset(m.t)}</span>
                  {m.label ?? "Marker"}
                </button>
              ))}
          </div>
        )}

        {/* Below-the-fold cards */}
        <div className="grid grid-cols-1 gap-4 pb-10 lg:grid-cols-3">
          <Card title="Description" className="lg:col-span-2">
            <p className="max-w-[75ch] whitespace-pre-wrap text-[13px] leading-relaxed text-foreground/85">{bug.description}</p>
            {bug.notes && (
              <div className="mt-3 flex gap-2 rounded-lg border border-amber-200/70 bg-amber-50/60 p-3 dark:border-amber-500/25 dark:bg-amber-500/10">
                <StickyNote className="mt-0.5 size-4 shrink-0 text-amber-600" />
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-700">Reporter notes</p>
                  <p className="mt-1 whitespace-pre-wrap text-[12.5px] leading-relaxed text-foreground/85">{bug.notes}</p>
                </div>
              </div>
            )}
            {bug.credentials && <TestAccountCard credentials={bug.credentials} />}
          </Card>

          <div className="flex flex-col gap-4">
          {relatedBugs.length > 0 && (
            <Card title="Related bugs">
              <ul className="flex flex-col gap-1.5">
                {relatedBugs.map((rb) => (
                  <li key={rb.id}>
                    <button
                      type="button"
                      onClick={() => navigate(`/bug/${rb.humanId}`)}
                      className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left transition-colors hover:bg-accent"
                      title={`${rb.humanId} — shares a tag or page with this bug`}
                    >
                      <span
                        className="size-2 shrink-0 rounded-full"
                        style={{ background: BUG_STATUS_META[rb.status].color }}
                      />
                      <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{rb.humanId}</span>
                      <span className="min-w-0 flex-1 truncate text-[12px] font-medium">{rb.title}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <Card title="History & comments">
            <CommentComposer me={me} onSubmit={(body) => onComment(bug.id, body)} />
            <ol className="mt-3 space-y-3">
              {[...bug.events].sort((a, b) => b.at - a.at).map((ev) => (
                <li key={ev.id} className="flex gap-2.5">
                  <UserAvatar name={ev.actor} seed={ev.actor} size={22} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] leading-snug">
                      <span className="font-semibold">{ev.actor}</span>{" "}
                      <span className={cn(ev.kind === "comment" ? "text-foreground/90" : "text-foreground/70")}>
                        {ev.detail}
                      </span>
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

/** The account used on the app under test — password masked until revealed. */
function TestAccountCard({ credentials }: { credentials: NonNullable<Bug["credentials"]> }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <div className="mt-3 rounded-lg border border-border/60 bg-muted/40 p-3">
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/80">
        Test account used
      </p>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[12.5px]">
        {credentials.username && (
          <span>
            <span className="text-muted-foreground">User</span>{" "}
            <span className="font-mono font-medium">{credentials.username}</span>
          </span>
        )}
        {credentials.password && (
          <span className="inline-flex items-center gap-1.5">
            <span className="text-muted-foreground">Password</span>{" "}
            <span className="font-mono font-medium">{revealed ? credentials.password : "••••••••"}</span>
            <button
              type="button"
              onClick={() => setRevealed((r) => !r)}
              className="rounded border border-border/60 bg-card px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground transition-colors hover:text-foreground"
            >
              {revealed ? "Hide" : "Reveal"}
            </button>
          </span>
        )}
      </div>
      {credentials.notes && <p className="mt-1.5 text-[12px] text-foreground/80">{credentials.notes}</p>}
    </div>
  );
}

/** The comment box — Enter posts, Shift+Enter for a newline. */
function CommentComposer({ me, onSubmit }: { me: Reporter; onSubmit: (body: string) => void }) {
  const [body, setBody] = useState("");
  const post = () => {
    const text = body.trim();
    if (!text) return;
    onSubmit(text);
    setBody("");
  };
  return (
    <div className="flex items-start gap-2">
      <UserAvatar name={me.name} seed={me.id} size={22} />
      <div className="relative flex-1">
        <textarea
          value={body}
          placeholder="Add a comment… (↵ to post)"
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              post();
            }
          }}
          rows={2}
          className="w-full resize-none rounded-lg border border-border/60 bg-card p-2 pr-9 text-[12px] leading-relaxed outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary/50"
        />
        <button
          type="button"
          onClick={post}
          disabled={!body.trim()}
          className={cn(
            "absolute bottom-2.5 right-2 grid size-6 place-items-center rounded-md transition-colors",
            body.trim() ? "bg-primary text-primary-foreground hover:opacity-90" : "text-muted-foreground/40",
          )}
          title="Post comment"
        >
          <Send className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

/** Severity as a native-select pill. */
function SeveritySelect({ severity, onChange }: { severity: BugSeverity; onChange: (s: BugSeverity) => void }) {
  return (
    <label className="relative inline-flex cursor-pointer">
      <BugSeverityPill severity={severity} />
      <select
        value={severity}
        onChange={(e) => onChange(e.target.value as BugSeverity)}
        aria-label="Change severity"
        className="absolute inset-0 cursor-pointer opacity-0"
      >
        {BUG_SEVERITY_ORDER.map((s) => (
          <option key={s} value={s}>
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </option>
        ))}
      </select>
    </label>
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
