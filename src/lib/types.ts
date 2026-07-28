// ABOUTME: Shared domain types for the bug dashboard — mirrors what the capture
// ABOUTME: extension will eventually submit (recording, console, network, elements).

export type BugStatus = "open" | "in_progress" | "resolved" | "not_a_bug" | "wont_fix";
export type BugSeverity = "low" | "medium" | "high" | "critical";

export interface Reporter {
  id: string;
  name: string;
  email: string;
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
  kind: "created" | "status" | "comment" | "assigned";
  detail: string;
  at: number;
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
  /** Real rrweb recording (pixel-accurate replay) — present on bugs captured by the extension.
   *  When set, the player renders the rrweb Replayer instead of the wireframe simulation. */
  rrweb?: unknown[];
  /** File id of the recording in the storage service — the player fetches it via its
   *  download URL when `rrweb` isn't inline. Uploaded recordings keep local rows light. */
  rrwebFileId?: string;
  /** Playback offset into the rrweb recording (ms) — set when the draft was trimmed, since the
   *  rrweb event stream keeps its full length (the initial snapshot lives at the start). */
  rrwebOffset?: number;
}

/** A captured session awaiting review — what the extension hands off before a bug exists.
 *  The reporter reviews the replay, trims it, adds flags, fills the form, then submits. */
export interface Draft {
  id: string;
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
  notes?: string;
  /** Real rrweb recording from the extension, when present inline. */
  rrweb?: unknown[];
  /** Storage-service file id of the recording (uploaded by the extension or demo capture). */
  rrwebFileId?: string;
  /** Kept window of the recording — events outside are dropped on submit. */
  trim?: { in: number; out: number };
  title?: string;
  description?: string;
  severity?: BugSeverity;
  tags?: string[];
}
