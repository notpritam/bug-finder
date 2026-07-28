// ABOUTME: Collapsible left rail — brand mark, bug views with live counts, and a user footer.
import { Bug, ChevronsLeft, CircleDot, Inbox, LayoutDashboard, Loader2, ShieldCheck, UserRound } from "lucide-react";
import type { ReactNode } from "react";
import { BUGS, ME } from "@/lib/data";
import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/common/bits";

export type SidebarView = "all" | "open" | "in_progress" | "resolved" | "mine";

const VIEWS: { key: SidebarView; label: string; icon: ReactNode; match: (statusMine: { status: string; mine: boolean }) => boolean }[] = [
  { key: "all", label: "All bugs", icon: <Inbox className="size-[17px]" />, match: () => true },
  { key: "open", label: "Open", icon: <CircleDot className="size-[17px]" />, match: (b) => b.status === "open" },
  { key: "in_progress", label: "In progress", icon: <Loader2 className="size-[17px]" />, match: (b) => b.status === "in_progress" },
  { key: "resolved", label: "Resolved", icon: <ShieldCheck className="size-[17px]" />, match: (b) => b.status === "resolved" },
  { key: "mine", label: "Assigned to me", icon: <UserRound className="size-[17px]" />, match: (b) => b.mine },
];

export function Sidebar({
  collapsed,
  onToggleCollapse,
  view,
  onView,
}: {
  collapsed: boolean;
  onToggleCollapse: () => void;
  view: SidebarView;
  onView: (v: SidebarView) => void;
}) {
  const counts = VIEWS.map((v) => BUGS.filter((b) => v.match({ status: b.status, mine: b.assignee?.id === ME.id })).length);

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
            <Bug className="size-[18px]" />
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
        {!collapsed && (
          <p className="px-2 pb-1.5 pt-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/70">
            Views
          </p>
        )}
        {VIEWS.map((v, i) => (
          <button
            key={v.key}
            type="button"
            title={v.label}
            onClick={() => onView(v.key)}
            className={cn(
              "mb-0.5 flex h-9 w-full items-center gap-2.5 rounded-lg px-2 text-[13px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50",
              view === v.key
                ? "bg-sidebar-accent text-foreground"
                : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
              collapsed && "justify-center px-0",
            )}
          >
            {v.icon}
            {!collapsed && (
              <>
                <span className="flex-1 text-left">{v.label}</span>
                <span className="text-[11px] font-semibold text-muted-foreground/80">{counts[i]}</span>
              </>
            )}
          </button>
        ))}

        {!collapsed && (
          <p className="px-2 pb-1.5 pt-4 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/70">
            Coming soon
          </p>
        )}
        <div
          className={cn(
            "flex h-9 w-full cursor-not-allowed items-center gap-2.5 rounded-lg px-2 text-[13px] font-medium text-muted-foreground/50",
            collapsed && "justify-center px-0",
          )}
          title="Insights — coming soon"
        >
          <LayoutDashboard className="size-[17px]" />
          {!collapsed && "Insights"}
        </div>
      </nav>

      <footer className="border-t border-sidebar-border p-2.5">
        <div className={cn("flex items-center gap-2.5 rounded-lg px-1.5 py-1", collapsed && "justify-center px-0")}>
          <UserAvatar name={ME.name} seed={ME.id} size={30} />
          {!collapsed && (
            <div className="min-w-0">
              <p className="truncate text-[12.5px] font-semibold">{ME.name}</p>
              <p className="truncate text-[11px] text-muted-foreground">{ME.email}</p>
            </div>
          )}
        </div>
      </footer>
    </aside>
  );
}
