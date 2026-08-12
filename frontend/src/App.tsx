// ABOUTME: App shell + URL routing behind the auth gate — every screen has a shareable URL.
// ABOUTME: Drafts and filed bugs persist in IndexedDB; recordings live in the storage service.
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CloudOff, RefreshCw, X } from "lucide-react";
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import type { Bug, BugSeverity, BugStatus, Draft, Reporter } from "@/lib/types";
import { ANONYMOUS, isAdmin, listAccountUsers, loadSession, signOut, verifySession, type AuthUser } from "@/lib/auth";
import {
  bugFromDraft,
  dedupeByHumanId,
  draftFromExtension,
  loadDrafts,
  loadSubmittedBugs,
  persistDraft,
  persistDraftDurable,
  persistSubmittedBug,
  publishStoredBug,
  removeBug,
  removeDraft,
  storeBugLocal,
  type SyncResult,
} from "@/lib/drafts";
import { uploadJson } from "@/lib/storage-api";
import { allocateHumanId, fetchBug, listBugs, patchBug, postComment } from "@/lib/bugs-api";
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
import { AdminPage } from "@/components/admin/AdminPage";
import { ConnectPage } from "@/components/connect/ConnectPage";
import { ProfilePage } from "@/components/profile/ProfilePage";
import { listInitiatives, type Initiative } from "@/lib/initiatives";

/** A list row from the server is deliberately light: the capture arrays are projected out, and
 *  any field never written is simply absent. The UI types it as a Bug and reads `.tags`, `.events`
 *  and `.console` straight off it, so give every one of them a floor before it reaches React —
 *  otherwise a session filed by a teammate takes the whole list down with it. */
function fromServer(row: Bug): Bug {
  return {
    ...row,
    tags: row.tags ?? [],
    events: row.events ?? [],
    console: row.console ?? [],
    network: row.network ?? [],
    replay: row.replay ?? [],
    markers: row.markers ?? [],
    shots: row.shots ?? [],
    pickedElements: row.pickedElements ?? [],
    visits: row.visits ?? [],
  };
}

/** What the server owns once a session is filed — the collaborative surface. Everything else on
 *  a bug is capture evidence, which no one edits and which the shared list does not carry. */
const SHARED_FIELDS = [
  "title", "description", "status", "severity", "assignee", "tags",
  "initiative", "initiativeId", "category", "env", "jobId", "events", "updatedAt",
] as const satisfies readonly (keyof Bug)[];
const SERVER_EDITABLE = new Set<string>(SHARED_FIELDS.filter((f) => f !== "events" && f !== "updatedAt"));

const DemoCapture = lazy(() => import("@/components/drafts/DemoCapture").then((m) => ({ default: m.DemoCapture })));

const VIEW_TO_PATH: Record<SidebarView, string> = {
  all: "/sessions",
  open: "/sessions/open",
  in_progress: "/sessions/in-progress",
  resolved: "/sessions/resolved",
  mine: "/sessions/mine",
  drafts: "/drafts",
  initiatives: "/initiatives",
  insights: "/insights",
  connect: "/connect",
  profile: "/profile",
  admin: "/admin",
  reported: "/sessions/reported",
};
const PATH_TO_VIEW: Record<string, SidebarView> = {
  reported: "reported",
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
  /** Current rows for handlers that outlive a render (retry from the sync toast). */
  const bugsRef = useRef<Bug[]>([]);
  bugsRef.current = bugs;
  const [drafts, setDrafts] = useState<Draft[]>([]);
  // Deep links to persisted bugs/drafts must wait for IndexedDB before deciding "not found".
  const [hydrated, setHydrated] = useState(false);
  const [initiatives, setInitiatives] = useState<Initiative[]>([]);

  const refreshInitiatives = async () => {
    const list = await listInitiatives().catch(() => [] as Initiative[]);
    setInitiatives(list);
    announceInitiatives(list);
  };

  /** Push the live initiatives at the extension bridge. Kept separate from the fetch so a
   *  bridge that loaded after us can ask for them again without a round trip to the server. */
  const initiativesRef = useRef<Initiative[]>([]);
  const announceInitiatives = (list: Initiative[]) => {
    initiativesRef.current = list;
    // Mirror the live ones to the extension bridge. The extension deliberately never calls our
    // REST API, so anything it needs to offer at capture time has to be pushed to it.
    window.postMessage(
      {
        source: "bugfinder-dashboard",
        type: "initiatives-sync",
        initiatives: list
          .filter((i) => i.status === "in_qa")
          .map((i) => ({ id: i.id, name: i.name, tags: i.tags ?? [] })),
      },
      "*",
    );
  };
  useEffect(() => {
    void refreshInitiatives();
  }, []);

  // Accounts live on the server now, so the roster is fetched rather than read synchronously.
  const [accounts, setAccounts] = useState<AuthUser[]>([]);
  useEffect(() => {
    void listAccountUsers().then(setAccounts);
  }, [user]);

  // Everyone assignable: you and every real account, deduped by email. A hardcoded roster used
  // to be merged in here (Maya Chen, Dev Patel, Sara Kim) — names that read like teammates and
  // could be assigned work, but belonged to nobody and could never open the session.
  const people = useMemo<Reporter[]>(() => {
    const map = new Map<string, Reporter>();
    for (const p of [...(user ? [user] : []), ...accounts]) {
      if (!map.has(p.email.toLowerCase())) map.set(p.email.toLowerCase(), p);
    }
    return [...map.values()];
  }, [user, accounts]);

  // Hydrate persisted state (IndexedDB) once on mount. Merge rather than replace — a draft
  // can arrive from the extension bridge before this resolves, and must not be dropped.
  // Bugs collapse by humanId (newest wins): a double-submit leaves two rows with one humanId.
  useEffect(() => {
    void Promise.all([loadSubmittedBugs(), loadDrafts()]).then(([submitted, storedDrafts]) => {
      setBugs((prev) => dedupeByHumanId([...prev, ...submitted.filter((b) => !prev.some((p) => p.id === b.id))]));
      setDrafts((prev) => [...prev, ...storedDrafts.filter((d) => !prev.some((p) => p.id === d.id))]);
      setHydrated(true);
    });
  }, []);

  // The team's sessions, not just this browser's. The server row wins for everything people
  // change together; the local row keeps the evidence, which the list deliberately omits.
  useEffect(() => {
    void listBugs().then((remote) => {
      if (!remote.length) return;
      setBugs((prev) => {
        const byHuman = new Map(prev.map((b) => [b.humanId, b] as const));
        for (const r of remote) {
          const local = byHuman.get(r.humanId);
          if (!local) {
            byHuman.set(r.humanId, fromServer(r));
            continue;
          }
          const shared: Partial<Bug> = {};
          for (const k of SHARED_FIELDS) {
            if (r[k] !== undefined) (shared as Record<string, unknown>)[k] = r[k];
          }
          byHuman.set(r.humanId, { ...local, ...shared });
        }
        return [...byHuman.values()].sort((a, b) => b.createdAt - a.createdAt);
      });
    });
  }, [user]);

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
        setBugs((prev) => {
          if (prev.some((b) => b.id === msg.bug.id)) {
            return prev.map((b) => (b.id === msg.bug.id ? msg.bug : b));
          }
          // Same capture filed from another tab: allocate is idempotent by draftId, so both
          // filings carry one humanId but different local ids. Keep the newest row rather
          // than showing two, one of them unopenable.
          const twin = prev.find((b) => b.humanId === msg.bug.humanId);
          if (twin) {
            return msg.bug.createdAt >= twin.createdAt
              ? prev.map((b) => (b.humanId === msg.bug.humanId ? msg.bug : b))
              : prev;
          }
          return [msg.bug, ...prev];
        });
      } else if (msg.kind === "bug-remove") {
        setBugs((prev) => prev.filter((b) => b.id !== msg.id));
      }
    });
  }, []);

  // Publish outcomes for THIS tab. The BroadcastChannel never delivers to its own sender, so
  // the filing tab learns success/failure from the returned promise — these route the result
  // into state (the row's "Not synced" indicator) and a dismissable banner with a retry.
  const [syncAlert, setSyncAlert] = useState<{ humanId: string; message: string } | null>(null);

  const applySyncResult = useCallback((res: SyncResult) => {
    setBugs((prev) =>
      prev.map((b) => (b.id === res.bug.id ? { ...b, syncState: res.bug.syncState, syncError: res.bug.syncError } : b)),
    );
    if (!res.ok) {
      setSyncAlert({
        humanId: res.bug.humanId,
        message: res.error ?? "The bug could not reach the server.",
      });
    }
  }, []);

  /** Persist + publish a bug row, then surface the outcome in this tab. */
  const syncBug = useCallback(
    (bug: Bug) => {
      void persistSubmittedBug(bug).then(applySyncResult);
    },
    [applySyncResult],
  );

  /** Re-run the server publish for a bug that never made it — wired to every Retry control. */
  const retrySync = useCallback(
    async (bugId: string) => {
      const bug = bugsRef.current.find((b) => b.id === bugId);
      if (!bug) return;
      setSyncAlert(null);
      applySyncResult(await publishStoredBug(bug));
    },
    [applySyncResult],
  );

  /** Replace a light list row with the full server row once its evidence has been fetched, and
   *  keep the local copy so the next open is instant and works offline. */
  const hydrateBug = useCallback((full: Bug) => {
    setBugs((prev) => prev.map((b) => (b.humanId === full.humanId ? { ...b, ...full } : b)));
    void storeBugLocal(full);
  }, []);

  /** Points at submitDraft, which is defined further down — see the note there. */
  const submitRef = useRef<((draft: Draft) => Promise<Bug>) | null>(null);
  /** Draft ids already taken from the bridge. Filing is asynchronous and the bridge resends
   *  until acknowledged, so without this the same capture is filed twice. */
  const handledDrafts = useRef<Set<string>>(new Set());

  // Captures arriving from the extension bridge become drafts (owned by you) and open for review.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== window || e.data?.source !== "bugfinder-extension") return;

      // A bridge that just loaded is asking what we have; it may have missed the announcement.
      if (e.data.type === "request-sync") {
        announceInitiatives(initiativesRef.current);
        return;
      }

      // A recording that finished uploading after its report was already filed. The extension
      // never waits on the upload, so the pixel replay is attached here, after the fact.
      if (e.data.type === "draft-patch") {
        const patch = e.data.patch as {
          id: string;
          rrwebFileId?: string;
          rrweb?: unknown[];
          videoFileId?: string;
          // The HAR is the largest artefact a capture produces, so its upload almost always
          // finishes after the report is filed — it arrives here or not at all.
          harFileId?: string;
          shots?: { id: string; t: number; fileId?: string; savedAs?: string }[];
        };
        window.postMessage({ source: "bugfinder-dashboard", type: "draft-patch-received", id: patch.id }, "*");
        const attach = <
          T extends {
            rrweb?: unknown[];
            rrwebFileId?: string;
            videoFileId?: string;
            harFileId?: string;
            shots?: { id: string; t: number; fileId?: string; savedAs?: string }[];
          },
        >(
          row: T,
        ): T => ({
          ...row,
          rrwebFileId: patch.rrwebFileId ?? row.rrwebFileId,
          rrweb: patch.rrweb ?? row.rrweb,
          videoFileId: patch.videoFileId ?? row.videoFileId,
          harFileId: patch.harFileId ?? row.harFileId,
          // Shots arrive one at a time as each upload lands — merge by id, never replace.
          shots: patch.shots
            ? [
                ...(row.shots ?? []).filter((s) => !patch.shots!.some((p) => p.id === s.id)),
                ...patch.shots,
              ].sort((a, b) => a.t - b.t)
            : row.shots,
        });
        setDrafts((prev) =>
          prev.map((d) => {
            if (d.id !== patch.id) return d;
            const next = attach(d);
            persistDraft(next);
            return next;
          }),
        );
        setBugs((prev) =>
          prev.map((b) => {
            if (b.draftId !== patch.id) return b;
            const next = attach(b);
            syncBug(next);
            return next;
          }),
        );
        return;
      }

      if (e.data.type !== "draft") return;
      const payload = e.data.draft as Record<string, unknown>;
      const incoming = draftFromExtension(payload, user ?? undefined);
      const ackReceived = () =>
        window.postMessage({ source: "bugfinder-dashboard", type: "draft-received", id: incoming.id }, "*");

      // A draft already taken is durably stored (or filed), so re-acknowledge immediately: the
      // ack is what stops the bridge resending every 500ms, and filing is asynchronous —
      // without this guard the same capture is filed twice (how one recording became BF-110
      // and BF-111).
      if (handledDrafts.current.has(incoming.id)) {
        ackReceived();
        return;
      }
      handledDrafts.current.add(incoming.id);

      void (async () => {
        try {
          // Durable BEFORE the ack. The bridge drops its queue entry on `draft-received`, so
          // until this write lands the extension holds the only copy of the capture — acking
          // first left a window where one failure lost it from both places.
          await persistDraftDurable(incoming);
        } catch {
          // Not stored — do not ack; the next redelivery retries.
          handledDrafts.current.delete(incoming.id);
          return;
        }
        ackReceived();
        // The side panel already collected the report, so file it on arrival. The filed signal
        // is posted inside submitDraft (gated on the publish outcome), so reviewing in the
        // dashboard and auto-filing both tell the extension the truth.
        if (payload.autoSubmit) {
          try {
            await submitRef.current?.(incoming);
          } catch {
            // Filing failed after the draft was durably stored — surface it for manual review
            // rather than looping; nothing is lost.
            setDrafts((prev) => (prev.some((d) => d.id === incoming.id) ? prev : [incoming, ...prev]));
          }
          return;
        }
        setDrafts((prev) => (prev.some((d) => d.id === incoming.id) ? prev : [incoming, ...prev]));
        navigate(`/drafts/${incoming.id}`);
      })();
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
    seg[0] === "bugs"
      ? (PATH_TO_VIEW[seg[1]] ?? "all")
      : ((["drafts", "initiatives", "insights", "connect", "profile", "admin"] as const).find((v) => v === seg[0]) ?? "all");

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
        // Local first, so the UI never waits on the network. Then the change alone travels to
        // the server: republishing the entire snapshot per edit is what made two people editing
        // one session overwrite each other.
        void storeBugLocal(next);
        const shared = Object.fromEntries(
          Object.entries(patch)
            .filter(([k]) => SERVER_EDITABLE.has(k))
            // undefined disappears in JSON, which would leave the old value standing. Clearing a
            // field — unassigned, no initiative — has to travel as an explicit null.
            .map(([k, v]) => [k, v === undefined ? null : v]),
        );
        if (Object.keys(shared).length) void patchBug(next.humanId, shared);
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
  const addComment = (id: string, body: string) => {
    amendBug(id, {}, body);
    // The thread is shared. A comment that reaches only this browser's history is invisible to the
    // developer it was written for, which was the entire point of writing it.
    const bug = bugsRef.current.find((b) => b.id === id);
    if (bug) void postComment(bug.humanId, body);
  };

  /** Move a session to an initiative. Id and name travel together — the id is what grouping keys
   *  off, the name is what every list and agent summary renders — and the category follows, since a
   *  session on an initiative is QA work and one without it is a production report. */
  const changeInitiative = (id: string, initiative: Initiative | null) =>
    amendBug(
      id,
      {
        initiativeId: initiative?.id,
        initiative: initiative?.name,
        category: initiative ? "initiative" : "production",
      },
      initiative ? `moved to ${initiative.name}` : "removed from its initiative",
    );

  const changeTags = (id: string, tags: string[]) =>
    amendBug(id, { tags }, `tags → ${tags.join(", ") || "none"}`);

  const updateDraft = (draft: Draft) => {
    persistDraft(draft);
    setDrafts((prev) => prev.map((d) => (d.id === draft.id ? draft : d)));
  };

  const discardDraft = (id: string) => {
    removeDraft(id);
    setDrafts((prev) => prev.filter((d) => d.id !== id));
    navigate("/drafts");
  };

  /** Admin-only bulk delete. Removes each bug from IndexedDB (what the UI reads) and from the
   *  backend snapshot (what agents read); other tabs follow via the sync channel. */
  const deleteBugs = (ids: string[]) => {
    const doomed = bugs.filter((b) => ids.includes(b.id));
    if (!doomed.length) return;
    for (const bug of doomed) removeBug(bug);
    setBugs((prev) => prev.filter((b) => !ids.includes(b.id)));
  };

  /** Free-text edits to a filed bug. Any signed-in user may make them — a bug report is a
   *  shared document, and gatekeeping it just means wrong titles stay wrong. Each changed
   *  field becomes its own history entry holding the old and new value, so "who edited what"
   *  is answerable after the fact rather than implied. */
  const editBug = (id: string, patch: Partial<Bug>) => {
    setBugs((prev) =>
      prev.map((b) => {
        if (b.id !== id) return b;
        const at = Date.now();
        const actor = user?.name ?? "Anonymous";
        const events = [...b.events];
        const record = (field: string, from: string, to: string) => {
          if (from.trim() === to.trim()) return; // a no-op edit is not history
          events.push({
            id: `e-${at.toString(36)}-${field}`,
            actor,
            kind: "edited",
            detail: `edited the ${field}`,
            at,
            field,
            from,
            to,
          });
        };
        if (patch.title !== undefined) record("title", b.title, patch.title);
        if (patch.description !== undefined) record("description", b.description, patch.description);
        if (patch.tags !== undefined) record("tags", b.tags.join(", "), patch.tags.join(", "));
        if (events.length === b.events.length) return b;
        const next: Bug = { ...b, ...patch, updatedAt: at, events };
        syncBug(next);
        return next;
      }),
    );
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
    // The server issues the number. Idempotent by draftId, so a re-delivered filing reuses the
    // id it already has instead of creating a second bug for one recording.
    const allocated = await allocateHumanId(draft.id);
    const bug = bugFromDraft(toFile, bugs, user ?? ANONYMOUS, people, allocated);
    // The local write is the capture's only home until the server has a copy, so it must be
    // durable before the draft is dropped. Rejects if IndexedDB refused — the draft survives
    // and the submit button unsticks.
    await storeBugLocal(bug);
    // Dedup by humanId, not just local id: a double-submit re-runs allocate (idempotent — same
    // humanId) but mints a fresh local id, which is how one recording became two list rows.
    setBugs((prev) => [bug, ...prev.filter((b) => b.id !== bug.id && b.humanId !== bug.humanId)]);
    // Navigate BEFORE dropping the draft — removing it first re-renders the draft route,
    // whose not-found redirect would win the race. Guests can't view bugs, so they land
    // back on Drafts with a filed confirmation instead.
    if (user) navigate(`/session/${bug.humanId}`, { replace: true });
    else navigate(`/drafts?submitted=${bug.humanId}`, { replace: true });
    removeDraft(draft.id);
    setDrafts((prev) => prev.filter((d) => d.id !== draft.id));
    // Publish the server snapshot. `draft-filed` is gated on the outcome: a failed publish
    // must not tell the extension the bug was filed — the panel would report a hand-off that
    // silently never completed, which is exactly how BF-102..106 went missing.
    void publishStoredBug(bug).then((res) => {
      applySyncResult(res);
      if (res.ok) {
        window.postMessage(
          { source: "bugfinder-dashboard", type: "draft-filed", id: draft.id, humanId: bug.humanId },
          "*",
        );
      }
    });
    return bug;
  };
  // The extension bridge files auto-submitted captures through this, and the effect above is
  // declared first — a ref keeps it pointed at the current closure instead of a stale one.
  submitRef.current = submitDraft;

  return (
    <div className="flex h-full">
      {/* Publish-failure toast for THIS tab — the one that filed. Stays until dismissed. */}
      {syncAlert && (
        <div className="fixed inset-x-0 top-3 z-50 flex justify-center px-4">
          <div
            role="alert"
            data-testid="sync-alert"
            className="flex w-full max-w-xl items-start gap-3 rounded-xl border border-red-300 bg-red-50 px-4 py-3 shadow-lg dark:border-red-500/40 dark:bg-red-950"
          >
            <CloudOff className="mt-0.5 size-4 shrink-0 text-red-600 dark:text-red-400" />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-bold text-red-800 dark:text-red-300">
                {syncAlert.humanId} didn't reach the server
              </p>
              <p className="mt-0.5 text-[12px] leading-relaxed text-red-700/90 dark:text-red-400/90">
                {syncAlert.message} It is saved on this device and marked “Not synced” in the list.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                const b = bugsRef.current.find((x) => x.humanId === syncAlert.humanId);
                if (b) void retrySync(b.id);
                else setSyncAlert(null);
              }}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-[12px] font-bold text-white transition hover:bg-red-700"
            >
              <RefreshCw className="size-3.5" /> Retry
            </button>
            <button
              type="button"
              onClick={() => setSyncAlert(null)}
              aria-label="Dismiss"
              className="grid size-6 shrink-0 place-items-center rounded-md text-red-700/70 transition hover:bg-red-100 hover:text-red-800 dark:text-red-400/70 dark:hover:bg-red-500/10"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>
      )}
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
          <Route path="/" element={<Navigate to={user ? "/sessions" : "/drafts"} replace />} />
          {/* The paths used to be /bugs and /bug/:id. Links have already been shared, and a
              shared link that 404s is worse than a redirect that lives forever. */}
          <Route path="/bugs/:view?" element={<LegacyRedirect to="/sessions" />} />
          <Route path="/bug/:humanId" element={<LegacyRedirect to="/session" />} />
          <Route
            path="/sessions/:view?"
            element={
              user ? (
                <BugsRoute
                  bugs={bugs}
                  me={user}
                  onStatusChange={changeStatus}
                  canDelete={isAdmin(user)}
                  onDelete={deleteBugs}
                  onRetrySync={retrySync}
                />
              ) : (
                <Navigate to="/auth" replace />
              )
            }
          />
          <Route
            path="/session/:humanId"
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
                initiatives={initiatives}
                onInitiativeChange={changeInitiative}
                onTagsChange={changeTags}
                onEdit={editBug}
                onHydrateBug={hydrateBug}
                onRetrySync={retrySync}
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
          <Route path="/connect" element={<ConnectPage user={user} />} />
          <Route path="/profile" element={<ProfilePage user={user} onUpdated={onAuthed} />} />
          <Route path="/admin" element={user ? <AdminPage user={user} /> : <Navigate to="/auth" replace />} />
          <Route
            path="/auth"
            element={
              user ? (
                <Navigate to="/sessions" replace />
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
          <Route path="*" element={<Navigate to="/sessions" replace />} />
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

/** Carries an old /bugs or /bug/:id URL to its /sessions equivalent, query string intact so a
 *  shared `?t=4.6` deep link still lands on the right moment. */
function LegacyRedirect({ to }: { to: string }) {
  const { view, humanId } = useParams();
  const location = useLocation();
  const tail = humanId ?? view ?? "";
  return <Navigate to={`${to}${tail ? `/${tail}` : ""}${location.search}`} replace />;
}

function BugsRoute({
  bugs,
  me,
  onStatusChange,
  canDelete,
  onDelete,
  onRetrySync,
}: {
  bugs: Bug[];
  me: Reporter | null;
  onStatusChange: (id: string, status: BugStatus) => void;
  canDelete: boolean;
  onDelete: (ids: string[]) => void;
  onRetrySync: (id: string) => Promise<void>;
}) {
  const navigate = useNavigate();
  const { view } = useParams();
  const sidebarView: SidebarView = PATH_TO_VIEW[view ?? ""] ?? "all";
  if (view && !PATH_TO_VIEW[view]) return <Navigate to="/sessions" replace />;
  return (
    <BugsPage
      bugs={bugs}
      me={me}
      view={sidebarView}
      onOpenBug={(id) => {
        const bug = bugs.find((b) => b.id === id);
        if (bug) navigate(`/session/${bug.humanId}`);
      }}
      onStatusChange={onStatusChange}
      canDelete={canDelete}
      onDelete={onDelete}
      onRetrySync={onRetrySync}
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
  initiatives,
  onInitiativeChange,
  onTagsChange,
  onEdit,
  onHydrateBug,
  onRetrySync,
}: {
  hydrated: boolean;
  bugs: Bug[];
  me: Reporter | null;
  people: Reporter[];
  onStatusChange: (id: string, status: BugStatus) => void;
  onSeverityChange: (id: string, severity: BugSeverity) => void;
  onAssigneeChange: (id: string, assignee: Reporter | null) => void;
  onComment: (id: string, body: string) => void;
  initiatives: Initiative[];
  onInitiativeChange: (id: string, initiative: Initiative | null) => void;
  onTagsChange: (id: string, tags: string[]) => void;
  onEdit: (id: string, patch: Partial<Bug>) => void;
  onHydrateBug: (full: Bug) => void;
  onRetrySync: (id: string) => Promise<void>;
}) {
  const navigate = useNavigate();
  const { humanId } = useParams();
  const [search] = useSearchParams();
  // Resolve by humanId, newest first — if duplicate rows ever coexist (a double-submit from
  // before the dedup landed), the shared link opens the surviving row instead of a dead one.
  const matches = bugs.filter((b) => b.humanId.toLowerCase() === humanId?.toLowerCase());
  const bug = matches.length > 1 ? matches.reduce((a, b) => (b.createdAt > a.createdAt ? b : a)) : matches[0];
  // A session filed on someone else's machine reaches this browser through the shared list, which
  // carries no recording, network or console. Pull the full row the first time it is opened.
  //
  // Test the LENGTH, not the value. The list normaliser gives every capture array a `?? []` floor
  // so the list cannot crash on a light row — and an empty array is truthy, so `if (bug.network)`
  // read "evidence already loaded" for exactly the rows that had none. Every session this browser
  // had not filed itself opened with blank Network and Console panels, permanently, while the
  // server held the lot.
  const fetched = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!bug || fetched.current.has(bug.humanId)) return;
    const hasEvidence =
      (bug.network?.length ?? 0) > 0 || (bug.console?.length ?? 0) > 0 || (bug.rrweb?.length ?? 0) > 0;
    if (hasEvidence) return;
    // Remember the attempt, not just the success: a capture that genuinely recorded nothing would
    // otherwise re-fetch on every render for the rest of the session.
    fetched.current.add(bug.humanId);
    let live = true;
    void fetchBug(bug.humanId).then((full) => {
      if (live && full) onHydrateBug(full);
    });
    return () => {
      live = false;
    };
  }, [bug?.humanId]);
  if (!bug && !hydrated) return null;
  if (!bug) return <Navigate to="/sessions" replace />;
  // Back returns to wherever this session was opened from when the opener said so — an initiative,
  // most often — and to the list otherwise. Not browser history: the player stamps `?t=` with a
  // replace, which mints a fresh location key, so a directly opened session looks like it has
  // somewhere to go back to when it does not. Relative paths only, so a crafted link cannot turn
  // Back into an off-site redirect.
  const from = search.get("from");
  const backTo = from && from.startsWith("/") && !from.startsWith("//") ? from : "/sessions";
  const back = () => navigate(backTo);
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
      initiatives={initiatives}
      onInitiativeChange={onInitiativeChange}
      onTagsChange={onTagsChange}
      onEdit={onEdit}
      onRetrySync={onRetrySync}
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
  onSubmit: (d: Draft) => Promise<Bug>;
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
        navigate("/sessions", { replace: true });
      }}
      onSkip={() => navigate("/drafts", { replace: true })}
    />
  );
}

function App() {
  // Paint from the cached session immediately, then confirm it with the server. A token the
  // backend no longer honours must not keep someone looking signed in.
  const [user, setUser] = useState<AuthUser | null>(loadSession);
  useEffect(() => {
    void verifySession().then((fresh) => {
      if (fresh || !loadSession()) setUser(fresh);
    });
  }, []);
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
