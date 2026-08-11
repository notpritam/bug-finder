# ABOUTME: AI draft-fill — Claude refines the reporter's own words and fills gaps from evidence.
# ABOUTME: Reporter text is authoritative; evidence (console/net/picked/stacks) only sharpens it.
import json
import re
import uuid
from typing import Any

from emergentintegrations.llm.chat import LlmChat, UserMessage
from fastapi import APIRouter, Depends, HTTPException

from .auth import require_user
from .core import EMERGENT_LLM_KEY
from .models import DraftFillRequest, DraftFillResponse

router = APIRouter()

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
        lines: list[str] = []
        for c in req.consoleErrors[:20]:
            lines.append(f"[{c.level}] {c.text}")
            # The component stack is what names the owning surface — quote its head so the
            # model can say WHERE, not just WHAT.
            if c.stack:
                head = " | ".join(str(c.stack).splitlines()[:4])
                lines.append(f"    stack: {head}")
        parts.append("CONSOLE_ERRORS:\n" + "\n".join(lines))
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


@router.post("/api/ai/draft-fill", response_model=DraftFillResponse)
async def draft_fill(
    req: DraftFillRequest,
    _user: dict[str, Any] = Depends(require_user),
) -> DraftFillResponse:
    # Behind auth because it spends real money on every call: an open endpoint that forwards a
    # caller-supplied prompt to Claude on our key is a billing hole as much as a data one.
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
