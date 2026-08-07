# ABOUTME: FastAPI backend for the bug-recording dashboard.
# ABOUTME: - POST /api/ai/draft-fill      → Claude Sonnet 4.5 auto-fills a captured draft.
# ABOUTME: - PUT/GET /api/bugs/{humanId}  → dashboard publishes bug snapshots; agents read them.
# ABOUTME: - GET /api/bugs/{humanId}/summary.md → markdown summary for agent MCP tools.
# ABOUTME: - POST/GET /api/bugs/{humanId}/comments → agent posts, dashboard polls.
import json
import os
import re
import uuid
from datetime import datetime, timezone
from typing import Any

from dotenv import load_dotenv
from emergentintegrations.llm.chat import LlmChat, UserMessage
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field

load_dotenv()

EMERGENT_LLM_KEY = os.environ["EMERGENT_LLM_KEY"]
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]

app = FastAPI(title="BugDash AI")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

_mongo = AsyncIOMotorClient(MONGO_URL)
db = _mongo[DB_NAME]
bugs_col = db["bugs"]
comments_col = db["bug_comments"]


# ------------------- schemas: AI draft-fill -------------------

class TeamMember(BaseModel):
    id: str
    name: str
    email: str
    role: str | None = None
    team: str | None = None


class ConsoleLine(BaseModel):
    level: str
    text: str


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


# ------------------- schemas: bugs / comments -------------------

class BugPayload(BaseModel):
    """The whole client-side bug row — we intentionally keep this permissive
    (extra: allow) so schema drift on the client never breaks publishing."""
    id: str
    humanId: str
    title: str

    model_config = {"extra": "allow"}


class AgentComment(BaseModel):
    body: str = Field(min_length=1, max_length=8000)
    actor: str = "Agent"
    kind: str = "comment"  # comment | status_suggestion | fix_proposal


class CommentOut(BaseModel):
    id: str
    bugHumanId: str
    actor: str
    kind: str
    body: str
    at: int
    source: str  # "agent" | "dashboard"


# ------------------- AI draft-fill (unchanged) -------------------

SYSTEM_PROMPT = """You are an expert QA engineer helping a reporter file a bug. \
Your job is to REFINE what the reporter has already typed and FILL IN what they haven't — \
not to invent a new report from scratch.

You will receive:
- REPORTER_NOTES and CURRENT_DRAFT_VALUES: this is the reporter's own intent and phrasing. \
  Treat it as authoritative. Never contradict it. Preserve their words, tone, and \
  specific details (product names, page names, numbers, error strings they mention).
- Captured evidence (console errors, failed network calls, picked elements, URL). \
  Use this only to sharpen, structure, and factually extend what the reporter has said.

If a field is missing in CURRENT_DRAFT_VALUES, generate a value for it based on the \
reporter's notes plus the evidence. If a field is present, either return the same \
string (verbatim) or a lightly polished version — never a rewrite that loses the \
reporter's key details.

Rules per field:
- Title: one crisp line, imperative, <= 90 chars, no trailing period. Reuse the \
  reporter's key nouns/verbs where possible.
- Description: structured markdown, exactly this order:
    **Expected**\\n<one or two sentences>\\n\\n**Actual**\\n<one or two sentences>\\n\\n\
    **Steps to reproduce**\\n1. ...\\n2. ...\\n3. ...
  Do not invent steps the evidence + reporter notes don't support.
- Severity: one of low, medium, high, critical.
    * critical: data loss, cannot complete purchase/login, security issue.
    * high:     core flow broken, blocking most users.
    * medium:   annoying, workaround exists.
    * low:      cosmetic / minor.
- Tags: pick 1-4 from the provided allowedTags list (verbatim). Empty list if none fit.
- Assignee: pick the single team member (by id) whose role/team best matches the bug \
  domain. Set assigneeId to null if no one clearly fits. Give a very short reason.
- Initiative: pick from the provided initiatives list if one obviously fits, else null.

Output ONLY a single JSON object with keys: title, description, severity, tags, \
assigneeId, assigneeReason, initiative. No prose before or after."""


SINGLE_FIELD_INSTRUCTION = {
    "title": "Return ONLY JSON {\"title\": \"...\"}. Follow the title rule above.",
    "description": "Return ONLY JSON {\"description\": \"...\"}. Follow the description rule above.",
    "severity": "Return ONLY JSON {\"severity\": \"...\"}. One of low/medium/high/critical.",
    "tags": "Return ONLY JSON {\"tags\": [\"...\"]}. 1-4 tags from allowedTags.",
    "assignee": "Return ONLY JSON {\"assigneeId\": \"...\", \"assigneeReason\": \"...\"}.",
    "initiative": "Return ONLY JSON {\"initiative\": \"...\"} or null.",
}


def build_evidence(req: DraftFillRequest) -> str:
    parts: list[str] = []
    parts.append(f"PAGE_URL: {req.pageUrl}")
    parts.append(f"PAGE_TITLE: {req.pageTitle}")
    parts.append(f"REPORTER_NOTES:\n{req.notes.strip() or '(none)'}")
    if req.consoleErrors:
        errs = "\n".join(f"[{c.level}] {c.text}" for c in req.consoleErrors[:20])
        parts.append(f"CONSOLE_ERRORS:\n{errs}")
    if req.networkErrors:
        nets = "\n".join(f"{n.method} {n.url} → {n.status}" for n in req.networkErrors[:20])
        parts.append(f"FAILED_NETWORK_CALLS:\n{nets}")
    if req.pickedElements:
        picks = "\n".join(
            f"<{p.tag}> {p.selector or ''} — {(p.text or '').strip()[:80]}"
            for p in req.pickedElements[:10]
        )
        parts.append(f"PICKED_ELEMENTS:\n{picks}")
    parts.append(f"ALLOWED_TAGS: {json.dumps(req.allowedTags)}")
    parts.append(f"INITIATIVES: {json.dumps(req.initiatives)}")
    team_lines = [
        f"- id={m.id} name={m.name} role={m.role or '?'} team={m.team or '?'}"
        for m in req.team
    ]
    parts.append("TEAM:\n" + ("\n".join(team_lines) if team_lines else "(none)"))
    parts.append(f"CURRENT_DRAFT_VALUES: {json.dumps(req.current)[:2000]}")
    if req.field:
        parts.append(
            f"ONLY_FILL_FIELD: {req.field}. "
            + SINGLE_FIELD_INSTRUCTION.get(req.field, "")
        )
    return "\n\n".join(parts)


def parse_json(text: str) -> dict[str, Any]:
    t = text.strip()
    if t.startswith("```"):
        t = re.sub(r"^```(?:json)?", "", t).strip()
        t = re.sub(r"```$", "", t).strip()
    if not t.startswith("{"):
        m = re.search(r"\{[\s\S]*\}", t)
        if m:
            t = m.group(0)
    return json.loads(t)


# ------------------- routes -------------------

@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/ai/draft-fill", response_model=DraftFillResponse)
async def draft_fill(req: DraftFillRequest) -> DraftFillResponse:
    chat = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=f"draft-fill-{uuid.uuid4()}",
        system_message=SYSTEM_PROMPT,
    ).with_model("anthropic", "claude-sonnet-4-5-20250929").with_params(max_tokens=1400)

    evidence = build_evidence(req)

    try:
        raw = await chat.send_message(UserMessage(text=evidence))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"LLM upstream: {e}") from e

    try:
        data = parse_json(raw)
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=502, detail=f"LLM returned non-JSON: {raw[:200]}") from e

    allowed_lc = {t.lower(): t for t in req.allowedTags}
    tags_out: list[str] = []
    seen: set[str] = set()
    for t in data.get("tags") or []:
        key = str(t).lower()
        canon = allowed_lc.get(key)
        if canon and canon not in seen:
            tags_out.append(canon)
            seen.add(canon)

    severity = data.get("severity")
    if severity not in {"low", "medium", "high", "critical", None}:
        severity = None

    team_ids = {m.id for m in req.team}
    assignee_id = data.get("assigneeId")
    if assignee_id not in team_ids:
        assignee_id = None

    initiative = data.get("initiative")
    if initiative and req.initiatives and initiative not in req.initiatives:
        initiative = None

    return DraftFillResponse(
        title=(data.get("title") or None),
        description=(data.get("description") or None),
        severity=severity,
        tags=tags_out,
        assigneeId=assignee_id,
        assigneeReason=(data.get("assigneeReason") or None),
        initiative=initiative,
    )


# ------------------- bugs (publish / fetch) -------------------

def _now_ms() -> int:
    return int(datetime.now(timezone.utc).timestamp() * 1000)


def _clean_bug_doc(doc: dict[str, Any]) -> dict[str, Any]:
    doc.pop("_id", None)
    return doc


@app.put("/api/bugs/{human_id}")
async def publish_bug(human_id: str, bug: BugPayload) -> dict[str, Any]:
    """Dashboard upserts a bug snapshot so agents can read the whole thing.
    Idempotent — the client republishes on every mutation."""
    if bug.humanId != human_id:
        raise HTTPException(400, "humanId in body does not match URL")
    payload = bug.model_dump()
    payload["_updatedAt"] = _now_ms()
    await bugs_col.update_one({"humanId": human_id}, {"$set": payload}, upsert=True)
    return {"ok": True, "humanId": human_id}


@app.get("/api/bugs/{human_id}")
async def get_bug(human_id: str) -> dict[str, Any]:
    """Full JSON of a bug — replay events, console, network, elements, comments.
    Used by the dashboard AND by agents that want the raw evidence."""
    doc = await bugs_col.find_one({"humanId": human_id})
    if not doc:
        raise HTTPException(404, f"bug {human_id} not found")
    _clean_bug_doc(doc)
    comments = await _list_comments(human_id)
    doc["agentComments"] = [c.model_dump() for c in comments]
    return doc


@app.delete("/api/bugs/{human_id}")
async def delete_bug(human_id: str) -> dict[str, Any]:
    await bugs_col.delete_one({"humanId": human_id})
    await comments_col.delete_many({"bugHumanId": human_id})
    return {"ok": True}


# ------------------- agent MCP-ish surface -------------------

def _fmt_offset(ms: int | float | None) -> str:
    if ms is None:
        return "?"
    ms = int(ms)
    s = ms // 1000
    return f"{s // 60}:{s % 60:02d}"


@app.get("/api/bugs/{human_id}/summary.md")
async def bug_summary_md(human_id: str) -> dict[str, str]:
    """A dense markdown briefing an agent can consume as one shot. This is the
    "MCP-friendly" view — everything needed to reason about the bug in one blob."""
    doc = await bugs_col.find_one({"humanId": human_id})
    if not doc:
        raise HTTPException(404, f"bug {human_id} not found")
    _clean_bug_doc(doc)

    lines: list[str] = []
    lines.append(f"# {doc.get('humanId')} — {doc.get('title','(no title)')}")
    lines.append("")
    lines.append(
        f"**Status:** {doc.get('status')} · **Severity:** {doc.get('severity')} · "
        f"**Env:** {doc.get('env','?')} · **Tags:** {', '.join(doc.get('tags') or []) or '—'}"
    )
    reporter = doc.get("reporter") or {}
    assignee = doc.get("assignee") or {}
    lines.append(
        f"**Reporter:** {reporter.get('name','?')} · **Assignee:** {assignee.get('name','unassigned')}"
    )
    lines.append(f"**Page:** {doc.get('pageUrl','')}")
    if doc.get("initiative"):
        lines.append(f"**Initiative:** {doc['initiative']}")
    if doc.get("jobId"):
        lines.append(f"**Job:** {doc['jobId']}")
    lines.append("")
    lines.append("## Description")
    lines.append(str(doc.get("description") or "(none)"))
    if doc.get("notes"):
        lines.append("")
        lines.append("## Reporter notes")
        lines.append(str(doc["notes"]))
    lines.append("")

    env = doc.get("environment") or {}
    if env:
        vp = env.get("viewport") or {}
        lines.append("## Environment")
        lines.append(
            f"- Browser: {env.get('browser','?')} on {env.get('os','?')}\n"
            f"- Viewport: {vp.get('w','?')}×{vp.get('h','?')} @{env.get('dpr','?')}x\n"
            f"- Language: {env.get('language','?')} · Timezone: {env.get('timezone','?')}\n"
            f"- Online: {env.get('online','?')}"
        )
        lines.append("")

    markers = doc.get("markers") or []
    if markers:
        lines.append("## Key moments (reporter flags)")
        for m in markers:
            lines.append(f"- `{_fmt_offset(m.get('t'))}` — {m.get('label') or '(no label)'} ({m.get('kind','user')})")
        lines.append("")

    console = doc.get("console") or []
    errors = [c for c in console if c.get("level") == "error"]
    if errors:
        lines.append("## Console errors")
        for c in errors[:25]:
            text = str(c.get("text",""))[:400]
            lines.append(f"- `{_fmt_offset(c.get('t'))}` {text}")
        lines.append("")

    net = doc.get("network") or []
    failed = [n for n in net if isinstance(n.get("status"), int) and n["status"] >= 400]
    if failed:
        lines.append("## Failed network calls")
        for n in failed[:25]:
            lines.append(
                f"- `{_fmt_offset(n.get('t'))}` {n.get('method','?')} {n.get('url','?')} → **{n.get('status')}** "
                f"({n.get('durationMs','?')}ms)"
            )
        lines.append("")

    picked = doc.get("pickedElements") or []
    if picked:
        lines.append("## Picked elements")
        for p in picked[:15]:
            lines.append(
                f"- `<{p.get('tag','?')}>` `{p.get('selector','')}` — {(p.get('text') or '').strip()[:120]}"
                + (f" · note: {p['note']}" if p.get("note") else "")
            )
        lines.append("")

    replay = doc.get("replay") or []
    clicks_navs = [e for e in replay if e.get("kind") in ("click", "nav", "input", "error")]
    if clicks_navs:
        lines.append("## Interaction trail")
        for e in clicks_navs[:30]:
            kind = e.get("kind")
            t = _fmt_offset(e.get("t"))
            if kind == "click":
                lines.append(f"- `{t}` CLICK {e.get('target') or '(unknown target)'}")
            elif kind == "nav":
                lines.append(f"- `{t}` NAV {e.get('url','')}")
            elif kind == "input":
                lines.append(f"- `{t}` INPUT {e.get('field','')} = {str(e.get('value',''))[:80]}")
            elif kind == "error":
                lines.append(f"- `{t}` ERROR {e.get('message','')}")
        lines.append("")

    events = doc.get("events") or []
    if events:
        lines.append("## History")
        for ev in sorted(events, key=lambda e: e.get("at", 0)):
            when = datetime.fromtimestamp((ev.get("at") or 0) / 1000, tz=timezone.utc).isoformat()
            lines.append(f"- {when} · **{ev.get('actor','?')}** {ev.get('detail','')}")
        lines.append("")

    comments = await _list_comments(human_id)
    if comments:
        lines.append("## Agent comments")
        for c in comments:
            when = datetime.fromtimestamp(c.at / 1000, tz=timezone.utc).isoformat()
            lines.append(f"- {when} · **{c.actor}** ({c.kind}): {c.body}")
        lines.append("")

    return {"humanId": human_id, "markdown": "\n".join(lines)}


# ------------------- comments (agent chat) -------------------

async def _list_comments(human_id: str, since_ms: int = 0) -> list[CommentOut]:
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


@app.post("/api/bugs/{human_id}/comments", response_model=CommentOut)
async def post_agent_comment(human_id: str, msg: AgentComment) -> CommentOut:
    """The endpoint an external agent posts to. The dashboard polls
    GET /comments and merges new ones into the bug's history."""
    exists = await bugs_col.find_one({"humanId": human_id}, {"_id": 1})
    if not exists:
        raise HTTPException(404, f"bug {human_id} not found — publish it first")
    now = _now_ms()
    doc = {
        "id": f"ac-{uuid.uuid4().hex[:12]}",
        "bugHumanId": human_id,
        "actor": msg.actor or "Agent",
        "kind": msg.kind or "comment",
        "body": msg.body.strip(),
        "at": now,
        "source": "agent",
    }
    await comments_col.insert_one(doc)
    doc.pop("_id", None)
    return CommentOut(**doc)


@app.get("/api/bugs/{human_id}/comments", response_model=list[CommentOut])
async def list_comments(
    human_id: str, since: int = Query(0, description="Only return comments with at > since (epoch ms)")
) -> list[CommentOut]:
    return await _list_comments(human_id, since_ms=since)


# ------------------- initiatives -------------------

initiatives_col = db["initiatives"]

VALID_INITIATIVE_STATUS = {"in_qa", "shipped", "archived"}


class InitiativeOwner(BaseModel):
    id: str
    name: str
    email: str = ""


class InitiativeCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    description: str = ""
    team: str | None = None
    owner: InitiativeOwner
    # Sessions carrying any of these tags belong to the initiative automatically — the reporter
    # never has to pick an initiative, they just tag what they captured.
    tags: list[str] = []


class InitiativePatch(BaseModel):
    requesterId: str
    name: str | None = Field(default=None, min_length=1, max_length=80)
    description: str | None = None
    team: str | None = None
    status: str | None = None
    owner: InitiativeOwner | None = None
    tags: list[str] | None = None


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


@app.get("/api/initiatives")
async def list_initiatives() -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    async for doc in initiatives_col.find().sort("createdAt", -1).limit(200):
        out.append(_clean_initiative(doc))
    return out


@app.post("/api/initiatives", status_code=201)
async def create_initiative(req: InitiativeCreate) -> dict[str, Any]:
    name = req.name.strip()
    if not name:
        raise HTTPException(400, "name is required")
    dup = await initiatives_col.find_one({"nameLower": name.lower(), "status": {"$ne": "archived"}})
    if dup:
        raise HTTPException(409, f'an initiative named "{name}" already exists')
    now = _now_ms()
    doc = {
        "id": f"init-{uuid.uuid4().hex[:10]}",
        "name": name,
        "nameLower": name.lower(),
        "description": req.description.strip(),
        "team": (req.team or "").strip() or None,
        "owner": req.owner.model_dump(),
        "status": "in_qa",
        "tags": _norm_tags(req.tags),
        "createdAt": now,
        "updatedAt": now,
        "shippedAt": None,
    }
    await initiatives_col.insert_one(doc)
    return _clean_initiative(doc)


@app.patch("/api/initiatives/{initiative_id}")
async def update_initiative(initiative_id: str, patch: InitiativePatch) -> dict[str, Any]:
    doc = await initiatives_col.find_one({"id": initiative_id})
    if not doc:
        raise HTTPException(404, f"initiative {initiative_id} not found")
    if patch.requesterId != (doc.get("owner") or {}).get("id"):
        raise HTTPException(403, "only the initiative owner can edit it")
    upd: dict[str, Any] = {"updatedAt": _now_ms()}
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
            upd["shippedAt"] = _now_ms()
        if patch.status == "in_qa":
            upd["shippedAt"] = None
    await initiatives_col.update_one({"id": initiative_id}, {"$set": upd})
    fresh = await initiatives_col.find_one({"id": initiative_id})
    return _clean_initiative(fresh or {})


# ------------------- MCP directory -------------------

@app.get("/api/mcp/bugs/{human_id}")
async def mcp_bug(human_id: str) -> dict[str, Any]:
    """A tiny "directory" describing what an MCP-style agent tool can do with
    this bug id — self-describing so an agent knows the URLs to call."""
    exists = await bugs_col.find_one({"humanId": human_id}, {"_id": 1, "title": 1})
    if not exists:
        raise HTTPException(404, f"bug {human_id} not found")
    return {
        "humanId": human_id,
        "title": exists.get("title"),
        "resources": {
            "full_json": f"/api/bugs/{human_id}",
            "markdown_summary": f"/api/bugs/{human_id}/summary.md",
            "comments": f"/api/bugs/{human_id}/comments",
            "post_comment": {
                "method": "POST",
                "url": f"/api/bugs/{human_id}/comments",
                "body": {"body": "string", "actor": "string (optional)", "kind": "comment|status_suggestion|fix_proposal"},
            },
        },
    }
