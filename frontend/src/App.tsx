// ABOUTME: App shell + URL routing behind the auth gate — every screen has a shareable URL.
// ABOUTME: Drafts and filed bugs persist in IndexedDB; recordings live in the storage service.
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
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
import { USERS } from "@/lib/data";
import { ANONYMOUS, listAccountUsers, loadSession, signOut, type AuthUser } from "@/lib/auth";
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
import { onSync } from "@/lib/sync";
import { Sidebar, type SidebarView } from "@/components/shell/Sidebar";
import { AuthScreen } from "@/components/auth/AuthScreen";
import { BugsPage } from "@/components/bugs/BugsPage";
import { BugDetail } from "@/components/bugs/BugDetail";
import { DraftsPage } from "@/components/drafts/DraftsPage";
import { DraftReview } from "@/components/drafts/DraftReview";
import { InitiativesPage } from "@/components/initiatives/InitiativesPage";
import { InitiativeDetail } from "@/components/initiatives/InitiativeDetail";
import { InsightsPage } from "@/components/insights/InsightsPage";
import { listInitiatives, type Initiative } from "@/lib/initiatives";

const DemoCapture = lazy(() => import("@/components/drafts/DemoCapture").then((m) => ({ default: m.DemoCapture })));

const VIEW_TO_PATH: Record<SidebarView, string> = {
  all: "/bugs",
  open: "/bugs/open",
  in_progress: "/bugs/in-progress",
  resolved: "/bugs/resolved",
  mine: "/bugs/mine",
  drafts: "/drafts",
  initiatives: "/initiatives",
  insights: "/insights",
};
const PATH_TO_VIEW: Record<string, SidebarView> = {
  open: "open",
  "in-progress": "in_progress",
  resolved: "resolved",
  mine: "mine",
};

function Shell({
  user,
  onAuthed,
  onSignOut,
}: {
  user: AuthUser | null;
  onAuthed: (u: AuthUser) => void;
  onSignOut: () => void;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [bugs, setBugs] = useState<Bug[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  // Deep links to persisted bugs/drafts must wait for IndexedDB before deciding "not found".
  const [hydrated, setHydrated] = useState(false);
  const [initiatives, setInitiatives] = useState<Initiative[]>([]);

  const refreshInitiatives = async () => {
    const list = await listInitiatives().catch(() => [] as Initiative[]);
    setInitiatives(list);
  };
  useEffect(() => {
    void refreshInitiatives();
  }, []);

  // Everyone assignable: you, registered accounts, and the demo roster (deduped by email —
  // a registered account supersedes its roster stand-in).
  const people = useMemo<Reporter[]>(() => {
    const map = new Map<string, Reporter>();
    for (const p of [...(user ? [user] : []), ...listAccountUsers(), ...USERS]) {
      if (!map.has(p.email.toLowerCase())) map.set(p.email.toLowerCase(), p);
    }
    return [...map.values()];
  }, [user]);

  // Hydrate persisted state (IndexedDB) once on mount. Merge rather than replace — a draft
  // can arrive from the extension bridge before this resolves, and must not be dropped.
  useEffect(() => {
    void Promise.all([loadSubmittedBugs(), loadDrafts()]).then(([submitted, storedDrafts]) => {
      setBugs((prev) => [...prev, ...submitted.filter((b) => !prev.some((p) => p.id === b.id))]);
      setDrafts((prev) => [...prev, ...storedDrafts.filter((d) => !prev.some((p) => p.id === d.id))]);
      setHydrated(true);
    });
  }, []);

  // Mutations made in another dashboard tab (new draft delivered there, bug filed, draft
  // discarded) arrive over a BroadcastChannel so this tab never needs a manual refresh.
  useEffect(() => {
    return onSync((msg) => {
      if (msg.kind === "draft-put") {
        setDrafts((prev) =>
          prev.some((d) => d.id === msg.draft.id)
            ? prev.map((d) => (d.id === msg.draft.id ? msg.draft : d))
            : [msg.draft, ...prev],
        );
      } else if (msg.kind === "draft-remove") {
        setDrafts((prev) => prev.filter((d) => d.id !== msg.id));
      } else if (msg.kind === "bug-put") {
        setBugs((prev) =>
          prev.some((b) => b.id === msg.bug.id)
            ? prev.map((b) => (b.id === msg.bug.id ? msg.bug : b))
            : [msg.bug, ...prev],
        );
      }
    });
  }, []);

  // Captures arriving from the extension bridge become drafts (owned by you) and open for review.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== window || e.data?.source !== "bugfinder-extension" || e.data.type !== "draft") return;
      const incoming = draftFromExtension(e.data.draft as Record<string, unknown>, user ?? undefined);
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
  }, [navigate, user]);

  // Drafts are personal: you review your own recordings.
  const myDrafts = useMemo(
    () => drafts.filter((d) => !d.reporter || d.reporter.id === user?.id),
    [drafts, user?.id],
  );

  const seg = location.pathname.split("/").filter(Boolean);
  const activeView: SidebarView =
    seg[0] === "drafts"
      ? "drafts"
      : seg[0] === "initiatives"
        ? "initiatives"
        : seg[0] === "insights"
          ? "insights"
          : seg[0] === "bugs"
            ? (PATH_TO_VIEW[seg[1]] ?? "all")
            : "all";

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
                  actor: user?.name ?? "Anonymous",
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
    const bug = bugFromDraft(toFile, bugs, user ?? ANONYMOUS, people);
    persistSubmittedBug(bug);
    setBugs((prev) => [bug, ...prev]);
    // Navigate BEFORE dropping the draft — removing it first re-renders the draft route,
    // whose not-found redirect would win the race. Guests can't view bugs, so they land
    // back on Drafts with a filed confirmation instead.
    if (user) navigate(`/bug/${bug.humanId}`, { replace: true });
    else navigate(`/drafts?submitted=${bug.humanId}`, { replace: true });
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
        draftCount={myDrafts.length}
        initiativeCount={initiatives.filter((i) => i.status === "in_qa").length}
        user={user}
        onSignIn={() => navigate("/auth")}
        onSignOut={onSignOut}
      />
      <main className="flex min-w-0 flex-1 flex-col">
        <Routes>
          <Route path="/" element={<Navigate to={user ? "/bugs" : "/drafts"} replace />} />
          <Route
            path="/bugs/:view?"
            element={
              user ? <BugsRoute bugs={bugs} me={user} onStatusChange={changeStatus} /> : <Navigate to="/auth" replace />
            }
          />
          <Route
            path="/bug/:humanId"
            element={
              !user ? (
                <Navigate to="/auth" replace />
              ) : (
              <BugRoute
                hydrated={hydrated}
                bugs={bugs}
                me={user}
                people={people}
                onStatusChange={changeStatus}
                onSeverityChange={changeSeverity}
                onAssigneeChange={changeAssignee}
                onComment={addComment}
              />
              )
            }
          />
          <Route
            path="/drafts"
            element={<DraftsPage drafts={myDrafts} onOpen={(id) => navigate(`/drafts/${id}`)} onDiscard={discardDraft} />}
          />
          <Route
            path="/drafts/:id"
            element={
              <DraftRoute
                hydrated={hydrated}
                drafts={myDrafts}
                user={user}
                people={people}
                onChange={updateDraft}
                onSubmit={submitDraft}
                onDiscard={discardDraft}
              />
            }
          />
          <Route
            path="/initiatives"
            element={
              user ? (
                <InitiativesPage bugs={bugs} user={user} initiatives={initiatives} onRefresh={refreshInitiatives} />
              ) : (
                <Navigate to="/auth" replace />
              )
            }
          />
          <Route
            path="/initiatives/:id"
            element={
              user ? (
                <InitiativeRoute
                  initiatives={initiatives}
                  bugs={bugs}
                  user={user}
                  people={people}
                  onRefresh={refreshInitiatives}
                />
              ) : (
                <Navigate to="/auth" replace />
              )
            }
          />
          <Route
            path="/insights"
            element={user ? <InsightsPage bugs={bugs} initiatives={initiatives} /> : <Navigate to="/auth" replace />}
          />
          <Route
            path="/auth"
            element={
              user ? (
                <Navigate to="/bugs" replace />
              ) : (
                <AuthGate onAuthed={onAuthed} />
              )
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

function InitiativeRoute({
  initiatives,
  bugs,
  user,
  people,
  onRefresh,
}: {
  initiatives: Initiative[];
  bugs: Bug[];
  user: AuthUser;
  people: Reporter[];
  onRefresh: () => Promise<void>;
}) {
  const { id } = useParams();
  const initiative = initiatives.find((i) => i.id === id);
  if (!initiative) {
    // Still loading the list, or a bad link — the list page sorts it out either way.
    return initiatives.length === 0 ? null : <Navigate to="/initiatives" replace />;
  }
  return <InitiativeDetail initiative={initiative} bugs={bugs} user={user} people={people} onRefresh={onRefresh} />;
}

function BugsRoute({
  bugs,
  me,
  onStatusChange,
}: {
  bugs: Bug[];
  me: Reporter | null;
  onStatusChange: (id: string, status: BugStatus) => void;
}) {
  const navigate = useNavigate();
  const { view } = useParams();
  const sidebarView: SidebarView = PATH_TO_VIEW[view ?? ""] ?? "all";
  if (view && !PATH_TO_VIEW[view]) return <Navigate to="/bugs" replace />;
  return (
    <BugsPage
      bugs={bugs}
      me={me}
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
  me,
  people,
  onStatusChange,
  onSeverityChange,
  onAssigneeChange,
  onComment,
}: {
  hydrated: boolean;
  bugs: Bug[];
  me: Reporter | null;
  people: Reporter[];
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
      me={me}
      people={people}
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
  user,
  people,
  onChange,
  onSubmit,
  onDiscard,
}: {
  hydrated: boolean;
  drafts: Draft[];
  user: AuthUser | null;
  people: Reporter[];
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
      user={user}
      people={people}
      onChange={onChange}
      onSubmit={onSubmit}
      onDiscard={onDiscard}
      onBack={() => navigate("/drafts")}
    />
  );
}

/** The /auth route — sign in / sign up, then return to where you came from. */
function AuthGate({ onAuthed }: { onAuthed: (u: AuthUser) => void }) {
  const navigate = useNavigate();
  return (
    <AuthScreen
      onAuthed={(u) => {
        onAuthed(u);
        navigate("/bugs", { replace: true });
      }}
      onSkip={() => navigate("/drafts", { replace: true })}
    />
  );
}

function App() {
  const [user, setUser] = useState<AuthUser | null>(loadSession);
  return (
    <BrowserRouter>
      <Shell
        user={user}
        onAuthed={setUser}
        onSignOut={() => {
          signOut();
          setUser(null);
        }}
      />
    </BrowserRouter>
  );
}

export default App;
