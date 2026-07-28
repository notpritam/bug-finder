// ABOUTME: App shell — sidebar + bugs list / bug detail / drafts / draft review. Receives
// ABOUTME: extension captures via postMessage; drafts + submitted bugs persist to localStorage.
import { useEffect, useState } from "react";
import type { BugStatus, Draft } from "@/lib/types";
import { BUGS } from "@/lib/data";
import {
  bugFromDraft,
  draftFromExtension,
  loadDrafts,
  loadSubmittedBugs,
  saveDrafts,
  saveSubmittedBugs,
} from "@/lib/drafts";
import { Sidebar, type SidebarView } from "@/components/shell/Sidebar";
import { BugsPage } from "@/components/bugs/BugsPage";
import { BugDetail } from "@/components/bugs/BugDetail";
import { DraftsPage } from "@/components/drafts/DraftsPage";
import { DraftReview } from "@/components/drafts/DraftReview";

function App() {
  const [collapsed, setCollapsed] = useState(false);
  const [view, setView] = useState<SidebarView>(() =>
    new URLSearchParams(location.search).has("draft") ? "drafts" : "all",
  );
  const [selectedBugId, setSelectedBugId] = useState<string | null>(null);
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);
  const [bugs, setBugs] = useState(() => [...loadSubmittedBugs(), ...BUGS]);
  const [drafts, setDrafts] = useState<Draft[]>(loadDrafts);

  // Captures arriving from the extension bridge (postMessage) become drafts and open for review.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== window || e.data?.source !== "bugfinder-extension" || e.data.type !== "draft") return;
      const incoming = draftFromExtension(e.data.draft as Record<string, unknown>);
      window.postMessage({ source: "bugfinder-dashboard", type: "draft-received" }, "*");
      setDrafts((prev) => {
        if (prev.some((d) => d.id === incoming.id)) return prev;
        const next = [incoming, ...prev];
        saveDrafts(next);
        return next;
      });
      setView("drafts");
      setSelectedBugId(null);
      setSelectedDraftId(incoming.id);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const selectedBug = bugs.find((b) => b.id === selectedBugId) ?? null;
  const selectedDraft = drafts.find((d) => d.id === selectedDraftId) ?? null;

  const changeStatus = (id: string, status: BugStatus) => {
    setBugs((prev) => {
      const next = prev.map((b) => (b.id === id ? { ...b, status, updatedAt: Date.now() } : b));
      saveSubmittedBugs(next.filter((b) => !BUGS.some((seed) => seed.id === b.id)));
      return next;
    });
  };

  const updateDraft = (draft: Draft) => {
    setDrafts((prev) => {
      const next = prev.map((d) => (d.id === draft.id ? draft : d));
      saveDrafts(next);
      return next;
    });
  };

  const discardDraft = (id: string) => {
    setDrafts((prev) => {
      const next = prev.filter((d) => d.id !== id);
      saveDrafts(next);
      return next;
    });
    setSelectedDraftId(null);
  };

  const submitDraft = (draft: Draft) => {
    const bug = bugFromDraft(draft, bugs);
    setBugs((prev) => {
      const next = [bug, ...prev];
      saveSubmittedBugs(next.filter((b) => !BUGS.some((seed) => seed.id === b.id)));
      return next;
    });
    discardDraft(draft.id);
    setView("all");
    setSelectedBugId(bug.id);
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
          setSelectedDraftId(null);
        }}
        bugs={bugs}
        draftCount={drafts.length}
      />
      <main className="flex min-w-0 flex-1 flex-col">
        {selectedDraft ? (
          <DraftReview
            key={selectedDraft.id}
            draft={selectedDraft}
            onChange={updateDraft}
            onSubmit={submitDraft}
            onDiscard={discardDraft}
            onBack={() => setSelectedDraftId(null)}
          />
        ) : view === "drafts" ? (
          <DraftsPage drafts={drafts} onOpen={setSelectedDraftId} onDiscard={discardDraft} />
        ) : selectedBug ? (
          <BugDetail bug={selectedBug} onBack={() => setSelectedBugId(null)} onStatusChange={changeStatus} />
        ) : (
          <BugsPage bugs={bugs} view={view} onOpenBug={setSelectedBugId} onStatusChange={changeStatus} />
        )}
      </main>
    </div>
  );
}

export default App;
