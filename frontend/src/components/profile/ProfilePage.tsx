// ABOUTME: Your own account — the page that did not exist. Editing yourself was admin-only, so a
// ABOUTME: reporter who wanted their display name spelled correctly had to find an admin to do it
// ABOUTME: for them. Name and team are yours to change; role and admin are not, and are absent
// ABOUTME: here rather than disabled, because a control that exists and refuses invites the try.
import { useState } from "react";
import { Check, Loader2, ShieldCheck, Trash2, UserRound } from "lucide-react";

import type { AuthUser } from "@/lib/auth";
import { updateOwnProfile } from "@/lib/auth";
import { listTeams } from "@/lib/meta";
import { UserAvatar } from "@/components/common/bits";
import { cn } from "@/lib/utils";

export function ProfilePage({
  user,
  onUpdated,
  onDeleteAccount,
}: {
  user: AuthUser | null;
  onUpdated: (u: AuthUser) => void;
  onDeleteAccount?: () => void;
}) {
  const [name, setName] = useState(user?.name ?? "");
  const [team, setTeam] = useState(user?.team ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!user) {
    return (
      <div className="mx-auto w-full max-w-[720px] px-5 py-6">
        <p className="text-[13px] text-muted-foreground">Sign in to see your profile.</p>
      </div>
    );
  }

  const dirty = name.trim() !== user.name || team !== (user.team ?? "");
  const teams = listTeams();

  const save = async () => {
    if (!dirty || !name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const fresh = await updateOwnProfile({ name: name.trim(), team });
      onUpdated(fresh);
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save that.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-[720px] px-5 py-6">
      <header className="mb-5">
        <h1 className="text-[19px] font-bold tracking-tight">Your profile</h1>
        <p className="mt-1 text-[13px] text-muted-foreground">
          How you appear on the sessions you file and the ones assigned to you.
        </p>
      </header>

      <section className="rounded-xl border border-border/60 bg-card p-4 shadow-card">
        <div className="flex items-center gap-3 border-b border-border/50 pb-4">
          <UserAvatar name={user.name} seed={user.id} size={48} />
          <div className="min-w-0">
            <p className="truncate text-[15px] font-semibold">{user.name}</p>
            <p className="truncate text-[12px] text-muted-foreground">{user.email}</p>
          </div>
          {user.isAdmin && (
            <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wide text-primary">
              <ShieldCheck className="size-3" /> Admin
            </span>
          )}
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Display name" hint="Shown on every session you file or are assigned.">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void save()}
              maxLength={80}
              className="w-full rounded-lg border border-border/60 bg-background px-2.5 py-1.5 text-[13px] outline-none focus:border-primary/50"
            />
          </Field>

          <Field label="Team" hint="Groups your sessions with your teammates'.">
            <input
              list="bf-teams"
              value={team}
              onChange={(e) => setTeam(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void save()}
              maxLength={80}
              placeholder="e.g. Platform"
              className="w-full rounded-lg border border-border/60 bg-background px-2.5 py-1.5 text-[13px] outline-none focus:border-primary/50"
            />
            <datalist id="bf-teams">
              {teams.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          </Field>

          {/* Read-only, and said out loud rather than left to be discovered by a save that does
              nothing. Both are the admin's to set — self-service that can change either is a
              privilege escalation with a nice form around it. */}
          <Field label="Email" hint="Used to sign in. Ask an admin to change it.">
            <p className="rounded-lg border border-border/40 bg-muted/30 px-2.5 py-1.5 text-[13px] text-muted-foreground">
              {user.email}
            </p>
          </Field>
          <Field label="Role" hint="Set by an admin on the Team page.">
            <p className="rounded-lg border border-border/40 bg-muted/30 px-2.5 py-1.5 text-[13px] text-muted-foreground">
              {user.role}
            </p>
          </Field>
        </div>

        {error && <p className="mt-3 text-[12px] text-rose-600 dark:text-rose-400">{error}</p>}

        <div className="mt-4 flex items-center gap-2 border-t border-border/50 pt-4">
          <button
            type="button"
            onClick={() => void save()}
            disabled={!dirty || saving || !name.trim()}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[12.5px] font-semibold text-primary-foreground transition-opacity",
              (!dirty || saving || !name.trim()) && "opacity-40",
            )}
          >
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : saved ? <Check className="size-3.5" /> : null}
            {saved ? "Saved" : "Save changes"}
          </button>
          {dirty && !saving && (
            <button
              type="button"
              onClick={() => {
                setName(user.name);
                setTeam(user.team ?? "");
                setError(null);
              }}
              className="text-[12px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              Discard
            </button>
          )}
          {/* Renaming rewrites your name on sessions already filed. Worth saying, because the
              alternative — old sessions keeping the old name — is what people expect and would
              read as a bug either way. */}
          <span className="ml-auto text-[11px] text-muted-foreground">
            A new name is applied to sessions you already filed.
          </span>
        </div>
      </section>

      {onDeleteAccount && (
        <section className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/5 p-4">
          <h2 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-rose-700 dark:text-rose-400">
            <Trash2 className="size-3.5" /> Close your account
          </h2>
          <p className="mt-1.5 text-[12px] text-muted-foreground">
            Removes your login and takes you out of the assignee list. Sessions you filed stay —
            they are the team's record, not yours to withdraw.
          </p>
          <button
            type="button"
            onClick={onDeleteAccount}
            className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg border border-rose-500/50 px-2.5 py-1.5 text-[12px] font-semibold text-rose-700 transition-colors hover:bg-rose-500/10 dark:text-rose-400"
          >
            <UserRound className="size-3.5" /> Close account
          </button>
        </section>
      )}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">
        {label}
      </span>
      {children}
      <span className="mt-1 block text-[11px] text-muted-foreground/80">{hint}</span>
    </label>
  );
}
