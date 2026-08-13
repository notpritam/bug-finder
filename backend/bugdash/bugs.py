# ABOUTME: Bug snapshot CRUD plus the evidence drill endpoints — the agent-facing API that turns
# ABOUTME: "a bug id" into console groups, network bodies, and layout verdicts without a browser.
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query

from pymongo import ReturnDocument
from pymongo.errors import DocumentTooLarge

from . import events as feed  # aliased: patch_bug already has a local `events` (its history rows)
from .auth import require_user
from .comments import list_comments_for
from .core import bugs_col, comments_col, clean_bug_doc, db, now_ms
from .evidence_store import guard_offloaded, resolve_evidence
from .storage_compact import expand_storage_changes

counters_col = db["counters"]
#: draftId -> humanId, claimed atomically at allocation. Exists because the bug row itself cannot
#: serve as the reservation: it is not written until the client PUTs, long after the number is
#: handed out, leaving a window in which every concurrent caller allocated its own.
allocations_col = db["bug_allocations"]
from .evidence import dedupe_console, network_index
from .teams import resolve_membership
from .models import BugPayload

router = APIRouter()


async def load_bug(human_id: str, with_evidence: bool = True) -> dict[str, Any]:
    doc = await bugs_col.find_one({"humanId": human_id})
    if not doc:
        raise HTTPException(404, f"bug {human_id} not found")
    doc = clean_bug_doc(doc)
    # Heavy capture fields are offloaded to a single storage file to keep the Mongo doc small; merge
    # them back so every reader (agents included) sees a complete bug. No-op for a fully inline bug.
    if with_evidence:
        await resolve_evidence(doc)
    return doc


async def _seed_counter() -> None:
    """Start the sequence above every id already in use, so allocation can never reissue one.
    Runs once; `$setOnInsert` makes a concurrent second call a no-op."""
    if await counters_col.find_one({"_id": "bugs"}):
        return
    highest = 100
    async for doc in bugs_col.find({}, {"humanId": 1}):
        try:
            highest = max(highest, int(str(doc.get("humanId", "")).split("-")[1]))
        except (IndexError, ValueError):
            continue
    await counters_col.update_one({"_id": "bugs"}, {"$setOnInsert": {"seq": highest}}, upsert=True)


# DELIBERATELY UNAUTHENTICATED — do not add require_user here without changing the client first.
# Filing without an account is a first-class path: QA records a bug as a guest, and the dashboard
# has a whole guest branch for it (reporter ANONYMOUS, its own post-submit redirect). Locking this
# 401s the FIRST call of submitDraft, so the capture lands in the reporter's IndexedDB and nowhere
# else — the developer never sees it. That is exactly how BF-102..106 went missing. Scoped guest
# write-tokens are the fix; until then this and PUT below stay open. Delete stays locked.
@router.post("/api/bugs/allocate")
async def allocate_bug_id(
    body: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Issue the next bug number.

    Numbers used to be computed in the browser from whatever bugs that browser happened to hold,
    so a fresh profile started at BF-101 again and its PUT silently overwrote someone else's bug.
    `$inc` inside findOneAndUpdate is atomic in MongoDB, which makes concurrent filing safe.

    Passing `draftId` makes this idempotent: a retried or re-delivered filing gets back the id it
    already has instead of burning a new one.
    """
    draft_id = (body or {}).get("draftId")
    # Only a plain string may be matched: a dict here ({"$regex": ...}) would reach Mongo as an
    # operator and turn this lookup into a query oracle over other captures' draftIds.
    if not isinstance(draft_id, str):
        draft_id = None

    await _seed_counter()

    # No draft to key on — nothing to be idempotent about, so just take the next number.
    if not draft_id:
        doc = await counters_col.find_one_and_update(
            {"_id": "bugs"}, {"$inc": {"seq": 1}}, return_document=ReturnDocument.AFTER, upsert=True,
        )
        return {"humanId": f"BF-{doc['seq']}", "reused": False}

    # Bugs allocated before this reservation existed are keyed only by the row itself.
    existing = await bugs_col.find_one({"draftId": draft_id}, {"humanId": 1})
    if existing and existing.get("humanId"):
        return {"humanId": existing["humanId"], "reused": True}

    # ATOMIC, and it has to be. The previous shape was check-then-act — look for a bug carrying
    # this draftId, and allocate if absent — which cannot work, because the bug row is not written
    # until the client PUTs it, several network round trips later. Every caller inside that window
    # therefore saw nothing and burned a fresh number: eight concurrent allocations for one
    # recording returned BF-129 through BF-136, which is precisely the "one submission, several
    # jobs" report. No client-side guard could close it (the dashboard's was a React ref — per tab,
    # per page load, useless across two tabs or a reload), because the server was answering
    # honestly every time it was asked.
    #
    # So: take a number, then try to CLAIM it for this draftId. `$setOnInsert` with `upsert` is a
    # single atomic operation — the first caller's candidate is stored and handed back to everyone
    # who follows. Losers simply never use theirs, which leaves a gap in the sequence. Gaps are
    # free; a recording filed twice is not.
    doc = await counters_col.find_one_and_update(
        {"_id": "bugs"}, {"$inc": {"seq": 1}}, return_document=ReturnDocument.AFTER, upsert=True,
    )
    candidate = f"BF-{doc['seq']}"
    claim = await allocations_col.find_one_and_update(
        {"_id": draft_id},
        {"$setOnInsert": {"humanId": candidate, "at": now_ms()}},
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    won = claim["humanId"] == candidate
    return {"humanId": claim["humanId"], "reused": not won}


# DELIBERATELY UNAUTHENTICATED — see the note on allocate above. A guest who can allocate a number
# but cannot publish against it is worse than either alternative: the number is burned and the
# evidence still never arrives. The two travel together.
@router.put("/api/bugs/{human_id}")
async def publish_bug(
    human_id: str,
    bug: BugPayload,
) -> dict[str, Any]:
    """Dashboard upserts a bug snapshot so agents can read the whole thing.
    Idempotent — the client republishes on every mutation."""
    if bug.humanId != human_id:
        raise HTTPException(400, "humanId in body does not match URL")
    payload = bug.model_dump()
    incoming_draft = payload.get("draftId")
    prior = await bugs_col.find_one({"humanId": human_id}, {"draftId": 1})
    # Refuse to overwrite a different capture that happens to share this number. Client-side
    # numbering produced exactly that collision, and the loser vanished without a trace.
    if prior and incoming_draft and prior.get("draftId") and prior["draftId"] != incoming_draft:
        raise HTTPException(
            409,
            f"{human_id} already belongs to a different capture ({prior['draftId']}). "
            "Allocate a fresh id via POST /api/bugs/allocate.",
        )
    payload["_updatedAt"] = now_ms()
    # Stamp the reporter's teams onto the session, so a team can look at its own work.
    #
    # Derived here rather than asked of the client: the reporter does not choose a team per capture,
    # they belong to teams, and making it a field on the form would be one more thing to get wrong
    # while filing a bug. Resolved through the same fallback everything else uses, so an account
    # that still carries only the legacy free-text `team` string is stamped correctly too.
    #
    # Only on FIRST publish. The client republishes the whole snapshot on every mutation, and
    # re-deriving would silently move a session between teams whenever its reporter changed theirs.
    if not prior and not payload.get("teamIds"):
        reporter_id = (payload.get("reporter") or {}).get("id")
        if reporter_id:
            reporter = await db["users"].find_one({"id": reporter_id}, {"_id": 0, "teamIds": 1, "team": 1})
            payload["teamIds"] = await resolve_membership(reporter)
    try:
        await bugs_col.update_one({"humanId": human_id}, {"$set": payload}, upsert=True)
    except DocumentTooLarge:
        raise HTTPException(
            413,
            f"{human_id} exceeds MongoDB's 16MB document limit. Offload the heavy evidence "
            "(replay events, network bodies, screenshots) to file storage and publish the "
            "snapshot with references instead of inline payloads.",
        )
    # Only the first publish is news. The client republishes the whole snapshot on every mutation,
    # so announcing each one would turn "a session was filed" into a stream nobody reads.
    if not prior:
        await feed.record(
            "bug_filed",
            summary=f"{human_id} filed: {payload.get('title') or '(no title)'}",
            bug_human_id=human_id,
            initiative_id=payload.get("initiativeId"),
            actor_id=(payload.get("reporter") or {}).get("id"),
            actor_name=(payload.get("reporter") or {}).get("name"),
        )
    return {"ok": True, "humanId": human_id}


@router.get("/api/bugs/{human_id}")
async def get_bug(human_id: str) -> dict[str, Any]:
    """Full JSON of a bug — replay events, console, network, elements, comments.
    Used by the dashboard AND by agents that want the raw evidence."""
    doc = await load_bug(human_id)
    comments = await list_comments_for(human_id)
    doc["agentComments"] = [c.model_dump() for c in comments]
    return doc


@router.delete("/api/bugs/{human_id}")
async def delete_bug(
    human_id: str,
    _user: dict[str, Any] = Depends(require_user),
) -> dict[str, Any]:
    await bugs_col.delete_one({"humanId": human_id})
    await comments_col.delete_many({"bugHumanId": human_id})
    return {"ok": True}


# ------------------- evidence drills -------------------
# The summary quotes evidence in clipped form and cites these for the full record. Bodies are
# whatever the extension captured (JSON/text, secret-scrubbed, ~10KB caps) — the response that
# CONTAINS the bad data is usually a 200 the failed-calls view never shows.


@router.get("/api/bugs/{human_id}/network")
async def bug_network_index(human_id: str) -> dict[str, Any]:
    """Index of captured API calls (fetch/XHR) plus anything that failed, keyed by `i` for the
    per-entry drill. Resource-timing noise stays out unless it errored."""
    doc = await load_bug(human_id)
    net = doc.get("network") or []
    if not net:
        guard_offloaded(doc)
    entries = network_index(net)
    return {
        "humanId": human_id,
        "count": len(entries),
        "entry_url": f"/api/bugs/{human_id}/network/{{i}}",
        "entries": entries,
    }


@router.get("/api/bugs/{human_id}/network/{index}")
async def bug_network_entry(human_id: str, index: int) -> dict[str, Any]:
    """One stored network entry, verbatim — headers and request/response bodies included."""
    doc = await load_bug(human_id)
    net = doc.get("network") or []
    if not net:
        guard_offloaded(doc)
    if index < 0 or index >= len(net):
        raise HTTPException(404, f"network entry {index} out of range (0..{len(net) - 1})")
    return {"humanId": human_id, "i": index, "entry": net[index]}


@router.get("/api/bugs/{human_id}/console")
async def bug_console(
    human_id: str,
    level: str = Query("", description="Filter to one level (error, warn, info, log, debug)"),
    q: str = Query("", description="Case-insensitive substring filter on the text"),
    dedupe: bool = Query(True, description="Group identical lines with counts (stacks kept)"),
    limit: int = Query(80, ge=1, le=500),
) -> dict[str, Any]:
    """Console log with stacks — deduped by default so 108 copies of one React warning read as
    one group with a count instead of eating the whole budget."""
    doc = await load_bug(human_id)
    entries = doc.get("console") or []
    if not entries:
        guard_offloaded(doc)
    levels = {level} if level else {"log", "info", "warn", "error", "debug"}
    if dedupe:
        rows: list[dict[str, Any]] = dedupe_console(entries, levels)
    else:
        rows = [c for c in entries if str(c.get("level")) in levels]
    if q:
        needle = q.lower()
        rows = [r for r in rows if needle in str(r.get("text", "")).lower()]
    return {"humanId": human_id, "count": len(rows), "entries": rows[:limit]}


@router.get("/api/bugs/{human_id}/layout")
async def bug_layout(human_id: str) -> dict[str, Any]:
    """Layout-debugger evidence (slot table, overlap verdicts, measurement ledger tail) when the
    page under test exposed window.__layoutDebug at capture time."""
    doc = await load_bug(human_id)
    layout = doc.get("layoutDebug")
    if not layout:
        # layoutDebug is offloaded too, so "absent" may mean "in a file we couldn't reach".
        guard_offloaded(doc)
        raise HTTPException(404, f"bug {human_id} carries no layoutDebug evidence")
    return {"humanId": human_id, "layoutDebug": layout}


# ---------------- deep capture (schema 5) ----------------
#
# These four endpoints are the agent-facing half of the deep capture. Without them the evidence
# is stored but unreachable to anything that is not a human with the dashboard open — which
# defeats the point of capturing it. Each mirrors a tab in the inspector rail.


@router.get("/api/bugs/{human_id}/appstate")
async def bug_app_state(
    human_id: str,
    at: int | None = Query(None, description="ms offset; returns only changes at or before it"),
    source: str | None = Query(None, description="limit to one stateSources[].id"),
) -> dict[str, Any]:
    """Store baselines plus the ordered change log. `at` is the useful parameter: replaying the
    patches up to a moment reconstructs exactly what the app held when the bug happened, which is
    the question an agent actually has."""
    doc = await load_bug(human_id)
    sources = doc.get("stateSources") or []
    changes = doc.get("stateChanges") or []
    if not sources:
        guard_offloaded(doc)
        raise HTTPException(404, f"bug {human_id} carries no app state (capture schema < 5?)")
    if source:
        sources = [s for s in sources if s.get("id") == source]
        changes = [c for c in changes if c.get("sourceId") == source]
    if at is not None:
        changes = [c for c in changes if int(c.get("t", 0)) <= at]
    return {
        "humanId": human_id,
        "note": "Each change is an RFC 6902 patch against the previous state of its sourceId. "
        "Apply them in order onto stateSources[].baseline to rebuild state at any moment.",
        "stateSources": sources,
        "stateChanges": changes,
        "debugState": doc.get("debugState"),
    }


@router.get("/api/bugs/{human_id}/cookies")
async def bug_cookies(human_id: str, http_only: bool = Query(False)) -> dict[str, Any]:
    """Cookies at start and stop plus every change between. httpOnly ones are included and are
    usually the interesting ones — the page itself could never read them."""
    doc = await load_bug(human_id)
    at_stop = doc.get("cookiesAtStop") or doc.get("cookiesAtStart") or []
    if not at_stop:
        guard_offloaded(doc)
        raise HTTPException(404, f"bug {human_id} carries no cookies")
    at_start = doc.get("cookiesAtStart") or []
    if http_only:
        # Filter both snapshots, or the response is dominated by the very cookies it was asked
        # to exclude and the parameter looks broken.
        at_stop = [c for c in at_stop if c.get("httpOnly")]
        at_start = [c for c in at_start if c.get("httpOnly")]
    return {
        "humanId": human_id,
        "cookiesAtStart": at_start,
        "cookiesAtStop": at_stop,
        "cookieChanges": doc.get("cookieChanges") or [],
    }


@router.get("/api/bugs/{human_id}/browserlog")
async def bug_browser_log(human_id: str, level: str | None = Query(None)) -> dict[str, Any]:
    """CORS blocks, CSP violations, mixed content and deprecations. None of these reach console.*,
    so an agent reading only the console log will never see them — and they are frequently the
    whole explanation for a request that 'just failed'."""
    doc = await load_bug(human_id)
    entries = doc.get("browserLog") or []
    if not entries:
        guard_offloaded(doc)
        raise HTTPException(404, f"bug {human_id} carries no browser log")
    if level:
        entries = [e for e in entries if e.get("level") == level]
    return {"humanId": human_id, "browserLog": entries}


@router.get("/api/bugs/{human_id}/storage")
async def bug_storage(human_id: str) -> dict[str, Any]:
    """localStorage/sessionStorage at start and stop, the write log between them, and the
    IndexedDB / Cache Storage contents read at stop."""
    doc = await load_bug(human_id)
    payload = {
        "humanId": human_id,
        "storageAtStart": doc.get("storageAtStart"),
        "storageAtStop": doc.get("storageAtStop"),
        # Expanded, not raw: the extension compacts repeat writes to the same key into patches
        # against the write before them (an analytics SDK rewriting a 200KB blob per event is
        # otherwise most of a capture). An agent asking for storage wants the values, not the deltas.
        "storageChanges": expand_storage_changes(doc.get("storageChanges") or []),
        "indexedDb": doc.get("indexedDb"),
        "cacheStorage": doc.get("cacheStorage"),
    }
    if not any(payload[k] for k in ("storageAtStop", "storageAtStart", "storageChanges", "indexedDb", "cacheStorage")):
        guard_offloaded(doc)
        raise HTTPException(404, f"bug {human_id} carries no storage capture")
    return payload


# ------------------- the shared inbox -------------------
# Everything above is single-bug. These two routes are what make the dashboard a team tool rather
# than a private notebook: one list every account sees, and a field-level edit that records who
# changed what. Republishing a whole snapshot (PUT, above) stays for the capture itself.

HEAVY_FIELDS = [
    "network", "console", "replay", "rrweb", "stateSources", "stateChanges",
    "cookiesAtStart", "cookiesAtStop", "cookieChanges", "storageAtStart",
    "storageAtStop", "storageChanges", "indexedDb", "cacheStorage",
    "browserLog", "layoutDebug", "debugState",
]
# All-exclusion (plus _id), so a bug gains fields without this list needing to know about them.
LIGHT = {"_id": 0, **{f: 0 for f in HEAVY_FIELDS}}

# Everything a person can change after filing. Capture fields are absent on purpose: evidence is
# what was recorded, and nothing in the UI may rewrite it.
EDITABLE_FIELDS = {
    "title", "description", "status", "severity", "assignee",
    "tags", "initiative", "initiativeId", "category", "env", "jobId", "teamIds",
}


def _label(v: Any) -> str:
    """A field value as one short string for the history trail."""
    if v is None or v == "":
        return "\u2014"
    if isinstance(v, dict):
        return str(v.get("name") or v.get("title") or v.get("id") or "\u2014")
    if isinstance(v, list):
        return ", ".join(_label(x) for x in v) if v else "\u2014"
    return str(v)


def _describe(field: str, before: Any, after: Any) -> str:
    if field == "status":
        return f"status \u2192 {_label(after)}"
    if field == "severity":
        return f"severity \u2192 {_label(after)}"
    if field == "assignee":
        return f"assigned to {_label(after)}" if after else "unassigned"
    if field in ("initiative", "initiativeId"):
        return f"moved to {_label(after)}" if after else "removed from its initiative"
    if field == "tags":
        return f"tags \u2192 {_label(after)}"
    if field in ("title", "description"):
        return f"edited the {field}"
    return f"{field} \u2192 {_label(after)}"


@router.get("/api/bugs")
async def list_bugs(
    limit: int = Query(500, ge=1, le=2000),
    reporter: str | None = Query(None, description="Only sessions reported by this account id"),
    assignee: str | None = Query(None, description="Only sessions assigned to this account id"),
    status: str | None = Query(None),
    initiativeId: str | None = Query(None),
    teamId: str | None = Query(None, description="Only sessions belonging to this team"),
) -> list[dict[str, Any]]:
    """Every filed session, newest first, without the heavy evidence.

    The dashboard used to render only what its own IndexedDB held, so two people on two machines
    each saw a private subset of the same project and neither could act on the other's reports.
    This is the shared list; the evidence for one session still loads when it is opened.
    """
    q: dict[str, Any] = {}
    if reporter:
        q["reporter.id"] = reporter
    if assignee:
        q["assignee.id"] = assignee
    if status:
        q["status"] = status
    if initiativeId:
        q["initiativeId"] = initiativeId
    # Membership is a list: a session filed by someone in both Frontend and Retention belongs
    # to both, and a plain equality match would find it under neither.
    if teamId:
        q["teamIds"] = teamId
    return [doc async for doc in bugs_col.find(q, LIGHT).sort("createdAt", -1).limit(limit)]


@router.patch("/api/bugs/{human_id}")
async def patch_bug(
    human_id: str,
    patch: dict[str, Any],
    user: dict[str, Any] = Depends(require_user),
) -> dict[str, Any]:
    """Change fields on an already-filed session and record who changed what.

    Field-level on purpose. The only write the client had was PUT of the entire snapshot, so two
    people editing one session meant whoever saved second silently reverted the other. `$set` on
    named fields plus `$push` onto events leaves concurrent edits to different fields intact.
    """
    doc = await bugs_col.find_one({"humanId": human_id}, LIGHT)
    if not doc:
        raise HTTPException(404, f"bug {human_id} not found")
    unknown = set(patch) - EDITABLE_FIELDS
    if unknown:
        raise HTTPException(400, f"not editable: {', '.join(sorted(unknown))}")

    now = now_ms()
    actor = user.get("name") or user.get("email") or "Someone"
    events = [
        {
            "id": f"e-{uuid.uuid4().hex[:10]}",
            "actor": actor,
            "kind": {"status": "status", "assignee": "assigned"}.get(field, "edited"),
            "detail": _describe(field, doc.get(field), value),
            "at": now,
            "field": field,
            "from": _label(doc.get(field)),
            "to": _label(value),
        }
        for field, value in patch.items()
        if doc.get(field) != value
    ]
    if not events:
        return doc  # nothing actually changed; do not write a history entry for a no-op

    fresh = await bugs_col.find_one_and_update(
        {"humanId": human_id},
        {"$set": {**patch, "updatedAt": now, "_updatedAt": now}, "$push": {"events": {"$each": events}}},
        projection=LIGHT,
        return_document=ReturnDocument.AFTER,
    )
    for ev in events:
        kind = {"status": "status", "severity": "severity", "assignee": "assignment"}.get(ev["field"])
        if kind:
            await feed.record(
                kind,
                summary=f"{human_id}: {ev['detail']}",
                bug_human_id=human_id,
                initiative_id=(fresh or doc).get("initiativeId"),
                actor_id=user.get("id"),
                actor_name=actor,
            )
    return fresh or doc
