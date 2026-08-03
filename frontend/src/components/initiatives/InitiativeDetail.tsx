// ABOUTME: One initiative — owner header, live quality metrics, its bug list, and the
// ABOUTME: owner's lifecycle controls (edit, transfer, mark shipped, archive).
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, CheckCircle2, Pencil, Rocket, Ship } from "lucide-react";
import type { Bug, Reporter } from "@/lib/types";
import type { AuthUser } from "@/lib/auth";
import { listTeams } from "@/lib/meta";
import {
  bugsForInitiative,
  initiativeMetrics,
  INITIATIVE_STATUS_META,
  updateInitiative,
  type Initiative,
} from "@/lib/initiatives";
import { cn, formatDateTime, formatDuration, relativeTime } from "@/lib/utils";
import { BugSeverityPill, BugStatusBadge, UserAvatar } from "@/components/common/bits";

export function InitiativeDetail({
  initiative,
  bugs,
  user,
  people,
  onRefresh,
}: {
  initiative: Initiative;
  bugs: Bug[];
  user: AuthUser;
  people: Reporter[];
  onRefresh: () => Promise<void>;
}) {
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const list = bugsForInitiative(bugs, initiative).sort((a, b) => b.createdAt - a.createdAt);
  const m = initiativeMetrics(list);
  const meta = INITIATIVE_STATUS_META[initiative.status];
  const isOwner = user.id === initiative.owner.id;

  const patch = async (p: Parameters<typeof updateInitiative>[2]) => {
    setBusy(true);
    setError(null);
    try {
      await updateInitiative(initiative.id, user.id, p);
      await onRefresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto scroll-thin bg-background">
      <div className="mx-auto max-w-5xl px-6 py-5" data-testid="initiative-detail">
        <button
          type="button"
          onClick={() => navigate("/initiatives")}
          className="mb-3 inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[12.5px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          data-testid="initiative-back-btn"
        >
          <ArrowLeft className="size-3.5" /> Initiatives
        </button>

        <div className="rounded-xl border border-border/60 bg-card p-4 shadow-card">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white"
              style={{ background: meta.color }}
              data-testid="initiative-status-badge"
            >
              {initiative.status === "shipped" ? <Ship className="size-3" /> : <Rocket className="size-3" />}
              {meta.label}
            </span>
            {initiative.team && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10.5px] font-medium text-muted-foreground">
                {initiative.team}
              </span>
            )}
            <span className="text-[11px] text-muted-foreground">created {relativeTime(initiative.createdAt)}</span>
            {isOwner && (
              <div className="ml-auto flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setEditing((e) => !e)}
                  className="inline-flex h-7 items-center gap-1 rounded-lg border border-border/60 px-2 text-[11.5px] font-medium text-muted-foreground transition-colors hover:text-foreground"
                  data-testid="initiative-edit-btn"
                >
                  <Pencil className="size-3" /> Edit
                </button>
                {initiative.status === "in_qa" && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => patch({ status: "shipped" })}
                    className="inline-flex h-7 items-center gap-1 rounded-lg bg-emerald-600 px-2.5 text-[11.5px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                    data-testid="initiative-ship-btn"
                  >
                    <Ship className="size-3" /> Mark Shipped
                  </button>
                )}
                {initiative.status === "shipped" && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => patch({ status: "in_qa" })}
                    className="inline-flex h-7 items-center rounded-lg border border-border/60 px-2.5 text-[11.5px] font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                    data-testid="initiative-reopen-btn"
                  >
                    Reopen QA
                  </button>
                )}
                {initiative.status !== "archived" && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => patch({ status: "archived" })}
                    className="inline-flex h-7 items-center rounded-lg px-2 text-[11.5px] font-medium text-muted-foreground/70 transition-colors hover:text-foreground disabled:opacity-50"
                    data-testid="initiative-archive-btn"
                  >
                    Archive
                  </button>
                )}
              </div>
            )}
          </div>

          <h1 className="mt-2.5 text-[20px] font-bold tracking-tight">{initiative.name}</h1>
          {initiative.description && (
            <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-foreground/80">{initiative.description}</p>
          )}
          <div className="mt-2.5 flex items-center gap-1.5 text-[12px] text-muted-foreground">
            <UserAvatar name={initiative.owner.name} seed={initiative.owner.id} size={20} />
            Owned by <span className="font-medium text-foreground">{initiative.owner.name}</span>
          </div>
          {error && <p className="mt-2 text-[12px] text-red-600 dark:text-red-400">{error}</p>}

          {editing && isOwner && (
            <EditForm
              initiative={initiative}
              people={people}
              busy={busy}
              onSave={async (p) => {
                await patch(p);
                setEditing(false);
              }}
              onCancel={() => setEditing(false)}
            />
          )}
        </div>

        {initiative.status === "shipped" && (
          <div
            className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-emerald-300/60 bg-emerald-50/60 px-4 py-3 text-[12.5px] text-emerald-900 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-200"
            data-testid="initiative-report-card"
          >
            <CheckCircle2 className="size-4 shrink-0" />
            <span>
              Shipped {initiative.shippedAt ? formatDateTime(initiative.shippedAt) : ""} — QA found{" "}
              <b>{m.valid}</b> valid {m.valid === 1 ? "bug" : "bugs"}, <b>{m.fixed}</b> fixed
              {m.excluded > 0 && (
                <>
                  , <b>{m.excluded}</b> dismissed (not-a-bug / won't-fix)
                </>
              )}
              . Quality score <b>{m.score == null ? "—" : `${Math.round(m.score * 100)}%`}</b>
              {initiative.shippedAt && <> · {formatDuration(initiative.shippedAt - initiative.createdAt)} in QA</>}.
            </span>
          </div>
        )}

        <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Reported" value={`${m.total}`} testId="stat-total" />
          <Stat label="Open" value={`${m.open}`} testId="stat-open" />
          <Stat label="In progress" value={`${m.inProgress}`} testId="stat-in-progress" />
          <Stat label="Fixed" value={`${m.fixed}`} testId="stat-fixed" />
          <Stat label="Not a bug / won't fix" value={`${m.excluded}`} hint="excluded from score" testId="stat-excluded" />
          <Stat
            label="Quality score"
            value={m.score == null ? "—" : `${Math.round(m.score * 100)}%`}
            hint="fixed ÷ valid"
            accent
            testId="stat-score"
          />
        </div>

        <div className="mt-5">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/80">
            Bugs in this initiative
          </p>
          {list.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border/70 py-10 text-center text-[12.5px] text-muted-foreground">
              No bugs filed against this initiative yet — QA picks it in the draft form.
            </div>
          ) : (
            <ul className="overflow-hidden rounded-xl border border-border/60 bg-card shadow-card">
              {list.map((b) => (
                <li key={b.id} className="border-b border-border/50 last:border-b-0">
                  <button
                    type="button"
                    onClick={() => navigate(`/bug/${b.humanId}`)}
                    className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-accent/50"
                    data-testid={`initiative-bug-row-${b.humanId}`}
                  >
                    <span className="w-16 shrink-0 font-mono text-[11px] text-muted-foreground">{b.humanId}</span>
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{b.title}</span>
                    <BugSeverityPill severity={b.severity} />
                    <BugStatusBadge status={b.status} />
                    <span className="hidden w-24 shrink-0 items-center gap-1.5 sm:flex">
                      <UserAvatar name={b.reporter.name} seed={b.reporter.id} size={18} />
                      <span className="truncate text-[11px] text-muted-foreground">{b.reporter.name.split(" ")[0]}</span>
                    </span>
                    <span className="hidden w-16 shrink-0 text-right text-[11px] text-muted-foreground sm:block">
                      {relativeTime(b.createdAt)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  accent,
  testId,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: boolean;
  testId: string;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border/60 bg-card px-3 py-2.5 shadow-card",
        accent && "border-emerald-300/60 dark:border-emerald-500/30",
      )}
      data-testid={testId}
    >
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">{label}</p>
      <p className={cn("mt-0.5 text-[18px] font-bold tabular-nums", accent && "text-emerald-600 dark:text-emerald-400")}>
        {value}
      </p>
      {hint && <p className="text-[9.5px] text-muted-foreground/60">{hint}</p>}
    </div>
  );
}

function EditForm({
  initiative,
  people,
  busy,
  onSave,
  onCancel,
}: {
  initiative: Initiative;
  people: Reporter[];
  busy: boolean;
  onSave: (p: { name: string; description: string; team: string; owner?: Reporter }) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initiative.name);
  const [desc, setDesc] = useState(initiative.description);
  const [team, setTeam] = useState(initiative.team ?? "");
  const [ownerId, setOwnerId] = useState(initiative.owner.id);

  return (
    <div className="mt-3 rounded-lg border border-border/60 bg-muted/30 p-3" data-testid="initiative-edit-form">
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="h-8 flex-1 rounded-lg border border-border/60 bg-card px-2 text-[12.5px] outline-none focus:border-primary/50"
          aria-label="Initiative name"
          data-testid="initiative-edit-name"
        />
        <select
          value={team}
          onChange={(e) => setTeam(e.target.value)}
          className="h-8 rounded-lg border border-border/60 bg-card px-2 text-[12px] outline-none focus:border-primary/50"
          aria-label="Team"
        >
          <option value="">No team</option>
          {listTeams().map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select
          value={ownerId}
          onChange={(e) => setOwnerId(e.target.value)}
          className="h-8 rounded-lg border border-border/60 bg-card px-2 text-[12px] outline-none focus:border-primary/50"
          aria-label="Transfer owner"
          data-testid="initiative-owner-select"
        >
          {[initiative.owner, ...people.filter((p) => p.id !== initiative.owner.id)].map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      <textarea
        value={desc}
        onChange={(e) => setDesc(e.target.value)}
        rows={2}
        className="mt-2 w-full resize-none rounded-lg border border-border/60 bg-card px-2 py-1.5 text-[12px] outline-none focus:border-primary/50"
        aria-label="Description"
      />
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            const owner = [initiative.owner, ...people].find((p) => p.id === ownerId);
            void onSave({ name, description: desc, team, owner: owner?.id !== initiative.owner.id ? owner : undefined });
          }}
          className="inline-flex h-7 items-center rounded-lg bg-primary px-2.5 text-[11.5px] font-semibold text-primary-foreground disabled:opacity-50"
          data-testid="initiative-edit-save"
        >
          Save
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex h-7 items-center rounded-lg px-2 text-[11.5px] font-medium text-muted-foreground hover:text-foreground"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
