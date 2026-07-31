# Bug Finder — Dashboard PRD

## Original problem statement (verbatim, growing over sessions)
1. > lets serve the dashboard through our ui folder and then we will need to add
>   few ai elements in it in draft page etc to help create and auto fill the
>   message and details like tag team through the issue or notes, by parsing
>   that, so user doesn't need to write everything etc
2. > also improve the ui of our network panel response etc as well add proper
>   good developer like formatting, preview json parsing etc highlighting search
>   etc make it best and easy to debug, also lets have a mcp or route for the
>   bug as well, or id which we can share through mcp to an agent and agent will
>   be able to get all the interaction messages all the data dn all for bug to
>   fix or etc, also expose a endpoint as well for agent to post messages as
>   well in our chat etc
3. > also once done give me a file or message to send to an agent to make the
>   changes in extension so extension now points to this url now

## Architecture

- **Frontend** — `/app/frontend`: Vite + React 19 + TypeScript + Tailwind 4.
  Served by supervisor via `yarn start` on port 3000 (`vite --host 0.0.0.0
  --port 3000`). `vite.config.ts` allows all hosts + wss HMR + `REACT_APP_*`
  env prefix, so `import.meta.env.REACT_APP_BACKEND_URL` works.
- **Backend** — `/app/backend`: FastAPI (uvicorn on 8001, supervisor-managed).
  Uses `emergentintegrations.llm.chat.LlmChat` +
  `anthropic/claude-sonnet-4-5-20250929` via the `EMERGENT_LLM_KEY` universal key.
  MongoDB via `motor` for bug snapshots + agent comments (`MONGO_URL`, `DB_NAME`).
- **Persistence** —
  - Drafts stay in the browser (IndexedDB) — personal until submitted.
  - Filed bugs live in **both** IndexedDB (for offline UX) **and** Mongo
    (`bugs` collection) via auto-publish. Agent comments live in Mongo
    (`bug_comments` collection).
- **Extension bridge** — the browser extension delivers drafts through
  `window.postMessage({ source: "bugfinder-extension", type: "draft", draft })`.
  Dashboard content in `App.tsx` listens, persists, opens the draft review.
  See `/app/EXTENSION_HANDOFF.md` for the full handoff spec.

## Backend endpoints (session 2)

| Method | Path | Purpose |
| --- | --- | --- |
| GET  | `/api/health`                          | liveness |
| POST | `/api/ai/draft-fill`                   | Claude Sonnet 4.5 auto-fills the draft |
| PUT  | `/api/bugs/{humanId}`                  | dashboard upserts a bug snapshot |
| GET  | `/api/bugs/{humanId}`                  | full JSON incl. `agentComments` |
| DEL  | `/api/bugs/{humanId}`                  | drop snapshot + comments |
| GET  | `/api/bugs/{humanId}/summary.md`       | dense markdown briefing for LLM tools |
| POST | `/api/bugs/{humanId}/comments`         | agent posts a comment / fix proposal |
| GET  | `/api/bugs/{humanId}/comments?since=`  | dashboard polls for new agent comments |
| GET  | `/api/mcp/bugs/{humanId}`              | self-describing MCP directory |

## What's implemented

### Session 1 (2026-01-31)
- Moved Vite app to `/app/frontend`, wired supervisor.
- Backend + Claude Sonnet 4.5 auto-fill endpoint (`/api/ai/draft-fill`).
- "✨ AI fill report" button + per-field sparkle buttons on the Draft page.
- Assignee selector added, with AI reason chip.
- `bugFromDraft(...)` resolves the AI's `assigneeId` → `Reporter`.

### Session 2 (2026-01-31, later same day)
- **Network panel redesign** (`InspectorRail.tsx`):
  - Column header (t · METHOD · STATUS · PATH · TYPE · SIZE · TIME).
  - `All / XHR-Fetch / Errors` filter chips with counts.
  - Search box that filters requests by URL / body / status **and** highlights
    matches inside the URL, headers, and JSON viewer.
  - Expandable detail with three sub-tabs — `HEADERS · PREVIEW · RESPONSE`.
  - New `JsonView` component (`components/common/JsonView.tsx`): pretty-prints
    parsed JSON with syntax highlighting (keys / strings / numbers / booleans
    / null / punctuation) via CSS variables that adapt to light + dark themes.
  - "JSON" pill badge appears when the body parses; `TextView` is the plain
    fallback with the same search highlighting.
- **MCP / agent surface**:
  - `PUT /api/bugs/{humanId}` — dashboard auto-publishes on every
    `persistSubmittedBug` (via `lib/bugs-api.ts` → `publishBug`).
  - `GET /api/bugs/{humanId}` + `/summary.md` — everything an agent needs.
  - `POST /api/bugs/{humanId}/comments` — an agent posts a chat message.
    `BugDetail` polls every 5s and merges results into the history feed with
    a distinct "agent" avatar + badge.
  - **"Share with agent"** violet button on the bug detail header copies the
    MCP directory URL so it can be pasted into an agent tool.
- **Extension handoff** — `/app/EXTENSION_HANDOFF.md` — a self-contained brief
  the extension agent can consume without any of this repo's context.

## What still lives client-side
- Draft persistence — IndexedDB (personal until submit).
- Local auth (SHA-256 in `localStorage`).
- Cross-tab sync via `BroadcastChannel` (unchanged).

## Backlog (prioritized)
- **P1** — Stream the AI response (SSE) so long descriptions arrive token by
  token instead of a lump.
- **P1** — Server-side persistence for drafts (currently only filed bugs are
  in Mongo). Would unblock multi-device.
- **P1** — Real auth on `/api/bugs/*` (currently open in the preview pod).
- **P2** — Duplicate detection on AI fill (top-3 similar filed bugs).
- **P2** — Push (SSE/WebSocket) for agent comments instead of 5s polling.
- **P2** — First-class MCP server (JSON-RPC over stdio) that fronts the REST
  surface — turn `/api/mcp/bugs/{humanId}` into a real tool an MCP-aware
  agent can auto-discover.
- **P3** — Track AI fill usage per-user (see enhancement idea below).

## Next action items
- Ship `EXTENSION_HANDOFF.md` to the extension agent.
- Confirm with the user whether they want SSE streaming next, or full auth
  on the agent endpoints first.

## 2026-06 (fork): Chrome DevTools-grade JSON viewing in Network panel
- Root cause of "not highlighted/formatted" JSON: extension-captured response bodies are often TRUNCATED mid-JSON, so JSON.parse failed and the UI fell back to a plain-text blob.
- Fix: added `jsonrepair` fallback in `tryParseJson` (JsonView.tsx) — truncated bodies are repaired then parsed.
- Preview tab now renders a Chrome DevTools-style collapsible JSON tree (`react18-json-view`, new `JsonTree` component), themed via index.css overrides for light + dark.
- Response tab now shows pretty-printed syntax-highlighted JSON source (falls back to plain text for non-JSON).
- Verified via seeded IndexedDB bug with truncated JSON body, light + dark mode screenshots (Preview tree expand/collapse + Response highlighting).
