# ABOUTME: Agent ↔ dashboard comment thread on a bug — agents POST, the dashboard polls GET.
# ABOUTME: list_comments_for is shared with the bug fetch + summary so every surface shows the same thread.
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query

from .auth import current_user
from . import events
from .blocks import blocks_for_body, blocks_to_text, normalize_blocks
from .core import bugs_col, comments_col, now_ms
from .models import AgentComment, CommentOut

router = APIRouter()


async def list_comments_for(human_id: str, since_ms: int = 0) -> list[CommentOut]:
    cur = comments_col.find(
        {"bugHumanId": human_id, "at": {"$gt": since_ms}}
    ).sort("at", 1).limit(500)
    out: list[CommentOut] = []
    async for doc in cur:
        out.append(
            CommentOut(
                id=doc["id"],
                bugHumanId=doc["bugHumanId"],
                actor=doc.get("actor", "Agent"),
                kind=doc.get("kind", "comment"),
                body=doc.get("body", ""),
                at=int(doc.get("at", 0)),
                source=doc.get("source", "agent"),
                # Stored blocks were sanitised on the way in. A comment written before blocks
                # existed gets one synthesised from its body, which also means the markdown agents
                # have been posting all along finally renders instead of arriving as flat text.
                blocks=doc.get("blocks") or blocks_for_body(doc.get("body", "")),
            )
        )
    return out


@router.post("/api/bugs/{human_id}/comments", response_model=CommentOut)
async def post_agent_comment(
    human_id: str,
    msg: AgentComment,
    user: dict | None = Depends(current_user),
) -> CommentOut:
    """One thread, two kinds of author. Agents post unauthenticated and name themselves; a signed-in
    person is named from their token instead, so a teammate's comment cannot be posted under
    someone else's name by editing the request body."""
    # initiativeId comes back too, so the event this produces reaches people watching the
    # initiative and not only the ones watching this one session.
    exists = await bugs_col.find_one({"humanId": human_id}, {"_id": 1, "initiativeId": 1})
    if not exists:
        raise HTTPException(404, f"bug {human_id} not found — publish it first")
    try:
        blocks = normalize_blocks(msg.blocks)
    except ValueError as err:
        # The sender is usually an agent, and a rejected comment is one it can correct and retry —
        # so the reason travels back instead of a bare 422.
        raise HTTPException(400, str(err)) from err
    body = msg.body.strip() or blocks_to_text(blocks)
    if not body:
        raise HTTPException(400, "a comment needs either `body` or `blocks`")
    now = now_ms()
    doc = {
        "id": f"ac-{uuid.uuid4().hex[:12]}",
        "bugHumanId": human_id,
        "actor": (user.get("name") if user else None) or msg.actor or "Agent",
        "kind": msg.kind or "comment",
        "body": body,
        "at": now,
        "source": "dashboard" if user else "agent",
        "blocks": blocks,
    }
    await comments_col.insert_one(doc)
    doc.pop("_id", None)
    await events.record(
        "comment",
        summary=f"{doc['actor']} commented on {human_id}: {body[:140]}",
        bug_human_id=human_id,
        initiative_id=exists.get("initiativeId"),
        actor_id=(user or {}).get("id"),
        actor_name=doc["actor"],
    )
    # The reply renders the same way a later GET will, so a client that echoes its own post does
    # not briefly show something different from everyone else.
    return CommentOut(**{**doc, "blocks": blocks or blocks_for_body(body)})


@router.get("/api/bugs/{human_id}/comments", response_model=list[CommentOut])
async def list_comments(
    human_id: str, since: int = Query(0, description="Only return comments with at > since (epoch ms)"),
    user: dict[str, Any] = Depends(require_user),
) -> list[CommentOut]:
    return await list_comments_for(human_id, since_ms=since)
