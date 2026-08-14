# ABOUTME: MCP directory — one fetch gives an agent the whole briefing inline PLUS the map of
# ABOUTME: drill endpoints, instead of a bare list of links that costs another round-trip each.
from typing import Any

from fastapi import Depends, APIRouter

from .auth import require_user
from .bugs import load_bug
from .capture_health import capture_health
from .comments import list_comments_for
from .evidence_store import evidence_unavailable
from .summary import build_summary_markdown

router = APIRouter()


@router.get("/api/mcp/bugs/{human_id}")
async def mcp_bug(human_id: str, user: dict[str, Any] = Depends(require_user)) -> dict[str, Any]:
    """Self-describing agent entry point. The summary rides inline — an agent that fetches this
    URL is trying to debug NOW, so make the first fetch the informative one."""
    doc = await load_bug(human_id)
    # Every hasX flag and deepCapture count below reads an offloaded key, so unreachable evidence
    # would render them all zero/false — telling the agent this capture holds nothing, which is the
    # exact claim that stops it drilling any further.
    #
    # But refusing outright is worse. This used to call guard_offloaded and 413 the whole response
    # when the evidence was merely too large to inline, so an agent handed the richest capture in
    # the corpus got NOTHING — not the title, not the counts, not the drill map, not even the
    # download URL in a form it could act on. Degrade instead: serve everything that is inline,
    # say plainly which numbers are therefore unknown, and hand over the address of the rest.
    unavailable = evidence_unavailable(doc)
    comments = await list_comments_for(human_id)
    return {
        "humanId": human_id,
        # Present ONLY when some evidence could not be read. Its presence is the agent's signal
        # that the zeroes below are "not known" rather than "not there" — the distinction that
        # decides whether it keeps looking.
        **({"evidenceIncomplete": {
            **unavailable,
            "note": (
                "Counts and hasX flags below cover only the evidence served inline. "
                "Fetch the file at downloadUrl for the rest, or use the per-field drill endpoints "
                "on captures published since evidence was split by field."
            ),
        }} if unavailable else {}),
        "title": doc.get("title"),
        "status": doc.get("status"),
        "jobId": doc.get("jobId"),
        "hasLayoutEvidence": bool(doc.get("layoutDebug")),
        "hasRecording": bool(doc.get("rrwebFileId") or (isinstance(doc.get("rrweb"), list) and len(doc["rrweb"]) > 1)),
        "hasDebugState": bool(doc.get("debugState")),
        # Deep capture (schema 5). Flags rather than payloads: an agent should know what exists
        # before deciding which drill endpoint is worth a round-trip.
        "deepCapture": {
            "stateSources": len(doc.get("stateSources") or []),
            "stateChanges": len(doc.get("stateChanges") or []),
            "cookies": len(doc.get("cookiesAtStop") or doc.get("cookiesAtStart") or []),
            "httpOnlyCookies": sum(
                1 for c in (doc.get("cookiesAtStop") or doc.get("cookiesAtStart") or []) if c.get("httpOnly")
            ),
            "browserLog": len(doc.get("browserLog") or []),
            "storageWrites": len(doc.get("storageChanges") or []),
            "harEntries": doc.get("harEntryCount"),
            # Absent on a degraded capture, which is why the reason travels with it: a thin
            # report because the debugger never attached looks exactly like a quiet page.
            "debuggerAttached": (doc.get("cdp") or {}).get("attached"),
            "debuggerReason": (doc.get("cdp") or {}).get("reason"),
        },
        # Which capture schema produced this row. A browser runs the OLD content script until the
        # unpacked extension is reloaded, so "field missing" and "extension is stale" look
        # identical without it — that ambiguity is what made BF-108 slow to read.
        "captureSchemaVersion": doc.get("captureSchemaVersion"),
        # How the recording itself went. Two very different problems present as one thin report:
        # a page that was genuinely quiet, and a capture that shed evidence to stay inside memory
        # or crashed part-way. An agent asked to explain a gap should be able to tell them apart
        # without asking the reporter, and `extensionErrors` is the only route by which a crash in
        # the extension reaches anybody at all — that ring lives in the reporter's browser and
        # rides out on the next capture that files successfully.
        "captureHealth": capture_health(doc.get("diagnostics")),
        "appInfo": doc.get("appInfo") if isinstance(doc.get("appInfo"), dict) else None,
        "summary_markdown": build_summary_markdown(doc, comments),
        "resources": {
            "full_json": f"/api/bugs/{human_id}",
            "markdown_summary": f"/api/bugs/{human_id}/summary.md",
            "network_index": f"/api/bugs/{human_id}/network",
            "network_entry": f"/api/bugs/{human_id}/network/{{i}} — headers + request/response bodies",
            "console": f"/api/bugs/{human_id}/console?level=error&q=&dedupe=1 — includes component stacks",
            "layout": f"/api/bugs/{human_id}/layout — slot table, overlap verdicts, measurement ledger",
            "dom_at": f"/api/bugs/{human_id}/dom?t=<ms>&selector=<css>&q=<text> — element state at any replay moment; compare two t values to watch state move; full=1 returns page HTML",
            "app_state": f"/api/bugs/{human_id}/appstate?at=<ms>&source=<id> — Redux/TanStack/useState baselines plus RFC 6902 patches; `at` rebuilds state at any replay moment",
            "cookies": f"/api/bugs/{human_id}/cookies?http_only=1 — every cookie incl. httpOnly, plus what changed mid-recording",
            "browser_log": f"/api/bugs/{human_id}/browserlog?level=error — CORS blocks, CSP violations, mixed content; never appears in console",
            "storage": f"/api/bugs/{human_id}/storage — localStorage/sessionStorage at start and stop, the write log, IndexedDB and Cache Storage",
            "har": f"/api/files/{doc.get('harFileId')} — full HAR 1.2: waterfall timings, wire headers, request/response bodies"
            if doc.get("harFileId")
            else None,
            "comments": f"/api/bugs/{human_id}/comments",
            "post_comment": {
                "method": "POST",
                "url": f"/api/bugs/{human_id}/comments",
                "body": {"body": "string", "actor": "string (optional)", "kind": "comment|status_suggestion|fix_proposal"},
            },
        },
    }
