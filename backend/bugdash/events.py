# ABOUTME: The change feed — what moved, who moved it, and who has said they care. One feed with
# ABOUTME: several readers rather than a notification system per audience: the dashboard bell, the
# ABOUTME: MCP get_updates tool an agent polls mid-task, and a Claude Code hook that injects the
# ABOUTME: same rows into a working agent's context. Adding a reader must never mean adding a
# ABOUTME: second definition of "something happened".
#
# Pull, not push. The newest MCP revision this server speaks (2026-07-28) is stateless and
# header-routed with no server-to-client channel at all, so any client on it polls no matter what
# is built here. Underneath, Mongo is a standalone — no change streams — and the API runs two
# replicas, so a push channel would be a server-side poll with a held-open connection per viewer
# stacked on top. Polling is what this actually is; saying so keeps the next person from looking
# for the push path and concluding it is broken.
from typing import Any

from .core import db, now_ms

events_col = db["bf_events"]
subs_col = db["bf_subscriptions"]

#: Only things worth interrupting someone for. A feed that reports every field write is a feed
#: people mute in a week, and a muted feed is worse than none — it looks like coverage.
EVENT_KINDS = (
    "comment",      # someone replied on a session
    "bug_filed",    # a new session landed in an initiative
    "status",       # open → in progress → resolved
    "severity",
    "assignment",
    "evidence",     # new capture data attached to a session that already existed
)

#: Events older than this are gone. The feed answers "what changed since I looked", not "what ever
#: happened" — the bugs and comments themselves are the record.
EVENT_TTL_DAYS = 30

_indexed = False


async def ensure_indexes() -> None:
    """An agent polling between every tool call turns an unindexed scan into a running cost, so the
    query shape is pinned here rather than left to whatever the collection acquires by accident."""
    global _indexed
    if _indexed:
        return
    await events_col.create_index([("at", -1)])
    await events_col.create_index([("initiativeId", 1), ("at", -1)])
    await events_col.create_index([("bugHumanId", 1), ("at", -1)])
    await events_col.create_index("createdAt", expireAfterSeconds=EVENT_TTL_DAYS * 86_400)
    await subs_col.create_index([("actorId", 1)])
    _indexed = True


async def record(
    kind: str,
    *,
    summary: str,
    bug_human_id: str | None = None,
    initiative_id: str | None = None,
    actor_id: str | None = None,
    actor_name: str | None = None,
) -> None:
    """Note that something happened. Never raises: a feed that can fail a write is a feed that can
    fail the write it was describing, and losing the notification is always better than losing the
    comment it was about."""
    if kind not in EVENT_KINDS:
        return
    try:
        await ensure_indexes()
        from datetime import datetime, timezone

        await events_col.insert_one(
            {
                "at": now_ms(),
                # A real BSON date, because the TTL index needs one; `at` stays epoch-ms so every
                # cursor in this codebase is the same kind of number.
                "createdAt": datetime.now(timezone.utc),
                "kind": kind,
                "summary": summary[:400],
                "bugHumanId": bug_human_id,
                "initiativeId": initiative_id,
                "actorId": actor_id,
                "actorName": actor_name,
            }
        )
    except Exception:
        pass


def visible_to(event: dict[str, Any], actor_id: str | None) -> bool:
    """Whether an actor should be told about an event.

    An actor is never told about its own writes. Without this an agent posts a finding, polls,
    sees "1 update", reads back its own comment, and has found a reason to keep going forever —
    the loop is not hypothetical, it is the default behaviour of anything that polls after acting.
    """
    return not (actor_id and event.get("actorId") == actor_id)


async def watched(actor_id: str) -> dict[str, list[str]]:
    """The initiatives and sessions this actor asked to hear about."""
    out: dict[str, list[str]] = {"initiatives": [], "sessions": []}
    async for s in subs_col.find({"actorId": actor_id}):
        if s.get("initiativeId"):
            out["initiatives"].append(s["initiativeId"])
        if s.get("bugHumanId"):
            out["sessions"].append(s["bugHumanId"])
    return out


async def subscribe(actor_id: str, *, initiative_id: str | None = None, bug_human_id: str | None = None) -> dict[str, Any]:
    """Record interest. Idempotent, so an agent re-subscribing on every run costs nothing."""
    await ensure_indexes()
    if not initiative_id and not bug_human_id:
        raise ValueError("subscribe needs an initiativeId or a humanId")
    key = {"actorId": actor_id, "initiativeId": initiative_id, "bugHumanId": bug_human_id}
    await subs_col.update_one(key, {"$set": {**key, "at": now_ms()}}, upsert=True)
    return await watched(actor_id)


async def unsubscribe(actor_id: str, *, initiative_id: str | None = None, bug_human_id: str | None = None) -> dict[str, Any]:
    # The read cursor lives in this collection too. Unfollowing everything must not also forget
    # where you had read up to, or the next poll replays the whole retained feed.
    q: dict[str, Any] = {"actorId": actor_id, "_cursor": {"$ne": True}}
    if initiative_id:
        q["initiativeId"] = initiative_id
    if bug_human_id:
        q["bugHumanId"] = bug_human_id
    await subs_col.delete_many(q)
    return await watched(actor_id)


async def updates_for(
    actor_id: str | None,
    *,
    since_ms: int = 0,
    initiative_id: str | None = None,
    bug_human_id: str | None = None,
    limit: int = 100,
) -> list[dict[str, Any]]:
    """What changed since `since_ms`, narrowed to what this actor cares about.

    An explicit initiativeId/humanId wins over the stored subscriptions — asking about one thing
    should not also deliver everything else you happen to be watching.
    """
    await ensure_indexes()
    q: dict[str, Any] = {"at": {"$gt": int(since_ms)}}

    if bug_human_id:
        q["bugHumanId"] = bug_human_id
    elif initiative_id:
        q["initiativeId"] = initiative_id
    elif actor_id:
        w = await watched(actor_id)
        if not w["initiatives"] and not w["sessions"]:
            # Watching nothing means watching nothing. Returning the whole feed here would look
            # like a working subscription and quietly firehose an agent that asked for one bug.
            return []
        q["$or"] = [
            {"initiativeId": {"$in": w["initiatives"]}},
            {"bugHumanId": {"$in": w["sessions"]}},
        ]

    out: list[dict[str, Any]] = []
    async for e in events_col.find(q).sort("at", -1).limit(min(int(limit), 500)):
        if not visible_to(e, actor_id):
            continue
        e.pop("_id", None)
        e.pop("createdAt", None)
        out.append(e)
    out.reverse()  # oldest first: the reader is catching up, not scrolling a timeline
    return out


async def latest_stamp() -> int:
    """The newest event's timestamp, for a caller that wants a cursor without the payload."""
    await ensure_indexes()
    async for e in events_col.find({}, {"at": 1}).sort("at", -1).limit(1):
        return int(e.get("at", 0))
    return 0


async def cursor_for(actor_id: str) -> int:
    """Where this actor has read up to. Server-side because the alternative is asking an agent to
    thread a timestamp through its own reasoning for the length of a task, which it will not do."""
    doc = await subs_col.find_one({"actorId": actor_id, "_cursor": True})
    return int((doc or {}).get("at", 0))


async def set_cursor(actor_id: str, at: int) -> None:
    await subs_col.update_one(
        {"actorId": actor_id, "_cursor": True},
        {"$set": {"actorId": actor_id, "_cursor": True, "at": int(at)}},
        upsert=True,
    )


async def waiting_for(actor_id: str | None) -> int:
    """How many updates are unread — cheap enough to ride along on unrelated tool replies, which is
    how an agent finds out there is news without having thought to ask. An agent that has to
    remember to poll will not; one that is told "3 updates" while doing something else will."""
    if not actor_id:
        return 0
    try:
        cursor = await cursor_for(actor_id)
        if not cursor:
            return 0
        return len(await updates_for(actor_id, since_ms=cursor, limit=50))
    except Exception:
        return 0  # the nudge is a courtesy; it must never break the tool it rode in on


# --------------------------------------------------------------------------- HTTP

from fastapi import APIRouter, Depends, Query  # noqa: E402

from .auth import current_user  # noqa: E402

router = APIRouter()


@router.get("/api/updates")
async def list_updates(
    since: int = Query(0, description="Epoch ms. Omit or 0 to continue from where you last read."),
    initiativeId: str | None = Query(None),
    humanId: str | None = Query(None),
    user: dict | None = Depends(current_user),
) -> dict:
    """What the dashboard bell polls.

    Polling and not SSE on purpose: Mongo here is a standalone, so change streams are unavailable,
    and the API runs on two replicas — a push channel would still be a server-side poll underneath,
    with a connection to keep alive per viewer on top. The honest version is cheaper and the
    latency difference is a second.
    """
    if not user:
        return {"count": 0, "updates": [], "since": since}
    actor = user["id"]
    since_ms = int(since) if since else await cursor_for(actor)
    rows = await updates_for(actor, since_ms=since_ms, initiative_id=initiativeId, bug_human_id=humanId)
    return {"count": len(rows), "since": since_ms, "updates": rows}


@router.post("/api/updates/read")
async def mark_read(at: int = Query(...), user: dict | None = Depends(current_user)) -> dict:
    """Explicit, because the bell going quiet should be something the reader did."""
    if user:
        await set_cursor(user["id"], at)
    return {"ok": True}


@router.get("/api/updates/following")
async def following(user: dict | None = Depends(current_user)) -> dict:
    """What this actor follows. Its own endpoint so a Follow button can render the right label on
    first paint instead of guessing and correcting itself."""
    if not user:
        return {"initiatives": [], "sessions": []}
    return await watched(user["id"])


@router.post("/api/updates/watch")
async def watch(
    initiativeId: str | None = Query(None),
    humanId: str | None = Query(None),
    stop: bool = Query(False),
    user: dict | None = Depends(current_user),
) -> dict:
    if not user:
        return {"following": {"initiatives": [], "sessions": []}}
    fn = unsubscribe if stop else subscribe
    return {"following": await fn(user["id"], initiative_id=initiativeId, bug_human_id=humanId)}
