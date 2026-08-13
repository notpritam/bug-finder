# ABOUTME: Teams — Frontend, Retention, NDR, Growth. Until now `team` was a free-text string on an
# ABOUTME: account, which meant "Frontend", "frontend" and "Front-End" were three different teams and
# ABOUTME: none of them could be looked at. This makes a team a real thing people join, and gives
# ABOUTME: every session a team so a group can see its own work instead of the whole corpus.
# ABOUTME: The old string is kept and honoured — see `resolve_membership` — so nobody's existing
# ABOUTME: account has to be edited before any of this starts working for them.
import re
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pymongo import ReturnDocument

from .auth import current_user, is_admin_doc, require_user
from .core import bugs_col, db, now_ms
from .models import TeamCreate, TeamPatch

router = APIRouter()

teams_col = db["teams"]
users_col = db["users"]


def _slug(name: str) -> str:
    """A stable handle for a team, used to match the legacy free-text `team` string.

    Deliberately aggressive: "Front-End", "front end" and "Frontend " all reduce to `frontend`, and
    the whole reason teams are becoming an entity is that those were three separate teams before.
    """
    return re.sub(r"[^a-z0-9]+", "", name.lower())


def _public(doc: dict[str, Any], member_count: int | None = None) -> dict[str, Any]:
    out = {
        "id": doc["id"],
        "name": doc["name"],
        "slug": doc.get("slug") or _slug(doc["name"]),
        "description": doc.get("description", ""),
        "createdAt": doc.get("createdAt"),
        "createdBy": doc.get("createdBy"),
    }
    if member_count is not None:
        out["memberCount"] = member_count
    return out


async def resolve_membership(user: dict[str, Any] | None) -> list[str]:
    """Which teams this account belongs to.

    Reads `teamIds` when present and otherwise falls back to matching the legacy free-text `team`
    string by slug. That fallback is the entire migration: an account that has only ever had
    `team: "Platform"` starts seeing the Platform team's work the moment somebody creates a team
    called Platform, without an admin editing every account first.
    """
    if not user:
        return []
    ids = [t for t in (user.get("teamIds") or []) if isinstance(t, str)]
    if ids:
        return ids
    legacy = (user.get("team") or "").strip()
    if not legacy:
        return []
    match = await teams_col.find_one({"slug": _slug(legacy)}, {"id": 1})
    return [match["id"]] if match else []


@router.get("/api/teams")
async def list_teams(user: dict[str, Any] | None = Depends(current_user)) -> list[dict[str, Any]]:
    """Every team, so somebody can find the one they belong to and join it.

    Open to signed-out callers on purpose: the list is names of teams, and a guest reporter
    choosing who their capture belongs to is a flow worth keeping.
    """
    mine = set(await resolve_membership(user))
    out = []
    async for doc in teams_col.find({}, {"_id": 0}).sort("name", 1):
        count = await users_col.count_documents({"teamIds": doc["id"]})
        row = _public(doc, member_count=count)
        row["joined"] = doc["id"] in mine
        out.append(row)
    return out


@router.post("/api/teams")
async def create_team(
    body: TeamCreate,
    user: dict[str, Any] = Depends(require_user),
) -> dict[str, Any]:
    """Create a team and join it in the same call.

    Creating a team you are not in is nearly always a mistake — you are setting up your own group —
    and the alternative is an empty team nobody notices they have to join separately.
    """
    name = body.name.strip()
    slug = _slug(name)
    if not slug:
        raise HTTPException(400, "A team name needs at least one letter or number.")

    existing = await teams_col.find_one({"slug": slug}, {"_id": 0})
    if existing:
        # Not an error. Two people setting up "Retention" on the same afternoon should end up in
        # one team, not with a 409 and a second team called "Retention (2)".
        await _join(user["id"], existing["id"])
        return {**_public(existing), "joined": True, "alreadyExisted": True}

    doc = {
        "id": f"tm-{uuid.uuid4().hex[:10]}",
        "name": name,
        "slug": slug,
        "description": (body.description or "").strip(),
        "createdAt": now_ms(),
        "createdBy": {"id": user.get("id"), "name": user.get("name") or user.get("email")},
    }
    await teams_col.insert_one(dict(doc))
    await _join(user["id"], doc["id"])
    return {**_public(doc, member_count=1), "joined": True, "alreadyExisted": False}


async def _join(user_id: str, team_id: str) -> None:
    """`$addToSet`, so joining twice is a no-op rather than a duplicate membership."""
    await users_col.update_one({"id": user_id}, {"$addToSet": {"teamIds": team_id}})


@router.get("/api/teams/{team_id}")
async def get_team(team_id: str, user: dict[str, Any] | None = Depends(current_user)) -> dict[str, Any]:
    doc = await teams_col.find_one({"id": team_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, f"team {team_id} not found")
    members = [
        {"id": u["id"], "name": u.get("name", ""), "email": u.get("email", ""), "role": u.get("role", "")}
        async for u in users_col.find({"teamIds": team_id}, {"_id": 0, "id": 1, "name": 1, "email": 1, "role": 1})
    ]
    mine = set(await resolve_membership(user))
    return {**_public(doc, member_count=len(members)), "members": members, "joined": team_id in mine}


@router.post("/api/teams/{team_id}/join")
async def join_team(team_id: str, user: dict[str, Any] = Depends(require_user)) -> dict[str, Any]:
    if not await teams_col.find_one({"id": team_id}, {"id": 1}):
        raise HTTPException(404, f"team {team_id} not found")
    await _join(user["id"], team_id)
    return {"ok": True, "teamId": team_id}


@router.post("/api/teams/{team_id}/leave")
async def leave_team(team_id: str, user: dict[str, Any] = Depends(require_user)) -> dict[str, Any]:
    """Leaving is always allowed, including for the last member.

    A team nobody is in is not a problem — its sessions keep their teamId and it can be rejoined by
    name. Blocking the last member out of tidiness would strand somebody in a team they have left.
    """
    await users_col.update_one({"id": user["id"]}, {"$pull": {"teamIds": team_id}})
    return {"ok": True, "teamId": team_id}


@router.patch("/api/teams/{team_id}")
async def patch_team(
    team_id: str,
    body: TeamPatch,
    user: dict[str, Any] = Depends(require_user),
) -> dict[str, Any]:
    """Rename or redescribe. Members and admins only — a team's name is how everybody else finds
    it, so a passer-by must not be able to change it out from under them."""
    doc = await teams_col.find_one({"id": team_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, f"team {team_id} not found")
    if team_id not in await resolve_membership(user) and not is_admin_doc(user):
        raise HTTPException(403, "Join the team to edit it.")

    upd: dict[str, Any] = {}
    if body.name is not None:
        name = body.name.strip()
        slug = _slug(name)
        if not slug:
            raise HTTPException(400, "A team name needs at least one letter or number.")
        clash = await teams_col.find_one({"slug": slug, "id": {"$ne": team_id}}, {"id": 1})
        if clash:
            raise HTTPException(409, f"Another team is already called {name}.")
        upd["name"] = name
        upd["slug"] = slug
    if body.description is not None:
        upd["description"] = body.description.strip()
    if not upd:
        return _public(doc)

    fresh = await teams_col.find_one_and_update(
        {"id": team_id}, {"$set": upd}, projection={"_id": 0}, return_document=ReturnDocument.AFTER,
    )
    return _public(fresh or doc)


@router.get("/api/teams/{team_id}/sessions")
async def team_sessions(
    team_id: str,
    limit: int = Query(500, ge=1, le=2000),
) -> list[dict[str, Any]]:
    """This team's filed sessions, newest first.

    The point of the whole feature: a group that wants to look at its own work rather than every
    capture anybody has ever filed. Kept as its own route (rather than only a query parameter on
    the bug list) so it is the obvious thing to call and reads the same way from an agent.
    """
    from .bugs import LIGHT  # local: bugs.py owns the projection, and importing at module scope
                             # would make the two modules import each other.

    return [doc async for doc in bugs_col.find({"teamIds": team_id}, LIGHT).sort("createdAt", -1).limit(limit)]
