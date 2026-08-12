# ABOUTME: FastAPI app assembly for the BugDash backend — uvicorn target stays `server:app`.
# ABOUTME: All behaviour lives in bugdash/* modules; see ARCHITECTURE.md for the system flow.
#
# System flow, in one paragraph: the bug-finder extension records a session (rrweb pixels,
# console with stacks, network with bodies, interactions, layout-debugger evidence when the page
# exposes it), the reporter reviews it in the side panel, and the dashboard files it — publishing
# the full snapshot here (PUT /api/bugs/{id}). Humans read it back in the dashboard UI; agents
# read it through /api/mcp/bugs/{id} (inline summary + drill endpoints) and post findings to the
# comment thread the dashboard polls.
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from bugdash import (
    admin, ai, auth, bugs, comments, domtime, events, initiatives, mcp, mcp_server,
                     oauth, summary)

app = FastAPI(title="BugDash AI")

# Known dashboard origins only — the bug corpus contains real session cookies, so a wildcard
# here let any website read it cross-origin from a visitor's browser.
DASHBOARD_ORIGINS = [
    "https://auto-fill-dashboard.internal.preview.emergentagent.com",
    "https://auto-fill-dashboard.internal.emergent.host",
    "https://6c7b0950-802f-4310-bb1e-17b6c2c167e9.internal.preview.emergentagent.com",
    "http://localhost:5173",
    "http://localhost:7342",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=DASHBOARD_ORIGINS,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


# Order is cosmetic (paths don't overlap) — kept in "reader" order: evidence surfaces first.
app.include_router(auth.router)
app.include_router(bugs.router)
app.include_router(domtime.router)
app.include_router(summary.router)
app.include_router(comments.router)
app.include_router(events.router)
app.include_router(mcp.router)
app.include_router(ai.router)
app.include_router(initiatives.router)
app.include_router(admin.router)
# The MCP endpoint agents connect to. Mounted at /mcp, outside /api, because that is the URL a
# person pastes into their client.
app.include_router(mcp_server.router)
# Before the catch-alls: the .well-known and /oauth routes are what let a client authorize in a
# browser instead of asking a human to paste a token.
app.include_router(oauth.router)
# Mounted twice on purpose. The ingress forwards only /api/* to this service, so /api/mcp
# and /api/oauth/* are the paths a real client can reach; the unprefixed ones stay for
# direct-to-backend use (local runs, tests, health checks).
app.include_router(mcp_server.router, prefix="/api")
app.include_router(oauth.router, prefix="/api")
