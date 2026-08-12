# ABOUTME: Pydantic schemas for every router — AI draft-fill, bug snapshots, comments, initiatives.
# ABOUTME: BugPayload stays deliberately permissive (extra: allow): client schema drift must never break publishing.
from typing import Any

from pydantic import BaseModel, Field


# ------------------- AI draft-fill -------------------

class TeamMember(BaseModel):
    id: str
    name: str
    email: str
    role: str | None = None
    team: str | None = None


class ConsoleLine(BaseModel):
    level: str
    text: str
    # Component/call stack captured alongside React warnings and thrown errors — optional so
    # older extension builds keep working; the AI fill quotes its head when present.
    stack: str | None = None


class NetCall(BaseModel):
    method: str
    url: str
    status: int


class PickedEl(BaseModel):
    tag: str
    selector: str | None = None
    text: str | None = None


class DraftFillRequest(BaseModel):
    pageUrl: str = ""
    pageTitle: str = ""
    notes: str = ""
    consoleErrors: list[ConsoleLine] = Field(default_factory=list)
    networkErrors: list[NetCall] = Field(default_factory=list)
    pickedElements: list[PickedEl] = Field(default_factory=list)
    allowedTags: list[str] = Field(default_factory=list)
    initiatives: list[str] = Field(default_factory=list)
    team: list[TeamMember] = Field(default_factory=list)
    field: str | None = None
    current: dict[str, Any] = Field(default_factory=dict)


class DraftFillResponse(BaseModel):
    title: str | None = None
    description: str | None = None
    severity: str | None = None
    tags: list[str] = Field(default_factory=list)
    assigneeId: str | None = None
    assigneeReason: str | None = None
    initiative: str | None = None


# ------------------- bugs / comments -------------------

class BugPayload(BaseModel):
    """The whole client-side bug row — we intentionally keep this permissive
    (extra: allow) so schema drift on the client never breaks publishing."""
    id: str
    humanId: str
    title: str

    model_config = {"extra": "allow"}


class AgentComment(BaseModel):
    # Either half may carry the comment: `blocks` is the structured form, `body` the plain one.
    # Whichever is missing is derived from the other on write, so both are always stored.
    body: str = Field(default="", max_length=8000)
    actor: str = "Agent"
    kind: str = "comment"  # comment | status_suggestion | fix_proposal
    blocks: list[dict[str, Any]] | None = None


class CommentOut(BaseModel):
    id: str
    bugHumanId: str
    actor: str
    kind: str
    body: str
    at: int
    source: str  # "agent" | "dashboard"
    # Never absent — synthesised from `body` for comments stored before blocks existed, so the
    # dashboard has exactly one shape to render rather than a fallback path that rots.
    blocks: list[dict[str, Any]] = []


# ------------------- initiatives -------------------

VALID_INITIATIVE_STATUS = {"in_qa", "shipped", "archived"}


class InitiativeOwner(BaseModel):
    id: str
    name: str
    email: str = ""


class InitiativeCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    description: str = ""
    team: str | None = None
    # Deliberately absent: the owner is the authenticated caller, taken from the token. Clients
    # still send `owner` and pydantic drops it — accepting it would let anyone create an
    # initiative owned (and thus editable) by someone else.
    # Sessions carrying any of these tags belong to the initiative automatically — the reporter
    # never has to pick an initiative, they just tag what they captured.
    tags: list[str] = []


class InitiativePatch(BaseModel):
    # `requesterId` used to live here and was compared against the stored owner id. Removed, not
    # made optional: the server derives the requester from the bearer token. Pydantic ignores
    # unknown keys, so an older client still sending it is unaffected — the value is simply never
    # read again.
    name: str | None = Field(default=None, min_length=1, max_length=80)
    description: str | None = None
    team: str | None = None
    status: str | None = None
    owner: InitiativeOwner | None = None
    tags: list[str] | None = None
