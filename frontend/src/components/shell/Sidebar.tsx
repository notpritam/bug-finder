// ABOUTME: Collapsible left rail — brand mark, bug views with live counts, drafts inbox,
// ABOUTME: workspace (initiatives + insights), and a user footer. Counts come from App state.
import {
  Bug as BugIcon,
  ChevronsLeft,
  CircleDot,
  FileVideo,
  Inbox,
  LayoutDashboard,
  Loader2,
  LogOut,
  Moon,
  Rocket,
  ShieldCheck,
  Sun,
  UserCheck,
  UserRound,
  Users,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import type { Bug } from "@/lib/types";
import type { AuthUser } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/common/bits";

export type SidebarView =
  | "all"
  | "open"
  | "in_progress"
  | "resolved"
  | "mine"
  | "reported"
  | "drafts"
  | "initiatives"
  | "insights"
  | "admin";

/** A session ruled "not a bug" is answered, and the list hides it by default. These badges have to
 *  agree with what the list shows, or the first thing someone does is count the rows and find one
 *  missing. The status-specific views below are unaffected — they already exclude it by definition. */
const live = (bugs: Bug[]) => bugs.filter((b) => b.status !== "not_a_bug");

const VIEWS: { key: SidebarView; label: string; icon: ReactNode; count: (bugs: Bug[], meId: string) => number }[] = [
  // "Sessions", not "bugs": a capture is a recorded session, and plenty are worth keeping
  // without being defects — regressions, questions, things to show someone.
  { key: "all", label: "All sessions", icon: <Inbox className="size-[17px]" />, count: (b) => live(b).length },
  { key: "open", label: "Open", icon: <CircleDot className="size-[17px]" />, count: (b) => b.filter((x) => x.status === "open").length },
  { key: "in_progress", label: "In progress", icon: <Loader2 className="size-[17px]" />, count: (b) => b.filter((x) => x.status === "in_progress").length },
  { key: "resolved", label: "Resolved", icon: <ShieldCheck className="size-[17px]" />, count: (b) => b.filter((x) => x.status === "resolved").length },
  // Reported-by-me and assigned-to-me are different questions — "what did I file" vs "what is
  // waiting on me" — and collapsing them hid one of the two.
  { key: "reported", label: "My sessions", icon: <UserRound className="size-[17px]" />, count: (b, meId) => live(b).filter((x) => x.reporter?.id === meId).length },
  { key: "mine", label: "Assigned to me", icon: <UserCheck className="size-[17px]" />, count: (b, meId) => live(b).filter((x) => x.assignee?.id === meId).length },
];

export function Sidebar({
  collapsed,
  onToggleCollapse,
  view,
  onView,
  bugs,
  draftCount,
  initiativeCount,
  user,
  onSignIn,
  onSignOut,
}: {
  collapsed: boolean;
  onToggleCollapse: () => void;
  view: SidebarView;
  onView: (v: SidebarView) => void;
  bugs: Bug[];
  draftCount: number;
  initiativeCount: number;
  user: AuthUser | null;
  onSignIn: () => void;
  onSignOut: () => void;
}) {
  return (
    <aside
      className={cn(
        "flex h-full shrink-0 flex-col border-r border-sidebar-border bg-sidebar transition-[width] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]",
        collapsed ? "w-[64px]" : "w-[240px]",
      )}
    >
      <div className="flex h-14 items-center gap-2 px-3">
        <button
          type="button"
          onClick={onToggleCollapse}
          className="flex items-center gap-2.5 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground shadow-card">
            <BugIcon className="size-[18px]" />
          </span>
          {!collapsed && <span className="text-[15px] font-bold tracking-tight">Bug Finder</span>}
        </button>
        {!collapsed && (
          <button
            type="button"
            onClick={onToggleCollapse}
            className="ml-auto grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            aria-label="Collapse sidebar"
          >
            <ChevronsLeft className="size-4" />
          </button>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto scroll-thin px-2.5 py-2">
        {/* Bug views require an account — guests only get their drafts. */}
        {user && (
          <>
            {!collapsed && (
              <p className="px-2 pb-1.5 pt-1 text-[12px] font-normal text-muted-foreground">
                Views
              </p>
            )}
            {VIEWS.map((v) => (
              <NavRow
                key={v.key}
                collapsed={collapsed}
                icon={v.icon}
                label={v.label}
                count={v.count(bugs, user.id)}
                active={view === v.key}
                onClick={() => onView(v.key)}
              />
            ))}
          </>
        )}

        {!collapsed && (
          <p className="px-2 pb-1.5 pt-4 text-[12px] font-normal text-muted-foreground">
            Inbox
          </p>
        )}
        <NavRow
          collapsed={collapsed}
          icon={<FileVideo className="size-[17px]" />}
          label="Drafts"
          count={draftCount}
          active={view === "drafts"}
          onClick={() => onView("drafts")}
          highlight={draftCount > 0}
        />

        {user && (
          <>
            {!collapsed && (
              <p className="px-2 pb-1.5 pt-4 text-[12px] font-normal text-muted-foreground">
                Workspace
              </p>
            )}
            <NavRow
              collapsed={collapsed}
              icon={<Rocket className="size-[17px]" />}
              label="Initiatives"
              count={initiativeCount}
              active={view === "initiatives"}
              onClick={() => onView("initiatives")}
            />
            <NavRow
              collapsed={collapsed}
              icon={<LayoutDashboard className="size-[17px]" />}
              label="Insights"
              active={view === "insights"}
              onClick={() => onView("insights")}
            />
            {/* Account management. Hidden from non-admins as a courtesy — the server is what
                actually refuses them. */}
            {user.isAdmin && (
              <NavRow
                collapsed={collapsed}
                icon={<Users className="size-[17px]" />}
                label="Team"
                active={view === "admin"}
                onClick={() => onView("admin")}
              />
            )}
          </>
        )}
      </nav>

      <footer className="border-t border-sidebar-border p-2.5">
        <div className={cn("flex items-center gap-2.5 rounded-lg px-1.5 py-1", collapsed && "justify-center px-0")}>
          {user ? (
            <UserAvatar name={user.name} seed={user.id} size={30} />
          ) : (
            <span className="grid size-[30px] shrink-0 place-items-center rounded-full bg-sidebar-accent text-muted-foreground">
              <UserRound className="size-4" />
            </span>
          )}
          {!collapsed && (
            <div className="min-w-0 flex-1">
              {user ? (
                <>
                  <p className="truncate text-[12.5px] font-semibold">{user.name}</p>
                  <p className="truncate text-[10.5px] text-muted-foreground">
                    {user.role} · {user.team}
                  </p>
                </>
              ) : (
                <button
                  type="button"
                  onClick={onSignIn}
                  className="rounded-md text-left text-[12.5px] font-semibold text-foreground transition-colors hover:text-muted-foreground"
                  title="Sign in or create an account"
                >
                  Sign in
                  <span className="block text-[10.5px] font-normal text-muted-foreground">Browsing as guest</span>
                </button>
              )}
            </div>
          )}
          {!collapsed && (
            <>
              <ThemeToggle />
              {user && (
                <button
                  type="button"
                  onClick={onSignOut}
                  className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                  title="Sign out"
                  aria-label="Sign out"
                >
                  <LogOut className="size-4" />
                </button>
              )}
            </>
          )}
        </div>
        {collapsed && (
          <div className="mt-1 flex flex-col items-center gap-1">
            <ThemeToggle />
            {user ? (
              <button
                type="button"
                onClick={onSignOut}
                className="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
                title="Sign out"
                aria-label="Sign out"
              >
                <LogOut className="size-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={onSignIn}
                className="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
                title="Sign in"
                aria-label="Sign in"
              >
                <UserRound className="size-4" />
              </button>
            )}
          </div>
        )}
      </footer>
    </aside>
  );
}

/** Light/dark switch — flips the root class and persists; index.html re-applies before paint. */
function ThemeToggle() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("bf.theme", next ? "dark" : "light");
    } catch {
      /* private mode */
    }
  };
  return (
    <button
      type="button"
      onClick={toggle}
      className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      title={dark ? "Switch to light theme" : "Switch to dark theme"}
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
    >
      {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </button>
  );
}

function NavRow({
  collapsed,
  icon,
  label,
  count,
  active,
  onClick,
  highlight,
}: {
  collapsed: boolean;
  icon: ReactNode;
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
  highlight?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      onClick={onClick}
      className={cn(
        "mb-0.5 flex h-9 w-full items-center gap-2.5 rounded-lg px-2 text-[13px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50",
        active ? "bg-sidebar-accent text-foreground" : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
        collapsed && "justify-center px-0",
      )}
      data-testid={`nav-${label.toLowerCase().replace(/\s+/g, "-")}`}
    >
      {icon}
      {!collapsed && (
        <>
          <span className="flex-1 text-left">{label}</span>
          {count != null && (
            <span
              className={cn(
                "text-[11px] font-semibold",
                highlight ? "rounded-full bg-amber-100 px-1.5 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400" : "text-muted-foreground/80",
              )}
            >
              {count}
            </span>
          )}
        </>
      )}
    </button>
  );
}
