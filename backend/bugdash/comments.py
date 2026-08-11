# ABOUTME: Agent ↔ dashboard comment thread on a bug — agents POST, the dashboard polls GET.
# ABOUTME: list_comments_for is shared with the bug fetch + summary so every surface shows the same thread.
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query

from .auth import current_user
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
    exists = await bugs_col.find_one({"humanId": human_id}, {"_id": 1})
    if not exists:
        raise HTTPException(404, f"bug {human_id} not found — publish it first")
    now = now_ms()
    doc = {
        "id": f"ac-{uuid.uuid4().hex[:12]}",
        "bugHumanId": human_id,
        "actor": (user.get("name") if user else None) or msg.actor or "Agent",
        "kind": msg.kind or "comment",
        "body": msg.body.strip(),
        "at": now,
        "source": "dashboard" if user else "agent",
    }
    await comments_col.insert_one(doc)
    doc.pop("_id", None)
    return CommentOut(**doc)


@router.get("/api/bugs/{human_id}/comments", response_model=list[CommentOut])
async def list_comments(
    human_id: str, since: int = Query(0, description="Only return comments with at > since (epoch ms)")
) -> list[CommentOut]:
    return await list_comments_for(human_id, since_ms=since)
