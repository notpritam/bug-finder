# ABOUTME: FastAPI backend for the bug-recording dashboard.
# ABOUTME: Exposes /api/ai/draft-fill — Claude Sonnet 4.5 parses a captured session
# ABOUTME: into a suggested title / description / severity / tags / assignee.
import json
import os
import re
import uuid
from typing import Any

from dotenv import load_dotenv
from emergentintegrations.llm.chat import LlmChat, UserMessage
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

load_dotenv()

EMERGENT_LLM_KEY = os.environ["EMERGENT_LLM_KEY"]

app = FastAPI(title="BugDash AI")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ------------------- schemas -------------------

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
    # If set, only fill this one field (used by per-field magic buttons).
    field: str | None = None
    # Current draft values so single-field fills can consider what the user already wrote.
    current: dict[str, Any] = Field(default_factory=dict)


class DraftFillResponse(BaseModel):
    title: str | None = None
    description: str | None = None
    severity: str | None = None  # low | medium | high | critical
    tags: list[str] = Field(default_factory=list)
    assigneeId: str | None = None
    assigneeReason: str | None = None
    initiative: str | None = None


# ------------------- prompt -------------------

SYSTEM_PROMPT = """You are an expert QA engineer that turns raw bug-recording evidence \
into a clean, filed bug report. You will be given evidence from a browser session capture: \
the reporter's rough notes, console errors, failed network calls, elements they picked, \
and the page URL. Return a JSON object that fills the bug form for them.

Rules:
- Title: one crisp line, imperative, <= 90 chars. No trailing period. Include the surface \
  ("Checkout: totals wrong when...") when the page context makes it clear.
- Description: structured markdown with three sections in this exact order:
    **Expected**\\n<one or two sentences>\\n\\n**Actual**\\n<one or two sentences>\\n\\n\
    **Steps to reproduce**\\n1. ...\\n2. ...\\n3. ...
  Use only what's supported by the evidence. Do not invent steps.
- Severity: one of low, medium, high, critical.
    * critical: data loss, cannot complete purchase/login, security issue.
    * high:     core flow broken, blocking most users.
    * medium:   annoying, workaround exists.
    * low:      cosmetic / minor.
- Tags: pick 1-4 from the provided allowedTags list (verbatim). Empty list if none fit.
- Assignee: pick the single team member (by id) whose role/team best matches the bug \
  domain — e.g. billing bug → payments engineer, UI bug → frontend engineer. Set \
  assigneeId to null if no one clearly fits. Give a very short reason (one clause).
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
    """Pack the evidence into a compact structured block for the model."""
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

    if req.field:
        parts.append(
            f"ONLY_FILL_FIELD: {req.field}. "
            + SINGLE_FIELD_INSTRUCTION.get(req.field, "")
        )
        if req.current:
            parts.append(f"CURRENT_DRAFT_VALUES: {json.dumps(req.current)[:2000]}")

    return "\n\n".join(parts)


def parse_json(text: str) -> dict[str, Any]:
    """Claude sometimes wraps JSON in ```json fences — strip and parse."""
    t = text.strip()
    if t.startswith("```"):
        t = re.sub(r"^```(?:json)?", "", t).strip()
        t = re.sub(r"```$", "", t).strip()
    # Fall back to the first {...} block if there's leading prose.
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
    except Exception as e:  # LLM upstream failure — surface as 502
        raise HTTPException(status_code=502, detail=f"LLM upstream: {e}") from e

    try:
        data = parse_json(raw)
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=502, detail=f"LLM returned non-JSON: {raw[:200]}") from e

    # Coerce tags to the allowed set (case-insensitive), keep order, dedupe.
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

    # Validate assignee id against team.
    team_ids = {m.id for m in req.team}
    assignee_id = data.get("assigneeId")
    if assignee_id not in team_ids:
        assignee_id = None

    initiative = data.get("initiative")
    if initiative and req.initiatives and initiative not in req.initiatives:
        # Only accept from the whitelist if provided.
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
