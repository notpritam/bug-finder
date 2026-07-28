// ABOUTME: Sign in / create account gate — collects role + team at signup so every report
// ABOUTME: carries org context. Local accounts until a real backend exists.
import { useState, type FormEvent } from "react";
import { Bug as BugIcon, Loader2 } from "lucide-react";
import { signIn, signUp, type AuthUser } from "@/lib/auth";
import { addTeam, listTeams, ROLES, type Role } from "@/lib/meta";
import { cn } from "@/lib/utils";

const NEW_TEAM = "__new__";

export function AuthScreen({ onAuthed }: { onAuthed: (user: AuthUser) => void }) {
  const [mode, setMode] = useState<"signin" | "signup">("signup");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("QA Engineer");
  const [team, setTeam] = useState(listTeams()[0]);
  const [newTeam, setNewTeam] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (mode === "signin") {
        onAuthed(await signIn(email, password));
      } else {
        const chosenTeam = team === NEW_TEAM ? newTeam.trim() : team;
        if (!chosenTeam) throw new Error("Pick or create a team.");
        if (team === NEW_TEAM) addTeam(chosenTeam);
        onAuthed(await signUp({ name, email, password, role, team: chosenTeam }));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const field =
    "h-9 w-full rounded-lg border border-border/60 bg-card px-2.5 text-[13px] outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary/50";
  const label = "mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/80";

  return (
    <div className="grid h-full place-items-center overflow-y-auto bg-background p-6">
      <div className="w-full max-w-md">
        <div className="mb-5 flex items-center justify-center gap-2.5">
          <span className="grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground shadow-card">
            <BugIcon className="size-5" />
          </span>
          <span className="text-[19px] font-bold tracking-tight">Bug Finder</span>
        </div>

        <div className="rounded-xl border border-border/60 bg-card p-5 shadow-card">
          <div className="mb-4 grid grid-cols-2 rounded-lg bg-muted p-0.5">
            {(["signup", "signin"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setMode(m);
                  setError(null);
                }}
                className={cn(
                  "rounded-md py-1.5 text-[12.5px] font-semibold transition-colors",
                  mode === m ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {m === "signup" ? "Create account" : "Sign in"}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="space-y-3">
            {mode === "signup" && (
              <div>
                <label htmlFor="auth-name" className={label}>
                  Name
                </label>
                <input id="auth-name" type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ada Lovelace" className={field} autoComplete="name" />
              </div>
            )}
            <div>
              <label htmlFor="auth-email" className={label}>
                Email
              </label>
              <input id="auth-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" className={field} autoComplete="email" />
            </div>
            <div>
              <label htmlFor="auth-password" className={label}>
                Password
              </label>
              <input
                id="auth-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === "signup" ? "At least 6 characters" : "Your password"}
                className={field}
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
              />
            </div>

            {mode === "signup" && (
              <>
                <div>
                  <span className={label}>Your role</span>
                  <div className="flex flex-wrap gap-1.5">
                    {ROLES.map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => setRole(r)}
                        aria-pressed={role === r}
                        className={cn(
                          "rounded-full px-2.5 py-1 text-[11.5px] font-medium transition-colors",
                          role === r ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label htmlFor="auth-team" className={label}>
                    Team
                  </label>
                  <select id="auth-team" value={team} onChange={(e) => setTeam(e.target.value)} className={field}>
                    {listTeams().map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                    <option value={NEW_TEAM}>+ New team…</option>
                  </select>
                  {team === NEW_TEAM && (
                    <input
                      type="text"
                      value={newTeam}
                      onChange={(e) => setNewTeam(e.target.value)}
                      placeholder="Team name"
                      className={cn(field, "mt-2")}
                    />
                  )}
                </div>
              </>
            )}

            {error && (
              <p className="rounded-lg border border-destructive/30 bg-destructive/[0.06] px-3 py-2 text-[12px] font-medium text-destructive" role="alert">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-primary text-[13px] font-bold text-primary-foreground shadow-card transition hover:opacity-90 disabled:opacity-60"
            >
              {busy && <Loader2 className="size-4 animate-spin" />}
              {mode === "signup" ? "Create account" : "Sign in"}
            </button>
          </form>
        </div>

        <p className="mt-4 text-center text-[11.5px] leading-relaxed text-muted-foreground">
          Your account ties every report, draft, and comment to you — and the extension requires a
          signed-in session before it will record.
        </p>
      </div>
    </div>
  );
}
