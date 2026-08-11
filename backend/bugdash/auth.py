# ABOUTME: Real server-side accounts — register, sign in, and identify the caller. Replaces the
# ABOUTME: localStorage-only auth, where accounts existed per-browser, an unsalted SHA-256 hash
# ABOUTME: stood in for a password, and anyone could register as an admin email because nothing
# ABOUTME: server-side ever checked. Passwords are bcrypt hashed; sessions are signed JWTs.
import os
from datetime import datetime, timedelta, timezone
from typing import Any

import bcrypt
from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from pydantic import BaseModel, EmailStr, Field

from .core import db, now_ms

router = APIRouter()
users_col = db["users"]

# Fail closed: a missing AUTH_SECRET must stop the boot, not silently mint a per-process secret
# (which invalidated every session on each restart and would shatter tokens across workers).
SECRET = os.environ.get("AUTH_SECRET")
if not SECRET:
    raise RuntimeError("AUTH_SECRET must be set (see /app/backend/.env)")
ALGORITHM = "HS256"
TOKEN_TTL = timedelta(days=30)

# Admin is a per-account flag in Mongo so it can be granted and revoked from the Admin page
# without a redeploy. These two emails are the bootstrap only: they are admin even before the
# flag is written, which is what stops a fresh database from having nobody who can grant it.
BOOTSTRAP_ADMIN_EMAILS = {"pritam@emergent.sh", "ankit@emergent.sh"}

bearer = HTTPBearer(auto_error=False)


def is_admin_doc(doc: dict[str, Any] | None) -> bool:
    """Admin comes from the stored flag, or from the bootstrap allowlist for the founding pair."""
    if not doc:
        return False
    return bool(doc.get("isAdmin")) or doc.get("email", "") in BOOTSTRAP_ADMIN_EMAILS


class Credentials(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=200)


class RegisterInput(Credentials):
    name: str = Field(min_length=1, max_length=80)
    role: str = "Frontend Developer"
    team: str = "Platform"


class PublicUser(BaseModel):
    id: str
    name: str
    email: str
    role: str
    team: str
    isAdmin: bool


class Session(BaseModel):
    token: str
    user: PublicUser


def _public(doc: dict[str, Any]) -> PublicUser:
    return PublicUser(
        id=doc["id"],
        name=doc["name"],
        email=doc["email"],
        role=doc.get("role", ""),
        team=doc.get("team", ""),
        isAdmin=is_admin_doc(doc),
    )


def _issue(doc: dict[str, Any]) -> str:
    payload = {"sub": doc["id"], "email": doc["email"], "exp": datetime.now(timezone.utc) + TOKEN_TTL}
    return jwt.encode(payload, SECRET, algorithm=ALGORITHM)


async def current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(bearer),
) -> dict[str, Any] | None:
    """The caller, or None. Optional by design: reading a bug stays open, and only the routes that
    genuinely need an identity depend on `require_user`."""
    if not creds:
        return None
    try:
        payload = jwt.decode(creds.credentials, SECRET, algorithms=[ALGORITHM])
    except JWTError:
        return None
    return await users_col.find_one({"id": payload.get("sub")}, {"_id": 0})


async def require_user(user: dict[str, Any] | None = Depends(current_user)) -> dict[str, Any]:
    if not user:
        raise HTTPException(401, "Sign in to do that.")
    return user


async def require_admin(user: dict[str, Any] = Depends(require_user)) -> dict[str, Any]:
    """Account management is admin-only, enforced here rather than by hiding buttons — the client
    can only decide what to draw, never what it is allowed to do."""
    if not is_admin_doc(user):
        raise HTTPException(403, "Admins only.")
    return user


@router.post("/api/auth/register", response_model=Session)
async def register(body: RegisterInput) -> Session:
    email = body.email.strip().lower()
    if await users_col.find_one({"email": email}):
        raise HTTPException(409, "An account with this email already exists — sign in instead.")
    doc = {
        "id": f"u-{now_ms():x}",
        "name": body.name.strip(),
        "email": email,
        "role": body.role,
        "team": body.team,
        # bcrypt, not SHA-256: the old hash was unsalted and instantly reversible from a rainbow
        # table for any password worth guessing.
        "passwordHash": bcrypt.hashpw(body.password.encode(), bcrypt.gensalt()).decode(),
        "isAdmin": email in BOOTSTRAP_ADMIN_EMAILS,
        "createdAt": now_ms(),
    }
    await users_col.insert_one(dict(doc))
    return Session(token=_issue(doc), user=_public(doc))


@router.post("/api/auth/login", response_model=Session)
async def login(body: Credentials) -> Session:
    doc = await users_col.find_one({"email": body.email.strip().lower()}, {"_id": 0})
    # One message for both cases, so this cannot be used to enumerate which emails have accounts.
    if not doc or not bcrypt.checkpw(body.password.encode(), doc.get("passwordHash", "").encode()):
        raise HTTPException(401, "Wrong email or password.")
    return Session(token=_issue(doc), user=_public(doc))


@router.get("/api/auth/me", response_model=PublicUser)
async def me(user: dict[str, Any] = Depends(require_user)) -> PublicUser:
    return _public(user)


@router.delete("/api/auth/me")
async def delete_own_account(user: dict[str, Any] = Depends(require_user)) -> dict[str, Any]:
    """Close your own account. Separate from the admin route because it needs no privilege: an
    account nobody can remove without finding an admin is an account that accumulates — which is how
    throwaway test logins ended up sitting in a real team's assignee list.

    A bootstrap admin cannot leave this way; losing the only account that can grant admin, by an
    unprivileged call, is not a recoverable mistake.
    """
    if user["email"] in BOOTSTRAP_ADMIN_EMAILS:
        raise HTTPException(400, "This account is an admin in code and cannot delete itself.")
    # Their reports stay — a session is a record of what happened. Work assigned to them must not
    # keep pointing at an account that no longer exists.
    await db["bugs"].update_many({"assignee.id": user["id"]}, {"$set": {"assignee": None}})
    await users_col.delete_one({"id": user["id"]})
    return {"ok": True, "deleted": {"id": user["id"], "email": user["email"]}}


@router.get("/api/auth/users", response_model=list[PublicUser])
async def list_users(_: dict[str, Any] = Depends(require_user)) -> list[PublicUser]:
    """Assignee options. Behind auth because it is a staff directory, however small."""
    return [_public(d) async for d in users_col.find({}, {"_id": 0}).sort("name", 1)]
