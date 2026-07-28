// ABOUTME: App shell + URL routing — every screen has a shareable URL. Drafts and filed bugs
// ABOUTME: persist in IndexedDB; recordings live in the storage service.
import { useEffect, useRef, useState } from "react";
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import type { Bug, BugSeverity, BugStatus, Draft, Reporter } from "@/lib/types";
import { ME } from "@/lib/data";
import {
  bugFromDraft,
  draftFromExtension,
  loadDrafts,
  loadSubmittedBugs,
  persistDraft,
  persistSubmittedBug,
  removeDraft,
} from "@/lib/drafts";
import { uploadJson } from "@/lib/storage-api";
import { Sidebar, type SidebarView } from "@/components/shell/Sidebar";
import { BugsPage } from "@/components/bugs/BugsPage";
import { BugDetail } from "@/components/bugs/BugDetail";
import { lazy, Suspense } from "react";
import { DraftsPage } from "@/components/drafts/DraftsPage";
import { DraftReview } from "@/components/drafts/DraftReview";

const DemoCapture = lazy(() => import("@/components/drafts/DemoCapture").then((m) => ({ default: m.DemoCapture })));

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
  const [bugs, setBugs] = useState<Bug[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  // Deep links to persisted bugs/drafts must wait for IndexedDB before deciding "not found".
  const [hydrated, setHydrated] = useState(false);

  // Hydrate persisted state (IndexedDB) once on mount.
  useEffect(() => {
    void Promise.all([loadSubmittedBugs(), loadDrafts()]).then(([submitted, storedDrafts]) => {
      setBugs(submitted);
      setDrafts(storedDrafts);
      setHydrated(true);
    });
  }, []);

  // Captures arriving from the extension bridge become drafts and open for review.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== window || e.data?.source !== "bugfinder-extension" || e.data.type !== "draft") return;
      const incoming = draftFromExtension(e.data.draft as Record<string, unknown>);
      window.postMessage({ source: "bugfinder-dashboard", type: "draft-received" }, "*");
      setDrafts((prev) => {
        if (prev.some((d) => d.id === incoming.id)) return prev;
        persistDraft(incoming);
        return [incoming, ...prev];
      });
      navigate(`/drafts/${incoming.id}`);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [navigate]);

  const seg = location.pathname.split("/").filter(Boolean);
  const activeView: SidebarView =
    seg[0] === "drafts" ? "drafts" : seg[0] === "bugs" ? (PATH_TO_VIEW[seg[1]] ?? "all") : "all";

  /** Mutate one bug, appending a history event, and persist it. */
  const amendBug = (id: string, patch: Partial<Bug>, historyDetail: string | null) => {
    setBugs((prev) =>
      prev.map((b) => {
        if (b.id !== id) return b;
        const next: Bug = {
          ...b,
          ...patch,
          updatedAt: Date.now(),
          events: historyDetail
            ? [
                ...b.events,
                {
                  id: `e-${Date.now().toString(36)}`,
                  actor: ME.name,
                  kind: patch.status ? "status" : patch.assignee !== undefined ? "assigned" : "comment",
                  detail: historyDetail,
                  at: Date.now(),
                },
              ]
            : b.events,
        };
        persistSubmittedBug(next);
        return next;
      }),
    );
  };

  const changeStatus = (id: string, status: BugStatus) =>
    amendBug(id, { status }, `changed status to ${status.replace("_", " ")}`);
  const changeSeverity = (id: string, severity: BugSeverity) =>
    amendBug(id, { severity }, `set severity to ${severity}`);
  const changeAssignee = (id: string, assignee: Reporter | null) =>
    amendBug(id, { assignee }, assignee ? `assigned to ${assignee.name}` : "unassigned");
  const addComment = (id: string, body: string) => amendBug(id, {}, body);

  const updateDraft = (draft: Draft) => {
    persistDraft(draft);
    setDrafts((prev) => prev.map((d) => (d.id === draft.id ? draft : d)));
  };

  const discardDraft = (id: string) => {
    removeDraft(id);
    setDrafts((prev) => prev.filter((d) => d.id !== id));
    navigate("/drafts");
  };

  const submitDraft = async (draft: Draft) => {
    // Recordings live in the storage service; the bug row keeps only the file id. If the
    // upload fails (offline, service down) the events stay inline — nothing is lost.
    let toFile = draft;
    if (draft.rrweb && !draft.rrwebFileId) {
      try {
        const fileId = await uploadJson(`${draft.id}-rrweb.json`, draft.rrweb);
        toFile = { ...draft, rrwebFileId: fileId, rrweb: undefined };
      } catch {
        /* keep inline */
      }
    }
    const bug = bugFromDraft(toFile, bugs);
    persistSubmittedBug(bug);
    setBugs((prev) => [bug, ...prev]);
    // Navigate BEFORE dropping the draft — removing it first re-renders the draft route,
    // whose not-found redirect would win the race and land on /drafts instead of the bug.
    navigate(`/bug/${bug.humanId}`, { replace: true });
    removeDraft(draft.id);
    setDrafts((prev) => prev.filter((d) => d.id !== draft.id));
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
          <Route path="/bugs/:view?" element={<BugsRoute bugs={bugs} onStatusChange={changeStatus} />} />
          <Route
            path="/bug/:humanId"
            element={
              <BugRoute
                hydrated={hydrated}
                bugs={bugs}
                onStatusChange={changeStatus}
                onSeverityChange={changeSeverity}
                onAssigneeChange={changeAssignee}
                onComment={addComment}
              />
            }
          />
          <Route
            path="/drafts"
            element={<DraftsPage drafts={drafts} onOpen={(id) => navigate(`/drafts/${id}`)} onDiscard={discardDraft} />}
          />
          <Route
            path="/drafts/:id"
            element={
              <DraftRoute
                hydrated={hydrated}
                drafts={drafts}
                onChange={updateDraft}
                onSubmit={submitDraft}
                onDiscard={discardDraft}
              />
            }
          />
          <Route
            path="/demo-capture"
            element={
              <Suspense fallback={null}>
                <DemoCapture />
              </Suspense>
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
  bugs: Bug[];
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
  hydrated,
  bugs,
  onStatusChange,
  onSeverityChange,
  onAssigneeChange,
  onComment,
}: {
  hydrated: boolean;
  bugs: Bug[];
  onStatusChange: (id: string, status: BugStatus) => void;
  onSeverityChange: (id: string, severity: BugSeverity) => void;
  onAssigneeChange: (id: string, assignee: Reporter | null) => void;
  onComment: (id: string, body: string) => void;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const { humanId } = useParams();
  const bug = bugs.find((b) => b.humanId.toLowerCase() === humanId?.toLowerCase());
  if (!bug && !hydrated) return null;
  if (!bug) return <Navigate to="/bugs" replace />;
  const back = () => (location.key !== "default" ? navigate(-1) : navigate("/bugs"));
  const host = (u: string) => {
    try {
      return new URL(u).host;
    } catch {
      return u;
    }
  };
  const related = bugs
    .filter(
      (b) =>
        b.id !== bug.id &&
        (b.tags.some((t) => bug.tags.includes(t)) || host(b.pageUrl) === host(bug.pageUrl)),
    )
    .slice(0, 4);
  return (
    <BugDetail
      bug={bug}
      relatedBugs={related}
      onBack={back}
      onStatusChange={onStatusChange}
      onSeverityChange={onSeverityChange}
      onAssigneeChange={onAssigneeChange}
      onComment={onComment}
    />
  );
}

function DraftRoute({
  hydrated,
  drafts,
  onChange,
  onSubmit,
  onDiscard,
}: {
  hydrated: boolean;
  drafts: Draft[];
  onChange: (d: Draft) => void;
  onSubmit: (d: Draft) => void;
  onDiscard: (id: string) => void;
}) {
  const navigate = useNavigate();
  const { id } = useParams();
  const draft = drafts.find((d) => d.id === id);
  // Distinguish "never existed" (redirect) from "just submitted/discarded" (a navigation to
  // the filed bug is already in flight as a transition — redirecting here would beat it).
  const hadDraft = useRef(false);
  if (draft) hadDraft.current = true;
  if (!draft && !hydrated) return null;
  if (!draft) return hadDraft.current ? null : <Navigate to="/drafts" replace />;
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
