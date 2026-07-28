// ABOUTME: App shell + URL routing — every screen has a shareable URL (/bugs/:view, /bug/:humanId,
// ABOUTME: /drafts/:id) and browser back/forward works. Data still lives in memory + localStorage.
import { useEffect, useState } from "react";
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
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

/** URL path segment ⇄ sidebar view. */
const VIEW_TO_PATH: Record<SidebarView, string> = {
  all: "/bugs",
  open: "/bugs/open",
  in_progress: "/bugs/in-progress",
  resolved: "/bugs/resolved",
  mine: "/bugs/mine",
  drafts: "/drafts",
};
const PATH_TO_VIEW: Record<string, SidebarView> = {
  open: "open",
  "in-progress": "in_progress",
  resolved: "resolved",
  mine: "mine",
};

function Shell() {
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [bugs, setBugs] = useState(() => [...loadSubmittedBugs(), ...BUGS]);
  const [drafts, setDrafts] = useState<Draft[]>(loadDrafts);

  // Captures arriving from the extension bridge become drafts and open for review.
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
      navigate(`/drafts/${incoming.id}`);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [navigate]);

  // Sidebar highlight from the URL.
  const seg = location.pathname.split("/").filter(Boolean);
  const activeView: SidebarView =
    seg[0] === "drafts" ? "drafts" : seg[0] === "bugs" ? (PATH_TO_VIEW[seg[1]] ?? "all") : "all";

  const persistSubmitted = (next: typeof bugs) =>
    saveSubmittedBugs(next.filter((b) => !BUGS.some((seed) => seed.id === b.id)));

  const changeStatus = (id: string, status: BugStatus) => {
    setBugs((prev) => {
      const next = prev.map((b) => (b.id === id ? { ...b, status, updatedAt: Date.now() } : b));
      persistSubmitted(next);
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
    navigate("/drafts");
  };

  const submitDraft = (draft: Draft) => {
    const bug = bugFromDraft(draft, bugs);
    setBugs((prev) => {
      const next = [bug, ...prev];
      persistSubmitted(next);
      return next;
    });
    setDrafts((prev) => {
      const next = prev.filter((d) => d.id !== draft.id);
      saveDrafts(next);
      return next;
    });
    navigate(`/bug/${bug.humanId}`, { replace: true });
  };

  return (
    <div className="flex h-full">
      <Sidebar
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed((c) => !c)}
        view={activeView}
        onView={(v) => navigate(VIEW_TO_PATH[v])}
        bugs={bugs}
        draftCount={drafts.length}
      />
      <main className="flex min-w-0 flex-1 flex-col">
        <Routes>
          <Route path="/" element={<Navigate to="/bugs" replace />} />
          <Route
            path="/bugs/:view?"
            element={<BugsRoute bugs={bugs} onStatusChange={changeStatus} />}
          />
          <Route path="/bug/:humanId" element={<BugRoute bugs={bugs} onStatusChange={changeStatus} />} />
          <Route
            path="/drafts"
            element={<DraftsPage drafts={drafts} onOpen={(id) => navigate(`/drafts/${id}`)} onDiscard={discardDraft} />}
          />
          <Route
            path="/drafts/:id"
            element={
              <DraftRoute drafts={drafts} onChange={updateDraft} onSubmit={submitDraft} onDiscard={discardDraft} />
            }
          />
          <Route path="*" element={<Navigate to="/bugs" replace />} />
        </Routes>
      </main>
    </div>
  );
}

function BugsRoute({
  bugs,
  onStatusChange,
}: {
  bugs: ReturnType<typeof loadSubmittedBugs>;
  onStatusChange: (id: string, status: BugStatus) => void;
}) {
  const navigate = useNavigate();
  const { view } = useParams();
  const sidebarView: SidebarView = PATH_TO_VIEW[view ?? ""] ?? "all";
  if (view && !PATH_TO_VIEW[view]) return <Navigate to="/bugs" replace />;
  return (
    <BugsPage
      bugs={bugs}
      view={sidebarView}
      onOpenBug={(id) => {
        const bug = bugs.find((b) => b.id === id);
        if (bug) navigate(`/bug/${bug.humanId}`);
      }}
      onStatusChange={onStatusChange}
    />
  );
}

function BugRoute({
  bugs,
  onStatusChange,
}: {
  bugs: ReturnType<typeof loadSubmittedBugs>;
  onStatusChange: (id: string, status: BugStatus) => void;
}) {
  const navigate = useNavigate();
  const { humanId } = useParams();
  const bug = bugs.find((b) => b.humanId.toLowerCase() === humanId?.toLowerCase());
  if (!bug) return <Navigate to="/bugs" replace />;
  return <BugDetail bug={bug} onBack={() => navigate("/bugs")} onStatusChange={onStatusChange} />;
}

function DraftRoute({
  drafts,
  onChange,
  onSubmit,
  onDiscard,
}: {
  drafts: Draft[];
  onChange: (d: Draft) => void;
  onSubmit: (d: Draft) => void;
  onDiscard: (id: string) => void;
}) {
  const navigate = useNavigate();
  const { id } = useParams();
  const draft = drafts.find((d) => d.id === id);
  if (!draft) return <Navigate to="/drafts" replace />;
  return (
    <DraftReview
      key={draft.id}
      draft={draft}
      onChange={onChange}
      onSubmit={onSubmit}
      onDiscard={onDiscard}
      onBack={() => navigate("/drafts")}
    />
  );
}

function App() {
  return (
    <BrowserRouter>
      <Shell />
    </BrowserRouter>
  );
}

export default App;
