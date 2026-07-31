# Bug Finder — Dashboard PRD

## Original problem statement (verbatim)
> lets serve the dashboard through our ui folder and then we will need to add few
> ai elements in it in draft page etc to help create and auto fill the message and
> details like tag team through the issue or notes, by parsing that, so user
> doesn't need to write everything etc

## Architecture

- **Frontend** — `/app/frontend`: Vite + React 19 + TypeScript + Tailwind 4 (moved
  from `/app` root to conform to the pod's supervisor layout). Vite serves on
  port 3000 via `yarn start` (`vite --host 0.0.0.0 --port 3000`), config allows
  all hosts + wss HMR through the preview ingress. `envPrefix` extended with
  `REACT_APP_` so `import.meta.env.REACT_APP_BACKEND_URL` resolves in code.
- **Backend** — `/app/backend`: FastAPI (uvicorn on 8001, supervisor-managed).
  One endpoint today: `POST /api/ai/draft-fill`. Uses
  `emergentintegrations.llm.chat.LlmChat` with `anthropic / claude-sonnet-4-5-20250929`
  and the `EMERGENT_LLM_KEY` universal key.
- **Persistence** — Drafts and filed bugs still live in IndexedDB in the
  browser (no backend DB writes yet). MongoDB is available but unused.

## Users
- **Reporter (guest or signed-in)** — records a session with the browser
  extension (owned by the user, out of scope for the dashboard), reviews it here,
  fills the report, submits.
- **Assignee (developer)** — receives the filed bug with a matched owner.

## Core functionality

### Existing (kept working)
- Sign in / sign up / anonymous session (local-only accounts).
- Sidebar navigation (Drafts / All / Open / In progress / Resolved / Mine).
- Draft review: replay player, trim handles, flags, inspector rail
  (activity/console/network/elements/info).
- Draft form (title, severity, environment, tags, initiative, job id,
  credentials, description, notes).
- Bug list + bug detail (status, severity, assignee, comments, history).
- Extension bridge (`window.postMessage`) — a draft delivered from the extension
  auto-opens for review.

### New — AI Auto-fill (this session)
- **"AI fill report"** violet-gradient button in the review toolbar. One click
  parses `notes + console errors + failed network calls + picked elements +
  pageUrl` and fills: title, description (Expected/Actual/Steps),
  severity, tags (whitelisted), assignee (from team roster with role/team match),
  and initiative (whitelisted).
- **Per-field sparkle "AI" buttons** next to Title, Severity, Tags, Assignee,
  Initiative, Description — regenerate just one field.
- **Assignee selector** added to the draft form with the AI's reason chip
  ("MC · 500 on order endpoint → payments engineer").
- Backend coerces LLM output: tags dedup + whitelist match, severity enum
  validation, assignee id must exist in team, initiative must be whitelisted.
- Errors surface inline (red banner) — never silent.

## What's implemented (2026-01-31)
- Moved Vite app from `/app` → `/app/frontend`, wired `yarn start` for
  supervisor.
- Created `/app/backend/server.py` with `/api/health` + `/api/ai/draft-fill`.
- New: `frontend/src/lib/ai.ts`, `MagicButton`, assignee picker in `DraftReview`.
- Draft type gained `assigneeId?: string | null`; `bugFromDraft` resolves it
  against `people` so the filed bug lands pre-assigned.
- CORS wide-open on the backend (single-tenant preview app).

## Prioritized backlog
- **P1** — Persist bugs/drafts server-side (Mongo) so they survive across
  devices, not just IndexedDB.
- **P1** — Stream the AI response (SSE) so long descriptions arrive token by
  token instead of a lump.
- **P2** — Duplicate detection: on AI fill, also return top‑3 similar bugs
  from the existing list.
- **P2** — Let a team manager promote a bug to a Jira/Linear ticket via the
  filed bug page.
- **P2** — Adjustable tone / language for descriptions (concise vs. verbose).
- **P3** — Track AI fill usage (per-user counter) to nudge the workflow.

## Next action items
- Ask the user whether they want AI streaming (nice-to-have) and server-side
  persistence (needed for multi-device).
- Once the extension side lands their end, verify a real extension-delivered
  draft round-trips through AI fill → submit.
