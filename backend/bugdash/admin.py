# ABOUTME: Account management for admins — the team roster, creating a teammate's account,
# ABOUTME: editing role/team, granting or revoking admin, and deleting an account. Every route
# ABOUTME: is behind require_admin, so hiding the UI is a convenience and never the control.
from typing import Any

import bcrypt
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr, Field

from .auth import BOOTSTRAP_ADMIN_EMAILS, is_admin_doc, require_admin, users_col
from .core import bugs_col, initiatives_col, now_ms, propagate_rename

router = APIRouter()


class AdminUser(BaseModel):
    id: str
    name: str
    email: str
    role: str
    team: str
    isAdmin: bool
    # True when admin comes from the bootstrap allowlist in code, which the UI cannot revoke.
    isBootstrapAdmin: bool
    createdAt: int | None = None
    assignedCount: int = 0
    reportedCount: int = 0


class CreateUserInput(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    email: EmailStr
    password: str = Field(min_length=8, max_length=200)
    role: str = "Frontend Developer"
    team: str = "Platform"
    isAdmin: bool = False


class PatchUserInput(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    role: str | None = None
    team: str | None = None
    isAdmin: bool | None = None


async def _decorate(doc: dict[str, Any]) -> AdminUser:
    uid = doc["id"]
    return AdminUser(
        id=uid,
        name=doc.get("name", ""),
        email=doc.get("email", ""),
        role=doc.get("role", ""),
        team=doc.get("team", ""),
        isAdmin=is_admin_doc(doc),
        isBootstrapAdmin=doc.get("email", "") in BOOTSTRAP_ADMIN_EMAILS,
        createdAt=doc.get("createdAt"),
        assignedCount=await bugs_col.count_documents({"assignee.id": uid}),
        reportedCount=await bugs_col.count_documents({"reporter.id": uid}),
    )


async def _admin_count() -> int:
    total = 0
    async for doc in users_col.find({}, {"_id": 0, "email": 1, "isAdmin": 1}):
        if is_admin_doc(doc):
            total += 1
    return total


@router.get("/api/admin/users", response_model=list[AdminUser])
async def list_all(_: dict[str, Any] = Depends(require_admin)) -> list[AdminUser]:
    return [await _decorate(d) async for d in users_col.find({}, {"_id": 0}).sort("createdAt", 1)]


@router.post("/api/admin/users", response_model=AdminUser, status_code=201)
async def create_user(
    body: CreateUserInput,
    _admin: dict[str, Any] = Depends(require_admin),
) -> AdminUser:
    """Create a teammate's account so they are assignable immediately, rather than waiting for
    them to find the dashboard and register themselves."""
    email = body.email.strip().lower()
    if await users_col.find_one({"email": email}):
        raise HTTPException(409, "An account with this email already exists.")
    doc = {
        "id": f"u-{now_ms():x}",
        "name": body.name.strip(),
        "email": email,
        "role": body.role,
        "team": body.team,
        "passwordHash": bcrypt.hashpw(body.password.encode(), bcrypt.gensalt()).decode(),
        "isAdmin": body.isAdmin,
        "createdAt": now_ms(),
    }
    await users_col.insert_one(dict(doc))
    return await _decorate(doc)


@router.patch("/api/admin/users/{user_id}", response_model=AdminUser)
async def patch_user(
    user_id: str,
    body: PatchUserInput,
    admin: dict[str, Any] = Depends(require_admin),
) -> AdminUser:
    doc = await users_col.find_one({"id": user_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "No such account.")
    upd: dict[str, Any] = {}
    if body.name is not None:
        upd["name"] = body.name.strip()
    if body.role is not None:
        upd["role"] = body.role
    if body.team is not None:
        upd["team"] = body.team
    if body.isAdmin is not None and body.isAdmin != is_admin_doc(doc):
        # Two ways to end up with nobody able to manage accounts, both closed here.
        if not body.isAdmin:
            if doc["email"] in BOOTSTRAP_ADMIN_EMAILS:
                raise HTTPException(400, "This account is an admin in code and cannot be demoted here.")
            if doc["id"] == admin["id"]:
                raise HTTPException(400, "You cannot remove your own admin access.")
            if await _admin_count() <= 1:
                raise HTTPException(400, "There has to be at least one admin.")
        upd["isAdmin"] = body.isAdmin
    if upd:
        await users_col.update_one({"id": user_id}, {"$set": upd})
        doc = await users_col.find_one({"id": user_id}, {"_id": 0}) or doc
    if "name" in upd:
        await propagate_rename(user_id, upd["name"])
    return await _decorate(doc)


@router.delete("/api/admin/users/{user_id}")
async def delete_user(
    user_id: str,
    admin: dict[str, Any] = Depends(require_admin),
) -> dict[str, Any]:
    doc = await users_col.find_one({"id": user_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "No such account.")
    if doc["id"] == admin["id"]:
        raise HTTPException(400, "You cannot delete your own account.")
    if is_admin_doc(doc) and await _admin_count() <= 1:
        raise HTTPException(400, "There has to be at least one admin.")
    # Their sessions stay — a bug report is a record of what happened, and the reporter is part of
    # it. What cannot stay is work assigned to an account that no longer exists, or an initiative
    # nobody can edit, so those move rather than vanish.
    unassigned = (await bugs_col.update_many({"assignee.id": user_id}, {"$set": {"assignee": None}})).modified_count
    owner = {"id": admin["id"], "name": admin.get("name", ""), "email": admin.get("email", "")}
    reowned = (await initiatives_col.update_many({"owner.id": user_id}, {"$set": {"owner": owner}})).modified_count
    await users_col.delete_one({"id": user_id})
    return {
        "ok": True,
        "deleted": {"id": doc["id"], "name": doc.get("name"), "email": doc.get("email")},
        "bugsUnassigned": unassigned,
        "initiativesReassigned": reowned,
    }
