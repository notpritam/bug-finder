// ABOUTME: Shared domain types for the bug dashboard — mirrors what the capture
// ABOUTME: extension will eventually submit (recording, console, network, elements).

export type BugStatus = "open" | "in_progress" | "resolved" | "not_a_bug" | "wont_fix";
export type BugSeverity = "low" | "medium" | "high" | "critical";

export interface Reporter {
  id: string;
  name: string;
  email: string;
  /** Org context, when the reporter has an account (role/team chosen at signup). */
  role?: string;
  team?: string;
}

/** The account used on the app under test while reproducing — so a developer can sign in
 *  with the same account. Password masked by default in the UI. */
export interface TestCredentials {
  username?: string;
  password?: string;
  notes?: string;
}

/** A marked moment on the recording clock — "this is the bug". `t` is ms from recording start. */
export interface BugMarker {
  t: number;
  label?: string;
  /** `error` = auto-marker synthesized at a captured error; `user` = hand-placed pin. */
  kind?: "user" | "error";
}

/** One navigation captured during the recording — full load or SPA route change. */
export interface BugVisit {
  t: number;
  url: string;
  title?: string;
}

/** One console line captured during the recording, positioned on the replay clock. */
export interface ConsoleEntry {
  t: number;
  level: "log" | "info" | "warn" | "error" | "debug";
  text: string;
}

/** One captured network call, synced to the replay clock. */
export interface NetEntry {
  id: string;
  t: number;
  durationMs: number;
  method: string;
  url: string;
  status: number;
  statusText?: string;
  type?: "fetch" | "xhr" | "doc" | "js" | "css" | "img" | "ws";
  requestHeaders?: Record<string, string>;
  requestBody?: string | null;
  responseHeaders?: Record<string, string>;
  responseBody?: string | null;
  sizeBytes?: number;
}

/** An element the reporter picked on the page — selector identity + geometry (0..1 of viewport). */
export interface PickedElement {
  selector: string;
  tag: string;
  text?: string;
  /** Normalized to the captured viewport so the overlay scales onto the stage. */
  rect: { x: number; y: number; w: number; h: number };
  /** ms from recording start when picked — lets the panel seek the player there. */
  t?: number;
  note?: string;
  component?: string;
}

/** The reporter's device/browser/page environment, captured at report time. */
export interface BugEnvironment {
  browser: string;
  os: string;
  viewport: { w: number; h: number };
  dpr: number;
  language: string;
  timezone: string;
  online: boolean;
  connection?: string;
  memoryGb?: number;
  cores?: number;
}

/** Page performance at capture time — vitals sit alongside the replay so a "it felt slow"
 *  report arrives with numbers attached. */
export interface Screenshot {
  id: string;
  /** ms from recording start — a shot pins to the timeline like a flag does. */
  t: number;
  /** Storage-service file id of the annotated image. */
  fileId?: string;
  /** Path under the reporter's Downloads where the original was kept. */
  savedAs?: string;
  selector?: string;
  note?: string;
}

export interface PagePerf {
  lcp?: number;
  cls?: number;
  inp?: number;
  ttfb?: number;
  domContentLoaded?: number;
  load?: number;
}

/** One simulated rrweb-style event driving the replay stage. `t` is ms from start. */
export type ReplayEvent =
  | { t: number; kind: "move"; x: number; y: number }
  | { t: number; kind: "click"; x: number; y: number; target?: string }
  | { t: number; kind: "scroll"; y: number }
  | { t: number; kind: "input"; field: string; value: string }
  | { t: number; kind: "nav"; url: string }
  | { t: number; kind: "error"; message: string };

/** One entry in a bug's history — created / status change / comment / assignment. */
export interface BugEvent {
  id: string;
  actor: string;
  kind: "created" | "status" | "comment" | "assigned" | "edited";
  detail: string;
  at: number;
  /** Set on `edited`: which field changed and what it held before. Structured rather than
   *  prose so the history is a real version trail — who changed what, from what, when. */
  field?: string;
  from?: string;
  to?: string;
}

/** A filed bug ticket, as submitted by the capture extension. */
export interface Bug {
  id: string;
  humanId: string;
  title: string;
  description: string;
  status: BugStatus;
  severity: BugSeverity;
  tags: string[];
  pageUrl: string;
  reporter: Reporter;
  assignee: Reporter | null;
  createdAt: number;
  updatedAt: number;
  /** Recording window duration in ms. */
  durationMs: number;
  /** Stage renderer when no rrweb recording exists — only the generic wireframe remains. */
  scenario: "generic";
  replay: ReplayEvent[];
  markers: BugMarker[];
  visits: BugVisit[];
  console: ConsoleEntry[];
  network: NetEntry[];
  pickedElements: PickedElement[];
  environment: BugEnvironment;
  notes?: string;
  events: BugEvent[];
  /** Environment the bug was reproduced on — auto-detected from the URL, editable at review. */
  env?: string;
  /** Larger effort this bug belongs to (e.g. "Checkout Revamp"). */
  initiative?: string;
  /** Id of the initiative this bug was filed against — source of truth for grouping. */
  initiativeId?: string;
  /** Where the bug came from: QA on initiative work, or an existing production issue. */
  category?: "initiative" | "production";
  /** External job/ticket/build id, when relevant. */
  jobId?: string;
  /** The app-under-test account used while reproducing. */
  credentials?: TestCredentials;
  /** Real rrweb recording (pixel-accurate replay) — present on bugs captured by the extension.
   *  When set, the player renders the rrweb Replayer instead of the wireframe simulation. */
  rrweb?: unknown[];
  /** File id of the recording in the storage service — the player fetches it via its
   *  download URL when `rrweb` isn't inline. Uploaded recordings keep local rows light. */
  rrwebFileId?: string;
  /** Playback offset into the rrweb recording (ms) — set when the draft was trimmed, since the
   *  rrweb event stream keeps its full length (the initial snapshot lives at the start). */
  rrwebOffset?: number;
  /** Low-bitrate tab video recorded alongside the DOM stream — the literal footage, for the
   *  things rrweb cannot reconstruct (canvas, <video>, cross-origin iframes). */
  videoFileId?: string;
  /** The extension draft this was filed from — lets a recording that finished uploading
   *  after the bug was filed find its way back to the right ticket. */
  draftId?: string;
  /** Screenshots the reporter drew on while recording. */
  shots?: Screenshot[];
  /** Evidence gathered before recording started carries a negative `t`, reaching back this far. */
  preRollMs?: number;
  perf?: PagePerf;
}

/** A captured session awaiting review — what the extension hands off before a bug exists.
 *  The reporter reviews the replay, trims it, adds flags, fills the form, then submits. */
export interface Draft {
  id: string;
  /** Who recorded it — drafts are personal until submitted. */
  reporter?: Reporter;
  createdAt: number;
  pageUrl: string;
  pageTitle: string;
  durationMs: number;
  scenario: Bug["scenario"];
  replay: ReplayEvent[];
  console: ConsoleEntry[];
  network: NetEntry[];
  pickedElements: PickedElement[];
  markers: BugMarker[];
  visits: BugVisit[];
  environment: BugEnvironment;
  perf?: PagePerf;
  notes?: string;
  /** Console/network entries with a negative `t` were captured before the user pressed
   *  record — this is how far back that reaches. */
  preRollMs?: number;
  /** Real rrweb recording from the extension, when present inline. */
  rrweb?: unknown[];
  /** Storage-service file id of the recording (uploaded by the extension or demo capture). */
  rrwebFileId?: string;
  /** Low-bitrate tab video recorded alongside the DOM stream. */
  videoFileId?: string;
  shots?: Screenshot[];
  /** Kept window of the recording — events outside are dropped on submit. */
  trim?: { in: number; out: number };
  title?: string;
  description?: string;
  severity?: BugSeverity;
  tags?: string[];
  env?: string;
  initiative?: string;
  initiativeId?: string;
  category?: "initiative" | "production";
  jobId?: string;
  credentials?: TestCredentials;
  /** Suggested assignee (persisted so the AI suggestion survives page reload). */
  assigneeId?: string | null;
}
