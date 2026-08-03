// ABOUTME: All initiatives — dev work units QA files bugs against. Create, filter,
// ABOUTME: and scan live quality metrics; click through to an initiative's bugs.
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Rocket } from "lucide-react";
import type { Bug } from "@/lib/types";
import type { AuthUser } from "@/lib/auth";
import { listTeams } from "@/lib/meta";
import {
  bugsForInitiative,
  createInitiative,
  initiativeMetrics,
  INITIATIVE_STATUS_META,
  type Initiative,
  type InitiativeStatus,
} from "@/lib/initiatives";
import { cn, relativeTime } from "@/lib/utils";
import { UserAvatar } from "@/components/common/bits";

type Filter = "all" | InitiativeStatus;

export function InitiativesPage({
  bugs,
  user,
  initiatives,
  onRefresh,
}: {
  bugs: Bug[];
  user: AuthUser;
  initiatives: Initiative[];
  onRefresh: () => Promise<void>;
}) {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<Filter>("all");
  const [creating, setCreating] = useState(false);

  const shown = useMemo(() => {
    const order: Record<InitiativeStatus, number> = { in_qa: 0, shipped: 1, archived: 2 };
    return initiatives
      .filter((i) => filter === "all" || i.status === filter)
      .sort((a, b) => order[a.status] - order[b.status] || b.createdAt - a.createdAt);
  }, [initiatives, filter]);

  const counts = useMemo(
    () => ({
      all: initiatives.length,
      in_qa: initiatives.filter((i) => i.status === "in_qa").length,
      shipped: initiatives.filter((i) => i.status === "shipped").length,
      archived: initiatives.filter((i) => i.status === "archived").length,
    }),
    [initiatives],
  );

  return (
    <div className="min-h-0 flex-1 overflow-y-auto scroll-thin bg-background">
      <div className="mx-auto max-w-6xl px-6 py-6" data-testid="initiatives-page">
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <div>
            <h1 className="text-[19px] font-bold tracking-tight">Initiatives</h1>
            <p className="text-[12.5px] text-muted-foreground">
              A unit of dev work in QA — bugs filed against it become its report card.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setCreating((c) => !c)}
            className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-[12.5px] font-semibold text-primary-foreground shadow-card transition-opacity hover:opacity-90"
            data-testid="new-initiative-btn"
          >
            <Plus className="size-4" /> New initiative
          </button>
        </div>

        {creating && (
          <CreateForm
            user={user}
            onDone={async (id) => {
              setCreating(false);
              await onRefresh();
              if (id) navigate(`/initiatives/${id}`);
            }}
          />
        )}

        <div className="mb-4 flex flex-wrap items-center gap-1.5">
          {(["all", "in_qa", "shipped", "archived"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={cn(
                "rounded-full px-2.5 py-1 text-[11.5px] font-medium transition-colors",
                filter === f ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground",
              )}
              data-testid={`initiative-filter-${f}`}
            >
              {f === "all" ? "All" : INITIATIVE_STATUS_META[f].label} <span className="opacity-70">{counts[f]}</span>
            </button>
          ))}
        </div>

        {shown.length === 0 ? (
          <div className="grid place-items-center rounded-xl border border-dashed border-border/70 py-16 text-center">
            <Rocket className="mb-2 size-6 text-muted-foreground/60" />
            <p className="text-[13px] font-medium text-foreground/80">No initiatives yet</p>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              Create one for the work you're handing to QA — their bugs will land here.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {shown.map((ini) => (
              <InitiativeCard key={ini.id} initiative={ini} bugs={bugs} onOpen={() => navigate(`/initiatives/${ini.id}`)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CreateForm({ user, onDone }: { user: AuthUser; onDone: (id: string | null) => Promise<void> }) {
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [team, setTeam] = useState(user.team ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!name.trim()) {
      setError("Give the initiative a name.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const ini = await createInitiative({ name, description: desc, team: team || null, owner: user });
      await onDone(ini.id);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="mb-5 rounded-xl border border-border/60 bg-card p-4 shadow-card" data-testid="initiative-create-form">
      <p className="mb-3 text-[12.5px] font-semibold">New initiative</p>
      <div className="flex flex-col gap-2.5 sm:flex-row">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder='e.g. "Fix Home Screen Flicker"'
          className="h-9 flex-1 rounded-lg border border-border/60 bg-background px-2.5 text-[13px] outline-none placeholder:text-muted-foreground/60 focus:border-primary/50"
          data-testid="initiative-name-input"
        />
        <select
          value={team}
          onChange={(e) => setTeam(e.target.value)}
          className="h-9 rounded-lg border border-border/60 bg-background px-2 text-[12.5px] outline-none focus:border-primary/50"
          aria-label="Team"
          data-testid="initiative-team-select"
        >
          <option value="">No team</option>
          {listTeams().map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>
      <textarea
        value={desc}
        onChange={(e) => setDesc(e.target.value)}
        placeholder="What's being built or fixed? QA reads this before testing."
        rows={2}
        className="mt-2.5 w-full resize-none rounded-lg border border-border/60 bg-background px-2.5 py-2 text-[12.5px] outline-none placeholder:text-muted-foreground/60 focus:border-primary/50"
        data-testid="initiative-desc-input"
      />
      {error && <p className="mt-1.5 text-[12px] text-red-600 dark:text-red-400">{error}</p>}
      <div className="mt-2.5 flex items-center gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          className="inline-flex h-8 items-center rounded-lg bg-primary px-3 text-[12px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          data-testid="initiative-create-submit"
        >
          {busy ? "Creating…" : "Create initiative"}
        </button>
        <span className="text-[11.5px] text-muted-foreground">
          Owner: <span className="font-medium text-foreground/80">{user.name}</span>
        </span>
      </div>
    </div>
  );
}

function InitiativeCard({
  initiative,
  bugs,
  onOpen,
}: {
  initiative: Initiative;
  bugs: Bug[];
  onOpen: () => void;
}) {
  const m = initiativeMetrics(bugsForInitiative(bugs, initiative));
  const meta = INITIATIVE_STATUS_META[initiative.status];
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex flex-col rounded-xl border border-border/60 bg-card p-4 text-left shadow-card transition-shadow hover:shadow-card-hover"
      data-testid={`initiative-card-${initiative.id}`}
    >
      <div className="flex items-center gap-2">
        <span
          className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white"
          style={{ background: meta.color }}
        >
          {meta.label}
        </span>
        {initiative.team && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10.5px] font-medium text-muted-foreground">
            {initiative.team}
          </span>
        )}
        <span className="ml-auto text-[10.5px] text-muted-foreground">{relativeTime(initiative.createdAt)}</span>
      </div>
      <p className="mt-2 text-[14px] font-bold leading-snug">{initiative.name}</p>
      {initiative.description && (
        <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-muted-foreground">{initiative.description}</p>
      )}
      <div className="mt-3 flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
        <UserAvatar name={initiative.owner.name} seed={initiative.owner.id} size={18} />
        <span className="truncate font-medium text-foreground/80">{initiative.owner.name}</span>
      </div>
      <div className="mt-3 flex items-center gap-3 border-t border-border/50 pt-2.5 font-mono text-[11px] text-muted-foreground">
        <span>
          <span className="font-bold text-foreground">{m.total}</span> bugs
        </span>
        <span>
          <span className="font-bold text-foreground">{m.open + m.inProgress}</span> open
        </span>
        <span>
          <span className="font-bold text-foreground">{m.fixed}</span> fixed
        </span>
        <span className="ml-auto font-sans font-semibold text-foreground">
          {m.score == null ? "—" : `${Math.round(m.score * 100)}%`}
        </span>
      </div>
      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-emerald-500 transition-[width]"
          style={{ width: `${Math.round((m.score ?? 0) * 100)}%` }}
        />
      </div>
    </button>
  );
}
