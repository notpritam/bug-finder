// ABOUTME: App shell — sidebar + either the bugs list or a bug's detail. Status edits mutate
// ABOUTME: the in-memory dummy dataset until the real API exists.
import { useState } from "react";
import type { BugStatus } from "@/lib/types";
import { BUGS } from "@/lib/data";
import { Sidebar, type SidebarView } from "@/components/shell/Sidebar";
import { BugsPage } from "@/components/bugs/BugsPage";
import { BugDetail } from "@/components/bugs/BugDetail";

function App() {
  const [collapsed, setCollapsed] = useState(false);
  const [view, setView] = useState<SidebarView>("all");
  const [selectedBugId, setSelectedBugId] = useState<string | null>(null);
  const [bugs, setBugs] = useState(BUGS);

  const selected = bugs.find((b) => b.id === selectedBugId) ?? null;

  const changeStatus = (id: string, status: BugStatus) => {
    setBugs((prev) => prev.map((b) => (b.id === id ? { ...b, status, updatedAt: Date.now() } : b)));
  };

  return (
    <div className="flex h-full">
      <Sidebar
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed((c) => !c)}
        view={view}
        onView={(v) => {
          setView(v);
          setSelectedBugId(null);
        }}
      />
      <main className="flex min-w-0 flex-1 flex-col">
        {selected ? (
          <BugDetail bug={selected} onBack={() => setSelectedBugId(null)} onStatusChange={changeStatus} />
        ) : (
          <BugsPage bugs={bugs} view={view} onOpenBug={setSelectedBugId} onStatusChange={changeStatus} />
        )}
      </main>
    </div>
  );
}

export default App;
