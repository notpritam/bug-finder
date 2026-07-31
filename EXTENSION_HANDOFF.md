# Bug Finder — Extension ↔ Dashboard handoff

**Hi extension agent 👋** — the Bug Finder dashboard has moved. Everything below is what
you need to know to point the browser extension at the new URL and keep the two sides
in sync. No API keys, no OAuth — the wire is a mix of `window.postMessage` (for drafts)
and plain REST (for storage + agent chat).

---

## 1. New dashboard URL

The dashboard is now served at:

```
https://auto-fill-dashboard.internal.preview.emergentagent.com
```

- `/drafts`  → user's inbox of unfiled captures
- `/drafts/:id` → the review page for one captured session
- `/bug/:humanId` → a filed bug ("BF-123") with replay + inspector + agent chat

You should replace **any** hardcoded old dashboard host in the extension code with
this one, and expose it as a build-time / user-editable setting so we can swap
environments later.

Recommended config shape in the extension:

```ts
// extension/src/config.ts
export const DASHBOARD_ORIGIN = process.env.DASHBOARD_ORIGIN
  ?? "https://auto-fill-dashboard.internal.preview.emergentagent.com";
export const DASHBOARD_DRAFTS_URL = `${DASHBOARD_ORIGIN}/drafts`;
export const STORAGE_API = "https://storage-api-docs.internal.emergent.host/api";
export const DASHBOARD_BACKEND = `${DASHBOARD_ORIGIN}`; // REST base for MCP/agent APIs
```

---

## 2. How to deliver a captured draft to the dashboard

The dashboard listens for `window.postMessage` on the drafts page (or any dashboard
tab currently open). Content script protocol — **this hasn't changed**, keep it as-is:

**From extension → dashboard:**
```js
window.postMessage({
  source: "bugfinder-extension",
  type: "draft",
  draft: /* DraftPayload — see shape below */
}, "*");
```

**From dashboard → extension (ack):**
```js
window.postMessage({
  source: "bugfinder-dashboard",
  type: "draft-received"
}, "*");
```

When the user finishes a capture in the extension, open (or focus) the dashboard
drafts URL, wait for it to load, then post the message. The dashboard will
persist the draft to IndexedDB, navigate to `/drafts/<id>`, and post the ack.

If no dashboard tab is open, open a new one at `DASHBOARD_DRAFTS_URL` and post the
message once the load completes (an `injected` content script + a small
`window.addEventListener("load", ...)` handshake works well).

---

## 3. `DraftPayload` shape the dashboard expects

Only `id`, `pageUrl`, and `pageTitle` are required; everything else is best-effort.

```ts
interface DraftPayload {
  id: string;                    // extension-generated, e.g. `d-${crypto.randomUUID()}`
  capturedAt: number;            // epoch ms
  pageUrl: string;
  pageTitle: string;
  durationMs: number;

  // Timeline events — every `t` is ms from the start of the recording.
  replay: Array<
    | { t: number; kind: "move";   x: number; y: number }
    | { t: number; kind: "click";  x: number; y: number; target?: string }
    | { t: number; kind: "scroll"; y: number }
    | { t: number; kind: "input";  field: string; value: string }
    | { t: number; kind: "nav";    url: string }
    | { t: number; kind: "error";  message: string }
  >;
  console: Array<{
    t: number;
    level: "log" | "info" | "warn" | "error" | "debug";
    text: string;
  }>;
  network: Array<{
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
  }>;
  pickedElements: Array<{
    selector: string;
    tag: string;
    text?: string;
    // rect is normalized 0..1 relative to the captured viewport
    rect: { x: number; y: number; w: number; h: number };
    t?: number;
    note?: string;
    component?: string;
  }>;
  markers: Array<{ t: number; label?: string; kind?: "user" | "error" }>;
  visits:  Array<{ t: number; url: string; title?: string }>;

  environment: {
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
  };
  notes?: string;

  // rrweb recording — inline OR uploaded to the storage service (see §4).
  rrweb?: unknown[];
  rrwebFileId?: string;
}
```

### Session-aware submissions

The dashboard writes a session snapshot to `localStorage` at key **`bf.session-user`**
whenever a user signs in/out. If the extension is running as a content script inside
the dashboard origin, it can read this key to attach `reporter` metadata to a draft.
If it's a background/service-worker context, just omit `reporter` — the dashboard
will fill it from its own session on receipt.

---

## 4. rrweb recording upload — Emergent File Storage

The dashboard keeps IndexedDB rows small by offloading rrweb event streams to the
Emergent File Storage service. The extension **should do the same** (uploading a
1-minute recording inline is ~2-10 MB).

**Endpoint:** `POST https://storage-api-docs.internal.emergent.host/api/files/upload`
- Content-Type: `multipart/form-data`
- Field: `file` — a `Blob` of `application/json` containing the rrweb events array
- Response: `{ id: string }` — this is what you set as `rrwebFileId` on the draft

Working example (from `frontend/src/lib/storage-api.ts`):

```ts
const form = new FormData();
form.append(
  "file",
  new Blob([JSON.stringify(rrwebEvents)], { type: "application/json" }),
  `${draftId}-rrweb.json`,
);
const res = await fetch(`${STORAGE_API}/files/upload`, { method: "POST", body: form });
const { id } = await res.json();
// then set draft.rrwebFileId = id  (and omit draft.rrweb)
```

If the upload fails, keep `rrweb` inline as a fallback — the dashboard handles both.

---

## 5. New backend on the dashboard side (relevant to you)

The dashboard now runs a small FastAPI backend at the same origin, prefixed
`/api`. Everything the extension might want is CORS-open (no auth), single-tenant
preview environment.

### 5.1 AI auto-fill (already used by the dashboard's draft page)

```
POST /api/ai/draft-fill
```
Powered by Claude Sonnet 4.5 via the Emergent Universal Key. The extension does
**not** need to call this — the dashboard invokes it when the user hits the
"✨ AI fill report" button on the draft review page. Mentioned for context.

### 5.2 Bug snapshot publishing (dashboard does this on every mutation)

Whenever a bug is filed or edited, the dashboard calls
`PUT /api/bugs/{humanId}` with the full snapshot so agents can consume it. The
extension **does not** need to publish anything — you just need to deliver a
draft; the dashboard takes it from there. Endpoints exposed for reference:

```
PUT   /api/bugs/{humanId}                 → dashboard upserts snapshots (idempotent)
GET   /api/bugs/{humanId}                 → agent reads full JSON (all evidence)
GET   /api/bugs/{humanId}/summary.md      → dense markdown summary for LLM tools
POST  /api/bugs/{humanId}/comments        → agent posts a comment / fix proposal
GET   /api/bugs/{humanId}/comments        → dashboard polls; ?since=<epochMs>
GET   /api/mcp/bugs/{humanId}             → self-describing directory of the above
```

If you want to give the extension an "Ask an agent to look at this" button that
opens some external MCP client, use the `agent share URL`:

```
${DASHBOARD_ORIGIN}/api/mcp/bugs/{humanId}
```

That single URL is enough for an agent to discover everything it can do with the bug.

---

## 6. Auth / accounts

The dashboard has local-only accounts (SHA-256 in `localStorage`) — no server
tokens exist yet. If the extension needs to know "who is the user?", read
`bf.session-user` from `localStorage` when running same-origin, or open the
dashboard's `/auth` page and let the user sign in there. Don't invent tokens.

Anonymous submissions are supported: just omit `reporter` on the draft.

---

## 7. Quick smoke test

1. Rebuild the extension with `DASHBOARD_ORIGIN=https://auto-fill-dashboard.internal.preview.emergentagent.com`.
2. Load the extension unpacked in Chrome.
3. Visit any web page and start a recording; do a few actions; stop.
4. Extension should:
   - upload the rrweb events to Emergent File Storage → get `rrwebFileId`
   - open/focus a tab at `${DASHBOARD_ORIGIN}/drafts`
   - `postMessage({ source: "bugfinder-extension", type: "draft", draft })` on that tab
5. Dashboard should:
   - land you on `/drafts/<id>` with the replay + timeline + AI Fill button
6. Click **✨ AI fill report** — title, tags, severity, description, and assignee
   should populate within ~2s.
7. Click **Submit bug** — you should end up at `/bug/BF-<n>`.
8. Copy the humanId, then curl:
   ```bash
   curl "${DASHBOARD_ORIGIN}/api/bugs/BF-<n>/summary.md"
   ```
   You should get a rich markdown briefing of that bug. Same happens when an
   agent posts to `/api/bugs/BF-<n>/comments` — the message shows up in the
   bug's History & comments within ~5s (dashboard polls).

---

## 8. What NOT to change

- Don't touch the `postMessage` protocol — the dashboard content script bridge
  depends on the exact `source` / `type` string values.
- Don't add a client-side auth token to the draft — the dashboard's account
  system is intentionally local-only right now.
- Don't cache the storage `rrwebFileId` cross-user — the storage service is
  keyed by the anonymous upload, per-file.

That's everything. Ping me (dashboard owner) if the draft shape needs a new field
— easy to add on my side without breaking your builds.
