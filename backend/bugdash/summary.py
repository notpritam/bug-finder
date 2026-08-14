# ABOUTME: The one-shot markdown briefing — everything an agent needs to reason about a bug in a
# ABOUTME: single read, with drill URLs cited wherever the full record was clipped for budget.
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlparse

from fastapi import Depends, APIRouter

from .auth import require_user
from .bugs import load_bug
from .capture_health import capture_health_lines
from .blocks import blocks_to_markdown
from .comments import list_comments_for
from .core import fmt_offset
from .evidence_store import guard_offloaded
from .evidence import (
    api_rollup,
    clip_text,
    console_md,
    dedupe_console,
    is_first_party,
    layout_lines,
    network_index,
    compare_lines,
    pick_delta_lines,
    pick_detail_lines,
    script_lines,
    site_of,
)
from .models import CommentOut

router = APIRouter()


def build_summary_markdown(doc: dict[str, Any], comments: list[CommentOut]) -> str:
    """Pure so the MCP endpoint and tests reuse it. Ordering is deliberate: identity → reporter
    intent → environment → the evidence that usually names the culprit (console groups with
    stacks, failed calls with bodies, API rollup, layout verdicts) → the interaction story."""
    human_id = doc.get("humanId", "?")
    lines: list[str] = []
    lines.append(f"# {human_id} — {doc.get('title', '(no title)')}")
    lines.append("")
    lines.append(
        f"**Status:** {doc.get('status')} · **Severity:** {doc.get('severity')} · "
        f"**Env:** {doc.get('env', '?')} · **Tags:** {', '.join(doc.get('tags') or []) or '—'}"
    )
    reporter = doc.get("reporter") or {}
    assignee = doc.get("assignee") or {}
    lines.append(
        f"**Reporter:** {reporter.get('name', '?')} · **Assignee:** {assignee.get('name', 'unassigned')}"
    )
    lines.append(f"**Page:** {doc.get('pageUrl', '')}")
    duration = doc.get("durationMs")
    created = doc.get("createdAt")
    if created:
        when = datetime.fromtimestamp(int(created) / 1000, tz=timezone.utc).isoformat()
        lines.append(f"**Captured:** {when} · **Recording:** {fmt_offset(duration)} long")
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
            f"- Browser: {env.get('browser', '?')} on {env.get('os', '?')}\n"
            f"- Viewport: {vp.get('w', '?')}×{vp.get('h', '?')} @{env.get('dpr', '?')}x\n"
            f"- Language: {env.get('language', '?')} · Timezone: {env.get('timezone', '?')}\n"
            f"- Online: {env.get('online', '?')}"
        )
        lines.append("")

    # Which BUILD the bug happened on — the page's own globals/meta, immune to stale
    # analytics-side version fields. `scripts` = the hashed chunk URLs that map a minified
    # stack to the exact deployed bundle.
    app_info = doc.get("appInfo")
    if not isinstance(app_info, dict) or not app_info:
        # Absent entirely = captured before build identity existed, or by a content script the
        # browser never reloaded. Either way the reader must not assume the newest build.
        lines.append("## App build (read off the page)")
        lines.append(
            "- ⚠ **Build identity not captured** — this report cannot say which build it happened on. "
            "Establish it before triaging: fetch the page, find its main chunk, grep `appVersion:`."
        )
        lines.append("")
    elif isinstance(app_info, dict) and app_info:
        lines.append("## App build (read off the page)")
        if app_info.get("status") == "unavailable":
            # Loud on purpose. An omitted section reads as "not applicable" and the reader moves
            # on; the honest reading is "establish the build before trusting anything below",
            # because a bug filed against an unknown build cannot be triaged at all. BF-108 cost
            # a 10MB bundle download to answer the question this line answers.
            lines.append(f"- ⚠ **Build identity unavailable** — {app_info.get('reason') or 'reason not recorded'}")
            lines.append("- Recover it: fetch the page, find its main chunk, grep `appVersion:` in the bundle")
        else:
            for key, value in app_info.items():
                if key == "scripts":
                    continue
                lines.append(f"- {key}: `{clip_text(str(value), 200)}`")
            lines.extend(script_lines(app_info.get("scripts"), human_id))
        lines.append("")
    if doc.get("debugState"):
        lines.append(f"App exposed a state snapshot (`window.__DEBUG_STATE__`) — read it: `/api/bugs/{human_id}/state`")
        lines.append("")

    markers = doc.get("markers") or []
    if markers:
        lines.append("## Key moments (reporter flags)")
        for m in markers:
            lines.append(f"- `{fmt_offset(m.get('t'))}` — {m.get('label') or '(no label)'} ({m.get('kind', 'user')})")
        lines.append("")

    console = doc.get("console") or []
    errors = dedupe_console(console, {"error"})
    if errors:
        lines.append("## Console errors (deduped)")
        lines.extend(console_md(errors, budget=12, stack_budget=3))
        lines.append("")
    warns = dedupe_console(console, {"warn"})
    if warns:
        lines.append("## Console warnings (deduped)")
        lines.extend(console_md(warns, budget=8, stack_budget=1))
        lines.append("")

    net = doc.get("network") or []
    failed_ix = [e for e in network_index(net) if isinstance(e.get("status"), int) and (e["status"] == 0 or e["status"] >= 400)]
    if failed_ix:
        # A third-party beacon at status 0 is an ad blocker doing its job, never the bug. Left
        # inline they push the real failure off the top of the section — BF-108 buried a 500 on
        # /precheck seventeen rows down behind ten Google/Bing/Amazon pixels.
        site = site_of(urlparse(doc.get("pageUrl") or "").hostname or "")
        own = [e for e in failed_ix if is_first_party(e.get("url") or "", site)]
        own_i = {e["i"] for e in own}
        blocked = [e for e in failed_ix if e["i"] not in own_i and e.get("status") == 0]
        other = [e for e in failed_ix if e["i"] not in own_i and e.get("status") != 0]
        lines.append("## Failed network calls")
        for e in (own + other)[:20]:
            lines.append(
                f"- `{fmt_offset(e.get('t'))}` {e.get('method', '?')} {e.get('url', '?')} → **{e.get('status')}** "
                f"({e.get('durationMs', '?')}ms) · full entry: `/api/bugs/{human_id}/network/{e['i']}`"
            )
            raw = net[e["i"]]
            if raw.get("requestBody"):
                lines.append(f"  - req: `{clip_text(raw['requestBody'], 300)}`")
            if raw.get("responseBody"):
                lines.append(f"  - res: `{clip_text(raw['responseBody'], 500)}`")
        if blocked:
            lines.append(f"- _({len(blocked)} third-party beacon(s) blocked at status 0 — ads/analytics, not listed)_")
        lines.append("")

    rollup = api_rollup(net)
    if rollup:
        lines.append("## API calls (every endpoint the page talked to)")
        lines.append(
            "The response that CONTAINS the bad data is usually a 200 — drill any row with "
            f"`/api/bugs/{human_id}/network/{{i}}` (bodies included)."
        )
        for r in rollup[:20]:
            statuses = "/".join(str(s) for s in r["statuses"]) or "?"
            drill = ", ".join(str(i) for i in r["indexes"])
            lines.append(
                f"- {r['method']} `{r['path']}` · ×{r['count']} · status {statuses} · worst {r['worstMs']}ms · i: {drill}"
            )
        lines.append("")

    # Deep capture (schema 5). Surfaced in the summary because a reader who does not know these
    # exist will never call the drill endpoints — and the security log in particular routinely
    # explains a failure that the console alone makes look like nothing happened.
    human_id_for_links = doc.get("humanId", "?")
    cdp = doc.get("cdp") or {}
    state_sources = doc.get("stateSources") or []
    cookies = doc.get("cookiesAtStop") or doc.get("cookiesAtStart") or []
    blog = doc.get("browserLog") or []
    if state_sources or cookies or blog or doc.get("harFileId"):
        lines.append("## Full browser capture")
        if state_sources:
            names = ", ".join(
                f"{s.get('kind')}{':' + s['label'] if s.get('label') else ''}" for s in state_sources[:6]
            )
            lines.append(
                f"- **App state:** {len(state_sources)} store(s) ({names}), "
                f"{len(doc.get('stateChanges') or [])} recorded changes — `/api/bugs/{human_id_for_links}/appstate?at=<ms>` "
                f"rebuilds state at any replay moment."
            )
        if cookies:
            http_only = sum(1 for c in cookies if c.get("httpOnly"))
            lines.append(
                f"- **Cookies:** {len(cookies)} at stop, {http_only} httpOnly — `/api/bugs/{human_id_for_links}/cookies`. "
                f"httpOnly cookies are invisible to the page, so this is the only record of them."
            )
        if blog:
            errs = sum(1 for e in blog if e.get("level") == "error")
            sec = sum(1 for e in blog if e.get("source") == "security")
            lines.append(
                f"- **Browser log:** {len(blog)} entries ({errs} error, {sec} security) — "
                f"`/api/bugs/{human_id_for_links}/browserlog`. CORS/CSP/mixed-content; never in console."
            )
            for e in [e for e in blog if e.get("level") == "error"][:3]:
                lines.append(f"  - {str(e.get('text', ''))[:200]}")
        if doc.get("storageChanges") or doc.get("storageAtStop"):
            lines.append(
                f"- **Storage:** {len(doc.get('storageChanges') or [])} writes — `/api/bugs/{human_id_for_links}/storage`."
            )
        if doc.get("harFileId"):
            lines.append(
                f"- **Network (HAR):** {doc.get('harEntryCount') or '?'} requests with wire headers and bodies — "
                f"file `{doc['harFileId']}`."
            )
        if cdp and not cdp.get("attached"):
            lines.append(
                f"- **⚠ Capture was degraded:** the debugger did not attach ({cdp.get('reason') or 'no reason given'}). "
                f"Thin evidence here means it was not collected, not that the page was quiet."
            )
        lines.append("")

    lines.extend(capture_health_lines(doc.get("diagnostics")))

    layout = doc.get("layoutDebug")
    layout_md = layout_lines(layout)
    if layout_md:
        lines.append("## Layout debugger (auto-attached from the page)")
        lines.extend(layout_md)
        lines.append("")

    picked = doc.get("pickedElements") or []
    if picked:
        lines.append("## Picked elements")
        for p in picked[:15]:
            lines.append(
                f"- `<{p.get('tag', '?')}>` `{p.get('selector', '')}` — {(p.get('text') or '').strip()[:120]}"
                + (f" · note: {p['note']}" if p.get("note") else "")
            )
            lines.extend(pick_detail_lines(p, env.get("viewport")))
        lines.extend(compare_lines(picked, env.get("viewport")))
        lines.extend(pick_delta_lines(picked, env.get("viewport")))
        lines.append("")

    replay = doc.get("replay") or []
    clicks_navs = [e for e in replay if e.get("kind") in ("click", "nav", "input", "error")]
    if clicks_navs:
        lines.append("## Interaction trail")
        for e in clicks_navs[:30]:
            kind = e.get("kind")
            t = fmt_offset(e.get("t"))
            if kind == "click":
                lines.append(f"- `{t}` CLICK {e.get('target') or '(unknown target)'}")
            elif kind == "nav":
                lines.append(f"- `{t}` NAV {e.get('url', '')}")
            elif kind == "input":
                lines.append(f"- `{t}` INPUT {e.get('field', '')} = {str(e.get('value', ''))[:80]}")
            elif kind == "error":
                lines.append(f"- `{t}` ERROR {e.get('message', '')}")
        lines.append("")

    events = doc.get("events") or []
    if events:
        lines.append("## History")
        for ev in sorted(events, key=lambda e: e.get("at", 0)):
            when = datetime.fromtimestamp((ev.get("at") or 0) / 1000, tz=timezone.utc).isoformat()
            lines.append(f"- {when} · **{ev.get('actor', '?')}** {ev.get('detail', '')}")
        lines.append("")

    if comments:
        lines.append("## Agent comments")
        for c in comments:
            when = datetime.fromtimestamp(c.at / 1000, tz=timezone.utc).isoformat()
            rich = [b for b in (c.blocks or []) if b.get("type") != "markdown"]
            if rich:
                # A structured comment is rebuilt as markdown rather than flattened: a table stays
                # a table and a diagram stays a diagram, so the agent reading this briefing sees
                # what the agent writing it drew.
                lines.append(f"- {when} · **{c.actor}** ({c.kind}):")
                lines.extend(f"  {ln}" for ln in blocks_to_markdown(c.blocks))
            else:
                lines.append(f"- {when} · **{c.actor}** ({c.kind}): {c.body}")
        lines.append("")

    lines.append("## Machine endpoints")
    lines.append(f"- Full JSON (replay, console, network, layout, everything): `/api/bugs/{human_id}`")
    lines.append(f"- Network index: `/api/bugs/{human_id}/network` · one entry with bodies: `/api/bugs/{human_id}/network/{{i}}`")
    lines.append(f"- Console with stacks (deduped): `/api/bugs/{human_id}/console?level=error`")
    lines.append(f"- Layout evidence: `/api/bugs/{human_id}/layout`")
    lines.append(
        f"- DOM time-travel: `/api/bugs/{human_id}/dom?t=<ms>&selector=<css>` — element state at any replay"
        " moment (use marker/console/network `t` values); `full=1` for the whole page HTML"
    )
    lines.append(f"- App state snapshot: `/api/bugs/{human_id}/state`")
    lines.append(f"- Post a finding back: `POST /api/bugs/{human_id}/comments`")

    return "\n".join(lines)


@router.get("/api/bugs/{human_id}/summary.md")
async def bug_summary_md(human_id: str, user: dict[str, Any] = Depends(require_user)) -> dict[str, str]:
    """A dense markdown briefing an agent can consume as one shot. This is the
    "MCP-friendly" view — everything needed to reason about the bug in one blob."""
    doc = await load_bug(human_id)
    # Nearly every section below reads an offloaded key (console, network, state, cookies,
    # storage, browser log, layoutDebug, debugState, replay). If the evidence file could not be
    # fetched this would render a briefing that looks complete and quiet, and an agent would
    # reason from it — the single most expensive way for this endpoint to fail. 502 instead.
    guard_offloaded(doc)
    comments = await list_comments_for(human_id)
    return {"humanId": human_id, "markdown": build_summary_markdown(doc, comments)}
