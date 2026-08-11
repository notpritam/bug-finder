# ABOUTME: Initiatives — the larger efforts bugs group under; sessions join by shared tags.
# ABOUTME: Owner-gated edits; names unique among non-archived.
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from .auth import require_admin, require_user
from .core import initiatives_col, now_ms
from .models import InitiativeCreate, InitiativePatch, VALID_INITIATIVE_STATUS

router = APIRouter()


def _owner_of(user: dict[str, Any]) -> dict[str, Any]:
    """The acting account, in the shape stored on an initiative. Built from the token's user rather
    than from the request body: identity a caller can type is identity a caller can forge."""
    return {"id": user["id"], "name": user.get("name", ""), "email": user.get("email", "")}


def _norm_tags(tags: list[str]) -> list[str]:
    """Lowercase, de-duplicated, order preserved — matching must not hinge on capitalisation."""
    seen: list[str] = []
    for t in tags:
        clean = t.strip().lower()
        if clean and clean not in seen:
            seen.append(clean)
    return seen[:20]


def _clean_initiative(doc: dict[str, Any]) -> dict[str, Any]:
    doc.pop("_id", None)
    doc.pop("nameLower", None)
    return doc


@router.get("/api/initiatives")
async def list_initiatives() -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    async for doc in initiatives_col.find().sort("createdAt", -1).limit(200):
        out.append(_clean_initiative(doc))
    return out


@router.post("/api/initiatives", status_code=201)
async def create_initiative(
    req: InitiativeCreate,
    user: dict[str, Any] = Depends(require_user),
) -> dict[str, Any]:
    name = req.name.strip()
    if not name:
        raise HTTPException(400, "name is required")
    dup = await initiatives_col.find_one({"nameLower": name.lower(), "status": {"$ne": "archived"}})
    if dup:
        raise HTTPException(409, f'an initiative named "{name}" already exists')
    now = now_ms()
    doc = {
        "id": f"init-{uuid.uuid4().hex[:10]}",
        "name": name,
        "nameLower": name.lower(),
        "description": req.description.strip(),
        "team": (req.team or "").strip() or None,
        # NOT req.owner: whoever creates an initiative owns it, and the owner is the only account
        # allowed to edit it afterwards. Taking this from the body let a caller hand ownership —
        # and therefore edit rights — to any id they cared to type.
        "owner": _owner_of(user),
        "status": "in_qa",
        "tags": _norm_tags(req.tags),
        "createdAt": now,
        "updatedAt": now,
        "shippedAt": None,
    }
    await initiatives_col.insert_one(doc)
    return _clean_initiative(doc)


@router.patch("/api/initiatives/{initiative_id}")
async def update_initiative(
    initiative_id: str,
    patch: InitiativePatch,
    user: dict[str, Any] = Depends(require_user),
) -> dict[str, Any]:
    doc = await initiatives_col.find_one({"id": initiative_id})
    if not doc:
        raise HTTPException(404, f"initiative {initiative_id} not found")
    # The requester is the signed-in account, never a body field. `requesterId` used to arrive in
    # the payload and be compared against the stored owner id — so the owner check was passed by
    # sending the owner's id, which the GET /api/initiatives list hands out to anyone. It is no
    # longer part of InitiativePatch, so a client that still sends it has it dropped on parse.
    if user["id"] != (doc.get("owner") or {}).get("id"):
        raise HTTPException(403, "only the initiative owner can edit it")
    upd: dict[str, Any] = {"updatedAt": now_ms()}
    if patch.name is not None:
        name = patch.name.strip()
        if not name:
            raise HTTPException(400, "name cannot be empty")
        dup = await initiatives_col.find_one(
            {"nameLower": name.lower(), "status": {"$ne": "archived"}, "id": {"$ne": initiative_id}}
        )
        if dup:
            raise HTTPException(409, f'an initiative named "{name}" already exists')
        upd["name"] = name
        upd["nameLower"] = name.lower()
    if patch.description is not None:
        upd["description"] = patch.description.strip()
    if patch.team is not None:
        upd["team"] = patch.team.strip() or None
    if patch.owner is not None:
        upd["owner"] = patch.owner.model_dump()
    if patch.tags is not None:
        upd["tags"] = _norm_tags(patch.tags)
    if patch.status is not None:
        if patch.status not in VALID_INITIATIVE_STATUS:
            raise HTTPException(400, f"status must be one of {sorted(VALID_INITIATIVE_STATUS)}")
        upd["status"] = patch.status
        if patch.status == "shipped" and not doc.get("shippedAt"):
            upd["shippedAt"] = now_ms()
        if patch.status == "in_qa":
            upd["shippedAt"] = None
    await initiatives_col.update_one({"id": initiative_id}, {"$set": upd})
    fresh = await initiatives_col.find_one({"id": initiative_id})
    return _clean_initiative(fresh or {})


@router.delete("/api/initiatives/{initiative_id}")
async def delete_initiative(
    initiative_id: str,
    _admin: dict[str, Any] = Depends(require_admin),
) -> dict[str, Any]:
    """Admin-only, unlike the owner-gated edit: the rows that most need deleting are QA leftovers
    owned by accounts that were never real, so owner-gating would make them permanent."""
    doc = await initiatives_col.find_one({"id": initiative_id})
    if not doc:
        raise HTTPException(404, f"initiative {initiative_id} not found")
    await initiatives_col.delete_one({"id": initiative_id})
    return {"ok": True, "deleted": {"id": initiative_id, "name": doc.get("name")}}
