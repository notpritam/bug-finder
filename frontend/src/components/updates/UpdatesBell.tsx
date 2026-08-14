// ABOUTME: The bell — unread count, what changed, and the controls for both. Preferences live
// ABOUTME: here rather than in a settings page nobody visits: the moment you want to mute status
// ABOUTME: changes is the moment you are looking at a list full of them.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, Check, MessageSquare, Settings2, Sparkles, Tag, UserCog, Wrench } from "lucide-react";

import {
  DEFAULT_PREFS,
  UPDATE_KINDS,
  fetchUpdates,
  loadPrefs,
  markRead,
  savePrefs,
  type FeedUpdate,
  type UpdateKind,
  type UpdatePrefs,
} from "@/lib/updates-api";
import { cn } from "@/lib/utils";

const ICON: Record<UpdateKind, typeof Bell> = {
  comment: MessageSquare,
  bug_filed: Sparkles,
  status: Wrench,
  severity: Tag,
  assignment: UserCog,
  evidence: Sparkles,
};

export function UpdatesBell() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [showPrefs, setShowPrefs] = useState(false);
  const [updates, setUpdates] = useState<FeedUpdate[]>([]);
  const [prefs, setPrefs] = useState<UpdatePrefs>(() => loadPrefs());
  const box = useRef<HTMLDivElement>(null);

  const poll = useCallback(async () => {
    const res = await fetchUpdates();
    setUpdates(res.updates);
  }, []);

  useEffect(() => {
    void poll();
    const t = setInterval(() => void poll(), prefs.pollSeconds * 1000);
    // Re-poll on refocus: someone coming back to the tab wants the current answer, not one from
    // however long ago the interval last fired.
    const onFocus = () => void poll();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", onFocus);
    };
  }, [poll, prefs.pollSeconds]);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) {
        setOpen(false);
        setShowPrefs(false);
      }
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  const shown = useMemo(() => updates.filter((u) => prefs.kinds.includes(u.kind)), [updates, prefs.kinds]);

  const clear = async () => {
    const newest = updates.reduce((n, u) => Math.max(n, u.at), 0);
    if (newest) await markRead(newest);
    setUpdates([]);
  };

  const toggleKind = (kind: UpdateKind) => {
    const next = {
      ...prefs,
      kinds: prefs.kinds.includes(kind) ? prefs.kinds.filter((k) => k !== kind) : [...prefs.kinds, kind],
    };
    setPrefs(next);
    savePrefs(next);
  };

  const setPoll = (pollSeconds: number) => {
    const next = { ...prefs, pollSeconds };
    setPrefs(next);
    savePrefs(next);
  };

  return (
    <div className="relative" ref={box}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={shown.length ? `${shown.length} update${shown.length === 1 ? "" : "s"}` : "No new updates"}
        aria-label="Updates"
        className="relative grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <Bell className="size-4" />
        {shown.length > 0 && (
          <span className="absolute -right-0.5 -top-0.5 grid min-w-[15px] place-items-center bg-amber-500 px-1 text-[9px] font-bold leading-[15px] text-white">
            {shown.length > 9 ? "9+" : shown.length}
          </span>
        )}
      </button>

      {open && (
        /* Opens up and to the RIGHT. The bell lives in a left-edge rail 240px wide (64px when
           collapsed) and this panel is 330px, so anchoring its right edge to the bell — the reflex
           for a dropdown — pushed most of it past the left edge of the viewport. Anchoring left
           instead lets it extend over the main column, which is the empty direction. bottom-full
           rather than a fixed offset, so it sits above the bell whatever its height. */
        <div className="absolute bottom-full left-0 z-50 mb-2 w-[330px] max-w-[calc(100vw-2rem)] rounded-xl border border-border/70 bg-popover p-2 shadow-lg">
          <header className="flex items-center gap-1.5 px-1.5 pb-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              Updates
            </span>
            <div className="ml-auto flex items-center gap-0.5">
              <button
                type="button"
                onClick={() => setShowPrefs((v) => !v)}
                title="What to notify me about"
                className={cn(
                  "grid size-6 place-items-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
                  showPrefs && "bg-accent text-foreground",
                )}
              >
                <Settings2 className="size-3.5" />
              </button>
              {shown.length > 0 && (
                <button
                  type="button"
                  onClick={() => void clear()}
                  title="Mark all as read"
                  className="grid size-6 place-items-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <Check className="size-3.5" />
                </button>
              )}
            </div>
          </header>

          {showPrefs ? (
            <div className="px-1.5 pb-1">
              <p className="mb-1.5 text-[11px] text-muted-foreground">Tell me about</p>
              <div className="grid grid-cols-2 gap-1">
                {UPDATE_KINDS.map(({ key, label }) => (
                  <label
                    key={key}
                    className="flex cursor-pointer items-center gap-1.5 rounded px-1 py-1 text-[12px] hover:bg-accent"
                  >
                    <input
                      type="checkbox"
                      checked={prefs.kinds.includes(key)}
                      onChange={() => toggleKind(key)}
                      className="size-3.5 accent-amber-500"
                    />
                    {label}
                  </label>
                ))}
              </div>
              <p className="mb-1.5 mt-3 text-[11px] text-muted-foreground">Check every</p>
              <div className="flex gap-1">
                {[10, 30, 60, 300].map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setPoll(s)}
                    className={cn(
                      "rounded-md border px-2 py-1 text-[11px] font-medium transition-colors",
                      prefs.pollSeconds === s
                        ? "border-amber-500/50 bg-amber-500/10 text-foreground"
                        : "border-border/60 text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {s < 60 ? `${s}s` : `${s / 60}m`}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => {
                  setPrefs(DEFAULT_PREFS);
                  savePrefs(DEFAULT_PREFS);
                }}
                className="mt-3 text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
              >
                Reset to defaults
              </button>
            </div>
          ) : shown.length === 0 ? (
            <p className="px-1.5 py-4 text-center text-[12px] text-muted-foreground">
              Nothing new on what you follow.
              <span className="mt-1 block text-[11px] opacity-80">
                Follow a session or an initiative to see changes here.
              </span>
            </p>
          ) : (
            <ul className="max-h-[320px] space-y-0.5 overflow-y-auto scroll-thin">
              {[...shown].reverse().map((u, i) => {
                const Icon = ICON[u.kind] ?? Bell;
                return (
                  <li key={`${u.at}-${i}`}>
                    <button
                      type="button"
                      disabled={!u.bugHumanId}
                      onClick={() => {
                        if (!u.bugHumanId) return;
                        setOpen(false);
                        navigate(`/session/${u.bugHumanId}`);
                      }}
                      className="flex w-full gap-2 rounded-lg px-1.5 py-1.5 text-left transition-colors enabled:hover:bg-accent disabled:cursor-default"
                    >
                      <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[12px] leading-snug">{u.summary}</span>
                        <span className="mt-0.5 block text-[10.5px] text-muted-foreground">
                          {relative(u.at)}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function relative(at: number): string {
  const s = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
