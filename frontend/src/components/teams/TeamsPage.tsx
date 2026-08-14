// ABOUTME: Teams — create one, join the ones you belong to, and open a team to see only its
// ABOUTME: sessions. Membership is plural on purpose: being in Frontend and Retention at once is
// ABOUTME: ordinary, and a single-choice control would force people to misrepresent themselves.
import { useEffect, useMemo, useState } from "react";
import { Plus, Users, Check } from "lucide-react";
import type { AuthUser } from "@/lib/auth";
import {
  createTeam,
  joinTeam,
  leaveTeam,
  listTeams,
  teamSessions,
  type Team,
} from "@/lib/teams";
import type { Bug } from "@/lib/types";
import { cn, relativeTime } from "@/lib/utils";
import { BugSeverityPill } from "@/components/common/bits";

export function TeamsPage({ user }: { user: AuthUser | null }) {
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [sessions, setSessions] = useState<Bug[]>([]);
  const [sessionsFor, setSessionsFor] = useState<string | null>(null);

  const refresh = async () => {
    setTeams(await listTeams());
    setLoading(false);
  };
  useEffect(() => {
    void refresh();
  }, [user?.id]);

  // Load a team's sessions when it is opened. Tracked by id rather than a boolean so switching
  // teams cannot leave the previous team's sessions on screen under the new team's name.
  useEffect(() => {
    if (!open) return;
    let live = true;
    setSessionsFor(null);
    void teamSessions(open).then((rows) => {
      if (!live) return;
      setSessions(rows);
      setSessionsFor(open);
    });
    return () => {
      live = false;
    };
  }, [open]);

  const mine = useMemo(() => teams.filter((t) => t.joined), [teams]);
  const others = useMemo(() => teams.filter((t) => !t.joined), [teams]);

  const create = async () => {
    const clean = name.trim();
    if (!clean || busy) return;
    setBusy("create");
    setError(null);
    setNotice(null);
    try {
      const team = await createTeam(clean);
      setName("");
      // Not an error, and worth saying: the name already existed and you are now in that team
      // rather than a second one with the same name.
      if (team.alreadyExisted) setNotice(`${team.name} already existed — you've joined it.`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create that team.");
    } finally {
      setBusy(null);
    }
  };

  const toggle = async (team: Team) => {
    setBusy(team.id);
    setError(null);
    setNotice(null);
    try {
      await (team.joined ? leaveTeam(team.id) : joinTeam(team.id));
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not change that membership.");
    } finally {
      setBusy(null);
    }
  };

  const card = (team: Team) => (
    <div
      key={team.id}
      className="rounded-xl border border-border/60 bg-card p-4 shadow-card transition-colors hover:border-primary/30"
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={() => setOpen(open === team.id ? null : team.id)}
            className="text-left text-[14px] font-semibold tracking-tight hover:text-primary"
          >
            {team.name}
          </button>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            {team.memberCount ?? 0} {team.memberCount === 1 ? "member" : "members"}
            {team.description ? ` · ${team.description}` : ""}
          </p>
        </div>
        {user ? (
          <button
            type="button"
            disabled={busy === team.id}
            onClick={() => void toggle(team)}
            className={cn(
              "shrink-0 border px-3 py-1 text-[11.5px] font-semibold transition-colors disabled:opacity-50",
              team.joined
                ? "border-border/60 text-muted-foreground hover:border-[var(--ev-error)]/40 hover:text-[var(--ev-error)]"
                : "border-primary/50 text-primary hover:bg-primary/10",
            )}
          >
            {busy === team.id ? "…" : team.joined ? "Leave" : "Join"}
          </button>
        ) : null}
      </div>

      {open === team.id && (
        <div className="mt-3 border-t border-border/50 pt-3">
          {sessionsFor !== team.id ? (
            <p className="text-[12px] text-muted-foreground">Loading this team's sessions…</p>
          ) : sessions.length === 0 ? (
            <p className="text-[12px] text-muted-foreground">
              Nothing filed against this team yet. Sessions are tagged with their reporter's teams
              when they're filed.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {sessions.slice(0, 8).map((bug) => (
                <li key={bug.humanId} className="flex items-center gap-2 text-[12.5px]">
                  <a
                    href={`/session/${bug.humanId}`}
                    className="font-mono text-[11px] text-muted-foreground hover:text-primary"
                  >
                    {bug.humanId}
                  </a>
                  <span className="min-w-0 flex-1 truncate">{bug.title}</span>
                  <BugSeverityPill severity={bug.severity} />
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {relativeTime(bug.createdAt)}
                  </span>
                </li>
              ))}
              {sessions.length > 8 && (
                <li className="pt-1 text-[11.5px] text-muted-foreground">
                  +{sessions.length - 8} more
                </li>
              )}
            </ul>
          )}
        </div>
      )}
    </div>
  );

  return (
    <div className="min-h-0 flex-1 overflow-y-auto scroll-thin bg-background">
      <div className="mx-auto max-w-4xl px-6 py-6" data-testid="teams-page">
        <div className="mb-5">
          <h1 className="text-[19px] font-bold tracking-tight">Teams</h1>
          <p className="text-[12.5px] text-muted-foreground">
            Join the groups you work in. A session is tagged with its reporter's teams when it's
            filed, so a team can look at its own work instead of the whole corpus.
          </p>
        </div>

        {user ? (
          <div className="mb-6 flex flex-wrap items-center gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void create();
                }
              }}
              maxLength={60}
              placeholder="Frontend, Retention, NDR, Growth…"
              aria-label="New team name"
              className="min-w-0 flex-1 rounded-lg border border-border/60 bg-card px-3 py-2 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            />
            <button
              type="button"
              onClick={() => void create()}
              disabled={!name.trim() || busy === "create"}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-[12.5px] font-semibold text-primary-foreground transition-opacity disabled:opacity-40"
            >
              <Plus className="size-3.5" />
              {busy === "create" ? "Creating…" : "Create team"}
            </button>
          </div>
        ) : (
          <p className="mb-6 rounded-lg border border-border/60 bg-card px-3 py-2 text-[12.5px] text-muted-foreground">
            Sign in to create a team or join one.
          </p>
        )}

        {error && (
          <p role="alert" className="mb-4 text-[12.5px] font-medium text-[var(--ev-error)]">
            {error}
          </p>
        )}
        {notice && (
          <p className="mb-4 inline-flex items-center gap-1.5 text-[12.5px] font-medium text-[var(--ev-ok,#10b981)]">
            <Check className="size-3.5" />
            {notice}
          </p>
        )}

        {loading ? (
          <p className="text-[12.5px] text-muted-foreground">Loading teams…</p>
        ) : teams.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/70 px-4 py-8 text-center">
            <Users className="mx-auto mb-2 size-5 text-muted-foreground/70" />
            <p className="text-[13px] font-medium">No teams yet</p>
            <p className="mt-1 text-[12.5px] text-muted-foreground">
              Create the first one above — Frontend, Retention, NDR, whatever your groups are.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {mine.length > 0 && (
              <section>
                <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/80">
                  Your teams
                </h2>
                <div className="space-y-2">{mine.map(card)}</div>
              </section>
            )}
            {others.length > 0 && (
              <section>
                <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/80">
                  {mine.length > 0 ? "Other teams" : "All teams"}
                </h2>
                <div className="space-y-2">{others.map(card)}</div>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
