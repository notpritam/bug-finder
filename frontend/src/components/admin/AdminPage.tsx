// ABOUTME: Team admin — the real account roster, creating a teammate so they are assignable
// ABOUTME: straight away, editing role/team, granting or revoking admin, and deleting accounts.
// ABOUTME: Server-gated: this page only decides what to draw, never what is allowed.
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Loader2, ShieldCheck, Trash2, UserPlus, Users } from "lucide-react";
import type { AuthUser } from "@/lib/auth";
import { createUser, deleteUser, listUsers, patchUser, type AdminUser } from "@/lib/admin";
import { ROLES, listTeams } from "@/lib/meta";
import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/common/bits";

export function AdminPage({ user }: { user: AuthUser | null }) {
  const [rows, setRows] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const teams = useMemo(() => listTeams(), []);

  const refresh = useCallback(async () => {
    try {
      setRows(await listUsers());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const mutate = async (id: string, run: () => Promise<unknown>) => {
    setBusyId(id);
    setError(null);
    try {
      await run();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const remove = (row: AdminUser) =>
    mutate(row.id, async () => {
      const res = await deleteUser(row.id);
      setConfirmId(null);
      const moved = [
        res.bugsUnassigned ? `${res.bugsUnassigned} session(s) unassigned` : "",
        res.initiativesReassigned ? `${res.initiativesReassigned} initiative(s) reassigned to you` : "",
      ].filter(Boolean);
      setNotice(`Deleted ${row.name}${moved.length ? ` — ${moved.join(", ")}.` : "."}`);
    });

  if (!user?.isAdmin) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto scroll-thin bg-background">
        <div className="mx-auto max-w-5xl px-6 py-16 text-center">
          <ShieldCheck className="mx-auto size-8 text-muted-foreground/50" />
          <h1 className="mt-3 text-[19px] font-bold tracking-tight">Admins only</h1>
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            Ask an admin to grant you access from this page.
          </p>
        </div>
      </div>
    );
  }

  const admins = rows.filter((r) => r.isAdmin).length;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto scroll-thin bg-background">
      <div className="mx-auto max-w-5xl px-6 py-6" data-testid="admin-page">
        <h1 className="text-[19px] font-bold tracking-tight">Team</h1>
        <p className="text-[12.5px] text-muted-foreground">
          Everyone with an account. This is exactly the list you can assign a session to — there is no
          demo roster behind it any more.
        </p>

        <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          <Stat label="Accounts" value={rows.length} />
          <Stat label="Admins" value={admins} />
          <Stat label="Teams" value={new Set(rows.map((r) => r.team).filter(Boolean)).size} />
        </div>

        {notice && (
          <p className="mt-4 rounded-lg border border-border/60 bg-card px-3 py-2 text-[12px] text-muted-foreground">
            {notice}
          </p>
        )}
        {error && (
          <p className="mt-4 flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-[12px] text-destructive">
            <AlertTriangle className="mt-px size-3.5 shrink-0" />
            {error}
          </p>
        )}

        <AddTeammate
          teams={teams}
          onCreate={async (input) => {
            await createUser(input);
            await refresh();
            setNotice(`${input.name} can sign in with that email and password, and is assignable now.`);
          }}
        />

        <p className="mb-2 mt-6 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/80">
          Accounts
        </p>
        {loading ? (
          <div className="rounded-xl border border-dashed border-border/70 py-12 text-center text-[12.5px] text-muted-foreground">
            <Loader2 className="mx-auto size-4 animate-spin" />
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/70 py-12 text-center text-[12.5px] text-muted-foreground">
            No accounts yet.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border/60 bg-card shadow-card">
            <table className="w-full text-[12px]" data-testid="admin-users-table">
              <thead>
                <tr className="border-b border-border/60 text-left text-[10px] uppercase tracking-wide text-muted-foreground/70">
                  <th className="px-3 py-2 font-semibold">Person</th>
                  <th className="px-3 py-2 font-semibold">Role</th>
                  <th className="px-3 py-2 font-semibold">Team</th>
                  <th className="px-3 py-2 text-right font-semibold">Assigned</th>
                  <th className="px-3 py-2 text-right font-semibold">Reported</th>
                  <th className="px-3 py-2 font-semibold">Admin</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const busy = busyId === r.id;
                  const isMe = r.id === user.id;
                  return (
                    <tr key={r.id} className={cn("border-b border-border/40 last:border-0", busy && "opacity-50")}>
                      <td className="px-3 py-2.5">
                        <span className="flex items-center gap-2">
                          <UserAvatar name={r.name} seed={r.id} size={24} />
                          <span className="min-w-0">
                            <span className="block truncate font-medium text-foreground">
                              {r.name}
                              {isMe && <span className="ml-1.5 text-[10px] text-muted-foreground">(you)</span>}
                            </span>
                            <span className="block truncate text-[11px] text-muted-foreground">{r.email}</span>
                          </span>
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <Picker
                          value={r.role}
                          options={ROLES as readonly string[]}
                          disabled={busy}
                          onChange={(role) => mutate(r.id, () => patchUser(r.id, { role }))}
                          label={`Role for ${r.name}`}
                        />
                      </td>
                      <td className="px-3 py-2.5">
                        <Picker
                          value={r.team}
                          options={teams}
                          disabled={busy}
                          onChange={(team) => mutate(r.id, () => patchUser(r.id, { team }))}
                          label={`Team for ${r.name}`}
                        />
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{r.assignedCount}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{r.reportedCount}</td>
                      <td className="px-3 py-2.5">
                        {r.isBootstrapAdmin ? (
                          <span
                            className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-1.5 py-0.5 text-[10.5px] font-medium text-primary"
                            title="Admin in code — cannot be revoked here."
                          >
                            <ShieldCheck className="size-3" /> Always
                          </span>
                        ) : (
                          <label className="inline-flex cursor-pointer items-center gap-1.5">
                            <input
                              type="checkbox"
                              className="size-3.5 cursor-pointer accent-primary"
                              checked={r.isAdmin}
                              disabled={busy || (isMe && r.isAdmin)}
                              aria-label={`Admin access for ${r.name}`}
                              onChange={(e) => mutate(r.id, () => patchUser(r.id, { isAdmin: e.target.checked }))}
                            />
                            <span className="text-[11px] text-muted-foreground">{r.isAdmin ? "Admin" : "—"}</span>
                          </label>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        {isMe ? (
                          <span className="text-[11px] text-muted-foreground/60">—</span>
                        ) : confirmId === r.id ? (
                          <span className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void remove(r)}
                              className="rounded-md bg-destructive px-2 py-1 text-[11px] font-medium text-destructive-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                            >
                              Delete
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmId(null)}
                              className="rounded-md px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent"
                            >
                              Cancel
                            </button>
                          </span>
                        ) : (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => setConfirmId(r.id)}
                            aria-label={`Delete ${r.name}`}
                            className="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground/80">
          Deleting an account keeps the sessions that person reported — a report is a record of what
          happened. Anything assigned to them becomes unassigned, and initiatives they owned move to you,
          so nothing is left pointing at an account that no longer exists.
        </p>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card px-3 py-2.5 shadow-card">
      <p className="text-[10.5px] uppercase tracking-wide text-muted-foreground/70">{label}</p>
      <p className="text-[19px] font-bold tabular-nums tracking-tight">{value}</p>
    </div>
  );
}

function Picker({
  value,
  options,
  disabled,
  onChange,
  label,
}: {
  value: string;
  options: readonly string[];
  disabled?: boolean;
  onChange: (v: string) => void;
  label: string;
}) {
  // An unknown stored value (a role removed from meta.ts, say) must still be selectable, or
  // opening the dropdown would silently rewrite it to the first option.
  const opts = options.includes(value) || !value ? options : [value, ...options];
  return (
    <select
      value={value}
      disabled={disabled}
      aria-label={label}
      onChange={(e) => onChange(e.target.value)}
      className="max-w-[150px] cursor-pointer truncate rounded-md border border-border/60 bg-background px-1.5 py-1 text-[11.5px] outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50"
    >
      {opts.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

function AddTeammate({
  teams,
  onCreate,
}: {
  teams: string[];
  onCreate: (input: {
    name: string;
    email: string;
    password: string;
    role: string;
    team: string;
    isAdmin: boolean;
  }) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<string>(ROLES[0]);
  const [team, setTeam] = useState(teams[0] ?? "Platform");
  const [makeAdmin, setMakeAdmin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setErr(null);
    if (!name.trim()) return setErr("Name is required.");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) return setErr("Enter a valid email address.");
    if (password.length < 8) return setErr("Password needs at least 8 characters.");
    setBusy(true);
    try {
      await onCreate({ name: name.trim(), email: email.trim().toLowerCase(), password, role, team, isAdmin: makeAdmin });
      setName("");
      setEmail("");
      setPassword("");
      setMakeAdmin(false);
      setOpen(false);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid="admin-add-teammate"
        className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-card px-3 py-1.5 text-[12px] font-medium shadow-card transition-colors hover:bg-accent"
      >
        <UserPlus className="size-3.5" /> Add teammate
      </button>
    );
  }

  return (
    <div className="mt-4 rounded-xl border border-border/60 bg-card p-3.5 shadow-card">
      <p className="mb-2.5 flex items-center gap-1.5 text-[12px] font-semibold">
        <Users className="size-3.5" /> Add teammate
      </p>
      <div className="grid gap-2.5 sm:grid-cols-2">
        <Field label="Name" value={name} onChange={setName} placeholder="Ankit Raj" />
        <Field label="Email" value={email} onChange={setEmail} placeholder="ankit@emergent.sh" type="email" />
        <Field
          label="Temporary password"
          value={password}
          onChange={setPassword}
          placeholder="at least 8 characters"
          type="password"
        />
        <div className="grid grid-cols-2 gap-2.5">
          <label className="block">
            <span className="mb-1 block text-[10.5px] uppercase tracking-wide text-muted-foreground/70">Role</span>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="w-full cursor-pointer rounded-md border border-border/60 bg-background px-2 py-1.5 text-[12px] outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[10.5px] uppercase tracking-wide text-muted-foreground/70">Team</span>
            <select
              value={team}
              onChange={(e) => setTeam(e.target.value)}
              className="w-full cursor-pointer rounded-md border border-border/60 bg-background px-2 py-1.5 text-[12px] outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              {teams.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {err && (
        <p className="mt-2.5 flex items-start gap-1.5 text-[11.5px] text-destructive">
          <AlertTriangle className="mt-px size-3.5 shrink-0" />
          {err}
        </p>
      )}

      <div className="mt-3 flex items-center gap-2.5">
        <button
          type="button"
          disabled={busy}
          onClick={() => void submit()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[12px] font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {busy && <Loader2 className="size-3.5 animate-spin" />}
          Create account
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-lg px-2.5 py-1.5 text-[12px] text-muted-foreground transition-colors hover:bg-accent"
        >
          Cancel
        </button>
        <label className="ml-auto inline-flex cursor-pointer items-center gap-1.5 text-[11.5px] text-muted-foreground">
          <input
            type="checkbox"
            className="size-3.5 cursor-pointer accent-primary"
            checked={makeAdmin}
            onChange={(e) => setMakeAdmin(e.target.checked)}
          />
          Make admin
        </label>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground/80">
        They sign in with this email and password — tell them to change it once they are in.
      </p>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10.5px] uppercase tracking-wide text-muted-foreground/70">{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-border/60 bg-background px-2 py-1.5 text-[12px] outline-none placeholder:text-muted-foreground/50 focus-visible:ring-2 focus-visible:ring-ring/50"
      />
    </label>
  );
}
