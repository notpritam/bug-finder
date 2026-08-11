# BugDash — system flow

The purpose of this system: **a filed bug should contain everything needed to debug it** — no
"can you reproduce and check the console" round-trips. Two consumers, one capture: humans replay
the session in the dashboard; agents (Claude etc.) read the same evidence through the API.

## Capture → file → debug

```
┌─ page under test ───────────────────────┐
│ hook.ts (MAIN world)                        │   console (printf-interpolated + stacks)
│   wraps console/fetch/XHR/history/errors    │   network (headers + JSON/text bodies, secrets
│   reads window.__layoutDebug / __rowLedger  │   redacted, ~10KB caps), SPA navs, web vitals,
└──────────────┬────────────────────────┘   layout-debugger slot table + verdicts
               │ postMessage
┌──────────────▼────────────────────────┐
│ recorder.ts (isolated world)                │   rrweb pixel stream, pointer/scroll/input
│   buffers everything, survives navigations  │   trail, screenshots, markers, pre-roll
└──────────────┬────────────────────────┘
               │ DraftPayload
   side panel (review) → bridge → dashboard UI (drafts → Bug, IndexedDB)
               │ PUT /api/bugs/{humanId}   (full snapshot, permissive schema)
┌──────────────▼────────────────────────┐
│ this backend (FastAPI + Mongo)              │
│   humans: dashboard reads full JSON         │
│   agents: /api/mcp/bugs/{id} → inline       │
│   summary + drills (network bodies,         │
│   console stacks, layout verdicts)          │
└───────────────────────────────────────┐
```

## Module map (`bugdash/`)

| Module | Owns |
| --- | --- |
| `core.py` | env, Mongo handles, `now_ms`/`clean_bug_doc`/`fmt_offset` |
| `models.py` | every pydantic schema (draft-fill, bugs, comments, initiatives) |
| `evidence.py` | pure shaping: console dedupe (+stacks), network index/rollup, layout markdown |
| `bugs.py` | snapshot CRUD + drills: `/network`, `/network/{i}`, `/console`, `/layout` |
| `domtime.py` | DOM time-travel: rrweb rebuild at any `t` + selector query (`/dom`), app-state drill (`/state`) |
| `summary.py` | `build_summary_markdown` + `GET /api/bugs/{id}/summary.md` |
| `mcp.py` | `GET /api/mcp/bugs/{id}` — summary inline + resource map |
| `comments.py` | agent ↔ dashboard thread |
| `ai.py` | Claude draft-fill (reporter text authoritative, evidence sharpens) |
| `initiatives.py` | initiative CRUD (owner-gated) |

## Rules that keep this debuggable

1. **Never truncate silently** — every clipped quote in `summary.md` cites the drill URL that
   serves the full record.
2. **Dedupe, don't drown** — 108 copies of one React warning are one group with `×108`, so the
   25-line budget describes 25 distinct problems.
3. **200s are evidence too** — the broken render usually came from a successful response; the
   API rollup indexes every endpoint the page talked to, not just failures.
4. **The wire schema is permissive** — `BugPayload` allows unknown fields, so a newer extension
   never breaks an older backend. New evidence lands as a new optional field end-to-end:
   extension `types.ts` → dashboard `types.ts`/`drafts.ts` passthrough → a renderer in the
   inspector → a section in `summary.py`.
5. **Secrets are scrubbed at capture** (extension hook) — the backend must never assume bodies
   are safe to re-serve elsewhere; they stay inside the bug record.

## Conventions: what the extension reads off the page at stop

At recording stop the extension asks the page (MAIN world) once and attaches whatever answers.
Absent globals are the NORMAL case — fields are omitted and the corresponding tabs/sections
simply don't render.

**Automatic (works on any app that stamps build identity):** `appInfo` —

- version/build globals: `__APP_VERSION__`, `__BUILD_TIME__`, `__BUILD_COMMIT__`, `__BUILD_ID__`, `__VERSION__`
  (E1ectron sets the first two in main.tsx);
- any `<meta name>` matching /version|build/i (e.g. E1ectron's `e1ectron-scorecard-build-sha`);
- the loaded `<script src>` chunk URLs — the hashed filenames that map a minified stack to the
  exact deployed bundle.

**Opt-in (dormant until an app exposes them):**

- `window.__layoutDebug.snapshot()` → `{ viewport, virtualRows, virtualRowIssues }` — a
  virtualized-list slot table plus overlap/duplicate-key verdicts → `layoutDebug`.
- `window.__rowLedger.events` → measurement flight-recorder tail (last ≤150 events) → `layoutDebug`.
- `window.__DEBUG_STATE__` (object, or function returning one) → serialized, secret-scrubbed,
  50KB cap → `debugState`, served parsed at `/api/bugs/{id}/state`.

Origin: E1ectron chat-v3's `?layoutDebug=1` tracker — its Copy payload hand-pasted into BF-107
is what cracked that bug; the pull automates the hand-off. Any app joins by exposing the globals.

## DOM time-travel (`/api/bugs/{id}/dom`)

The rrweb recording IS a DOM history: a FullSnapshot plus every mutation. `domtime.py` rebuilds
the tree at any replay-clock `t` (latest snapshot ≤ t, then mutations + input values up to t)
and answers selector queries against it — so an agent can ask "what did `#checkout-button` /
`[data-testid*=banner]` look like at the 0:04 flag vs 0:33" and diff, without a browser. Uses
the same `t` clock as markers/console/network rows. Scroll/media/viewport events are
deliberately not applied — they don't change the tree an agent greps.
