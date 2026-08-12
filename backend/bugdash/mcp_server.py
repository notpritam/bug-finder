# ABOUTME: The MCP endpoint agents connect to — one POST route speaking JSON-RPC, exposing the
# ABOUTME: capture as tools. Supports the 2026-07-28 era (stateless, header-routed, no handshake)
# ABOUTME: and the older initialize-based era, because installed clients span both.
import base64
import json
from typing import Any

from fastapi import APIRouter, Request, Response
from fastapi.responses import JSONResponse

from .auth import SECRET, ALGORITHM, users_col
from . import events
from .blocks import BLOCK_TYPES, blocks_to_text, normalize_blocks
from .bugs import LIGHT, load_bug
from .comments import list_comments_for
from .core import bugs_col, comments_col, now_ms
from .evidence_store import guard_offloaded
from .summary import build_summary_markdown

router = APIRouter()

from . import oauth  # noqa: E402  (imported after router to keep the module order readable)




# Newest first. A client's requested version is echoed back when we speak it.
SUPPORTED_VERSIONS = ["2026-07-28", "2025-11-25", "2025-06-18", "2025-03-26"]
LATEST = SUPPORTED_VERSIONS[0]
# The revision that dropped the handshake and began mirroring body fields into headers.
HEADER_ERA = "2026-07-28"

SERVER_INFO = {"name": "bug-finder", "title": "Bug Finder", "version": "1.0.0"}

# JSON-RPC + MCP error codes
PARSE_ERROR = -32700
INVALID_REQUEST = -32600
METHOD_NOT_FOUND = -32601
INVALID_PARAMS = -32602
INTERNAL_ERROR = -32603
HEADER_MISMATCH = -32020


def _err(rid: Any, code: int, message: str, data: Any = None) -> dict[str, Any]:
    e: dict[str, Any] = {"code": code, "message": message}
    if data is not None:
        e["data"] = data
    return {"jsonrpc": "2.0", "id": rid, "error": e}


def _ok(rid: Any, result: Any) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": rid, "result": result}


def _text(payload: Any) -> dict[str, Any]:
    """Every tool answers as one text block. Agents read JSON perfectly well, and a single
    predictable shape beats a different envelope per tool."""
    body = payload if isinstance(payload, str) else json.dumps(payload, indent=1, default=str)
    return {"content": [{"type": "text", "text": body}]}


def _decode_header(v: str | None) -> str | None:
    """Undo the Base64 sentinel the spec defines for values that are not header-safe."""
    if v is None:
        return None
    if v.startswith("=?base64?") and v.endswith("?="):
        try:
            return base64.b64decode(v[9:-2]).decode()
        except Exception:
            return v
    return v


# --------------------------------------------------------------------------- tools

TOOLS: list[dict[str, Any]] = [
    {
        "name": "list_sessions",
        "title": "List recorded sessions",
        "description": (
            "Every filed session, newest first, without the heavy evidence. Start here to find a "
            "bug id, then call get_session for the full picture."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "status": {"type": "string", "description": "open | in_progress | resolved | not_a_bug | wont_fix"},
                "initiativeId": {"type": "string"},
                "limit": {"type": "integer", "description": "Default 50, max 500"},
            },
        },
    },
    {
        "name": "get_session",
        "title": "Read a session",
        "description": (
            "The whole capture as a briefing: what was reported, the environment and app build, "
            "reporter flags, console errors, failed and successful network calls, picked elements "
            "with layout measurements, and the interaction trail. Read this before any drill tool."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {"humanId": {"type": "string", "description": "e.g. BF-116"}},
            "required": ["humanId"],
        },
    },
    {
        "name": "get_console",
        "title": "Console with stacks",
        "description": "Console entries with component stacks, deduplicated. Filter by level.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "humanId": {"type": "string"},
                "level": {"type": "string", "description": "error | warn | log"},
            },
            "required": ["humanId"],
        },
    },
    {
        "name": "get_network",
        "title": "Network index",
        "description": "Every request with method, url, status and timing. Use get_network_entry for bodies.",
        "inputSchema": {
            "type": "object",
            "properties": {"humanId": {"type": "string"}},
            "required": ["humanId"],
        },
    },
    {
        "name": "get_network_entry",
        "title": "One request with bodies",
        "description": (
            "A single request with its headers and request/response bodies. The response that "
            "CONTAINS the bad data is usually a 200 that the failed-calls list never shows."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "humanId": {"type": "string"},
                "index": {"type": "integer", "description": "The i value from get_network"},
            },
            "required": ["humanId", "index"],
        },
    },
    {
        "name": "get_dom_at",
        "title": "DOM at a moment",
        "description": (
            "Element state at any point in the recording, rebuilt from the replay. Compare two "
            "timestamps to see what changed. This is how you prove a control was disabled, a node "
            "was missing, or a box had the wrong height."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "humanId": {"type": "string"},
                "t": {"type": "integer", "description": "Milliseconds into the recording"},
                "selector": {"type": "string", "description": "CSS selector to narrow to"},
            },
            "required": ["humanId", "t"],
        },
    },
    {
        "name": "get_app_state",
        "title": "Application state",
        "description": (
            "Redux / TanStack Query / useState baselines plus RFC 6902 patches, rebuilt at any "
            "replay moment. Answers what the app believed at the time, not what the DOM showed."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "humanId": {"type": "string"},
                "at": {"type": "integer", "description": "Milliseconds into the recording"},
            },
            "required": ["humanId"],
        },
    },
    {
        "name": "get_cookies",
        "title": "Cookies including httpOnly",
        "description": (
            "Every cookie at stop, and what changed mid-recording. httpOnly cookies are invisible "
            "to page JavaScript, so this is the only record of them."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "humanId": {"type": "string"},
                "httpOnly": {"type": "boolean", "description": "Only httpOnly cookies"},
            },
            "required": ["humanId"],
        },
    },
    {
        "name": "get_browser_log",
        "title": "Browser-level log",
        "description": (
            "CORS blocks, CSP violations, mixed content, blocked resources and deprecations. These "
            "never reach console.* — if the console looks empty, look here."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "humanId": {"type": "string"},
                "level": {"type": "string", "description": "error | warning"},
            },
            "required": ["humanId"],
        },
    },
    {
        "name": "post_finding",
        "title": "Post a finding back",
        "description": (
            "Write your conclusion onto the session thread, where the reporter and the developer "
            "will read it. Use kind=fix_proposal when you are proposing a change.\n\n"
            "Send `blocks` to have the dashboard render the finding properly — a diagram of the "
            "failure path, the offending code with the bad lines marked, observed-vs-expected as a "
            "table, or a link straight to the network entry you are talking about. Prefer an "
            "`evidence` block over describing where you looked: it becomes a live link into the "
            "capture. `body` is optional when blocks are sent; it is derived for the surfaces that "
            "only read text. HTML is filtered to a safe subset, so scripts and event handlers are "
            "dropped rather than rejected — do not rely on them."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "humanId": {"type": "string"},
                "body": {"type": "string", "description": "Markdown. Optional when `blocks` is given."},
                "kind": {"type": "string", "description": "comment | status_suggestion | fix_proposal"},
                "blocks": {
                    "type": "array",
                    "description": "Structured finding, rendered in order.",
                    "items": {
                        "type": "object",
                        "properties": {
                            "type": {
                                "type": "string",
                                "enum": list(BLOCK_TYPES),
                                "description": (
                                    "markdown {md} · callout {level:info|warn|error|success,title?,md} · "
                                    "code {lang,src,highlight?:[lineNos],caption?} · "
                                    "diagram {lang:'mermaid',src,caption?} · "
                                    "table {columns:[],rows:[[]],caption?} · "
                                    "keyvalue {items:[{k,v,mono?}],caption?} · "
                                    "evidence {ref:{kind:network|console|dom|state|cookie|storage|marker,"
                                    "index?,t?,selector?},note?} · html {html}"
                                ),
                            },
                        },
                        "required": ["type"],
                    },
                },
            },
            "required": ["humanId"],
        },
    },
    {
        "name": "watch",
        "title": "Follow a session or an initiative",
        "description": (
            "Say what you want to hear about while you work. Follow an initiative and you learn "
            "when a new session is filed into it; follow a session and you learn when someone "
            "comments, changes its status, or attaches new evidence. Idempotent — call it as often "
            "as you like. Pass stop=true to stop following."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "initiativeId": {"type": "string"},
                "humanId": {"type": "string", "description": "A session id such as BF-121"},
                "stop": {"type": "boolean", "description": "Unfollow instead of follow"},
            },
        },
    },
    {
        "name": "get_updates",
        "title": "What changed while you were working",
        "description": (
            "Everything that happened on what you follow since you last asked — new comments, new "
            "sessions in an initiative, status and severity changes. Call it between steps on a "
            "long task: a human may have answered a question, filed a related session, or closed "
            "the one you are working on. Your own writes are never returned. Narrow with "
            "initiativeId or humanId to ask about one thing without receiving everything else."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "since": {"type": "integer", "description": "Epoch ms. Omit to continue from where you last read."},
                "initiativeId": {"type": "string"},
                "humanId": {"type": "string"},
            },
        },
    },
    {
        "name": "update_session",
        "title": "Change a session",
        "description": (
            "Set status, severity or tags. Capture evidence is never writable — it is the record "
            "of what happened."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "humanId": {"type": "string"},
                "status": {"type": "string"},
                "severity": {"type": "string"},
                "tags": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["humanId"],
        },
    },
]

_TOOL_NAMES = {t["name"] for t in TOOLS}


# --------------------------------------------------------------------------- auth

async def _agent_user(request: Request) -> dict[str, Any] | None:
    """The account behind the bearer token, and a note that its agent is alive.

    Tokens are the same signed JWTs the dashboard issues, so connecting an agent needs no new
    credential store — and revoking a person's access revokes their agent with it.
    """
    header = request.headers.get("authorization") or ""
    if not header.lower().startswith("bearer "):
        return None
    from jose import JWTError, jwt

    try:
        # verify_aud off here because the check below is the one that matters: python-jose would
        # reject any token carrying an `aud` it was not told to expect, including our own.
        payload = jwt.decode(header[7:].strip(), SECRET, algorithms=[ALGORITHM],
                             options={"verify_aud": False})
    except JWTError:
        return None
    # A refresh token is not an access token; without this check it would work as one and never
    # expire in any useful sense.
    if payload.get("typ") == "refresh":
        return None
    # RFC 8707 audience binding: a token minted for another resource must not be accepted here,
    # or this server becomes a way to spend tokens meant for somebody else. Dashboard-issued
    # tokens carry no `aud` at all and stay valid, so a hand-pasted token keeps working.
    aud = payload.get("aud")
    if aud is not None:
        allowed = {oauth.resource_uri(request), oauth._base(request), oauth._origin(request)}
        if not ({aud} & allowed if isinstance(aud, str) else set(aud) & allowed):
            return None
    user = await users_col.find_one({"id": payload.get("sub")}, {"_id": 0})
    if not user:
        return None
    # Last-seen is what the dashboard shows: who has actually wired an agent up, and when it last
    # did anything. Written on every call; cheap, and the alternative is guessing.
    client = request.headers.get("user-agent", "")[:120]
    await users_col.update_one(
        {"id": user["id"]},
        {"$set": {"agent": {"lastSeenAt": now_ms(), "client": client}}, "$inc": {"agentCalls": 1}},
    )
    return user


# --------------------------------------------------------------------------- tool bodies

async def _run_tool(name: str, args: dict[str, Any], user: dict[str, Any]) -> Any:
    hid = str(args.get("humanId", "")).strip()

    if name == "list_sessions":
        q: dict[str, Any] = {}
        if args.get("status"):
            q["status"] = args["status"]
        if args.get("initiativeId"):
            q["initiativeId"] = args["initiativeId"]
        limit = min(int(args.get("limit") or 50), 500)
        rows = []
        async for d in bugs_col.find(q, LIGHT).sort("createdAt", -1).limit(limit):
            rows.append(
                {
                    "humanId": d.get("humanId"),
                    "title": d.get("title"),
                    "status": d.get("status"),
                    "severity": d.get("severity"),
                    "env": d.get("env"),
                    "initiative": d.get("initiative"),
                    "reporter": (d.get("reporter") or {}).get("name"),
                    "assignee": (d.get("assignee") or {}).get("name"),
                    "createdAt": d.get("createdAt"),
                    "pageUrl": d.get("pageUrl"),
                }
            )
        return {"count": len(rows), "sessions": rows}

    if name == "get_session":
        doc = await load_bug(hid)
        # A briefing that renders complete and quiet because the evidence file was unreachable is
        # the most expensive way this can fail — an agent would reason from the silence.
        guard_offloaded(doc)
        return build_summary_markdown(doc, await list_comments_for(hid))

    doc = await load_bug(hid) if hid else None

    if name == "get_console":
        level = args.get("level")
        entries = [c for c in (doc.get("console") or []) if not level or c.get("level") == level]
        return {"count": len(entries), "entries": entries[:400]}

    if name == "get_network":
        out = []
        for i, e in enumerate(doc.get("network") or []):
            out.append({"i": i, "method": e.get("method"), "url": e.get("url"),
                        "status": e.get("status"), "durationMs": e.get("durationMs"), "t": e.get("t")})
        return {"count": len(out), "entries": out}

    if name == "get_network_entry":
        entries = doc.get("network") or []
        i = int(args.get("index", -1))
        if not 0 <= i < len(entries):
            raise ValueError(f"index {i} out of range (0..{len(entries) - 1})")
        return {"i": i, "entry": entries[i]}

    if name == "get_dom_at":
        from .domtime import bug_dom_at

        return await bug_dom_at(hid, int(args["t"]), args.get("selector") or "", "", 10, False)

    if name == "get_app_state":
        from .bugs import bug_app_state

        at = args.get("at")
        return await bug_app_state(hid, int(at) if at is not None else None, None)

    if name == "get_cookies":
        cookies = doc.get("cookiesAtStop") or []
        if args.get("httpOnly"):
            cookies = [c for c in cookies if c.get("httpOnly")]
        return {"count": len(cookies), "cookies": cookies[:500], "changes": (doc.get("cookieChanges") or [])[:200]}

    if name == "get_browser_log":
        level = args.get("level")
        entries = [e for e in (doc.get("browserLog") or []) if not level or e.get("level") == level]
        return {"count": len(entries), "entries": entries[:300]}

    if name == "post_finding":
        import uuid

        target = await bugs_col.find_one({"humanId": hid}, {"_id": 1, "initiativeId": 1})
        if not target:
            raise ValueError(f"bug {hid} not found")
        # normalize_blocks raises ValueError, which _run_tool's caller turns into an MCP error the
        # agent can read and correct — the whole reason the messages name the block index.
        blocks = normalize_blocks(args.get("blocks"))
        body = str(args.get("body") or "").strip() or blocks_to_text(blocks)
        if not body:
            raise ValueError("post_finding needs either `body` or `blocks`")
        doc2 = {
            "id": f"ac-{uuid.uuid4().hex[:12]}",
            "bugHumanId": hid,
            # Named from the token, never the request: an agent posts as the account that connected it.
            "actor": f"{user.get('name', 'Agent')} (agent)",
            "kind": args.get("kind") or "comment",
            "body": body,
            "at": now_ms(),
            "source": "agent",
            "blocks": blocks,
        }
        await comments_col.insert_one(dict(doc2))
        doc2.pop("_id", None)
        await events.record(
            "comment",
            summary=f"{doc2['actor']} posted a finding on {hid}: {body[:140]}",
            bug_human_id=hid,
            initiative_id=target.get("initiativeId"),
            actor_id=user["id"],
            actor_name=doc2["actor"],
        )
        return {"posted": True, "comment": doc2}

    if name == "watch":
        initiative, stop = args.get("initiativeId"), bool(args.get("stop"))
        if not initiative and not hid:
            raise ValueError("watch needs an initiativeId or a humanId")
        fn = events.unsubscribe if stop else events.subscribe
        following = await fn(user["id"], initiative_id=initiative, bug_human_id=hid or None)
        # A fresh follower starts from now, not from the beginning of the feed — otherwise the
        # first get_updates replays weeks of history as though it had all just happened.
        if not stop and not await events.cursor_for(user["id"]):
            await events.set_cursor(user["id"], now_ms())
        return {"following": following}

    if name == "get_updates":
        since = args.get("since")
        since_ms = int(since) if since is not None else await events.cursor_for(user["id"])
        rows = await events.updates_for(
            user["id"],
            since_ms=since_ms,
            initiative_id=args.get("initiativeId"),
            bug_human_id=hid or None,
        )
        # Advance only on an unfiltered read. Narrowing to one session and then marking everything
        # read is how the other updates get lost.
        if since is None and not args.get("initiativeId") and not hid:
            await events.set_cursor(user["id"], rows[-1]["at"] if rows else now_ms())
        return {"count": len(rows), "since": since_ms, "updates": rows}

    if name == "update_session":
        patch = {k: args[k] for k in ("status", "severity", "tags") if k in args}
        if not patch:
            raise ValueError("nothing to update")
        from .bugs import patch_bug

        return await patch_bug(hid, patch, user)

    raise ValueError(f"unknown tool: {name}")


# --------------------------------------------------------------------------- dispatch

async def _dispatch(msg: dict[str, Any], user: dict[str, Any], version: str) -> dict[str, Any] | None:
    rid = msg.get("id")
    method = msg.get("method")
    params = msg.get("params") or {}

    if method == "initialize":
        asked = (params.get("protocolVersion") or "").strip()
        return _ok(rid, {
            "protocolVersion": asked if asked in SUPPORTED_VERSIONS else LATEST,
            "capabilities": {"tools": {}},
            "serverInfo": SERVER_INFO,
            "instructions": (
                "Bug Finder holds recorded browser sessions. Call get_session first — it is a "
                "briefing, not a dump. Then drill: get_network_entry for a request's bodies, "
                "get_dom_at to prove what an element looked like at a moment, get_app_state for "
                "what the app believed, get_browser_log for failures that never reach the console. "
                "When you have a conclusion, post_finding puts it on the thread a human will read."
            ),
        })

    if method in ("notifications/initialized", "notifications/cancelled"):
        return None

    if method == "ping":
        return _ok(rid, {})

    if method == "tools/list":
        # ttlMs/cacheScope are honoured from 2026-07-28; harmless extras to older clients.
        return _ok(rid, {"tools": TOOLS, "ttlMs": 3_600_000, "cacheScope": "session"})

    if method == "tools/call":
        name = params.get("name")
        if name not in _TOOL_NAMES:
            return _err(rid, INVALID_PARAMS, f"unknown tool: {name}")
        try:
            result = await _run_tool(name, params.get("arguments") or {}, user)
            # The nudge. An agent that has to remember to poll will not; one told "3 updates"
            # while doing something else will. Only on dict results, and never on get_updates
            # itself, which has just answered the question.
            if isinstance(result, dict) and name != "get_updates":
                waiting = await events.waiting_for(user.get("id"))
                if waiting:
                    result = {**result, "updatesWaiting": waiting,
                              "updatesHint": "call get_updates to see what changed"}
            return _ok(rid, _text(result))
        except Exception as exc:  # a failed tool is a result, not a transport error
            return _ok(rid, {**_text(f"{type(exc).__name__}: {exc}"), "isError": True})

    return _err(rid, METHOD_NOT_FOUND, f"method not found: {method}")


@router.post("/mcp")
async def mcp_endpoint(request: Request) -> Response:
    origin = request.headers.get("origin")
    # DNS-rebinding guard. Browsers send Origin; agents generally do not, and an absent Origin is
    # explicitly allowed by the spec.
    if origin and not any(origin.startswith(p) for p in ("https://auto-fill-dashboard.", "http://localhost")):
        return JSONResponse(status_code=403, content=_err(None, INVALID_REQUEST, "origin not allowed"))

    user = await _agent_user(request)
    if not user:
        return JSONResponse(
            status_code=401,
            # The header is the whole point: a client that sees resource_metadata goes and
            # authorizes in a browser. Without it, it can only ask a human for a token.
            headers={"WWW-Authenticate": oauth.challenge_header(request)},
            content=_err(None, INVALID_REQUEST, "Not signed in. Authorize this agent in your browser, or pass a Bug Finder token."),
        )

    try:
        msg = await request.json()
    except Exception:
        return JSONResponse(status_code=400, content=_err(None, PARSE_ERROR, "invalid JSON"))
    if not isinstance(msg, dict):
        return JSONResponse(status_code=400, content=_err(None, INVALID_REQUEST, "batches are not supported"))

    # Versions before 2025-06-18 never sent the header; the spec allows reading that as 2025-03-26.
    version = request.headers.get("mcp-protocol-version") or "2025-03-26"
    if version not in SUPPORTED_VERSIONS:
        return JSONResponse(
            status_code=400,
            content=_err(msg.get("id"), INVALID_REQUEST,
                         f"unsupported protocol version: {version}",
                         {"supported": SUPPORTED_VERSIONS}),
        )

    method = msg.get("method")

    # From 2026-07-28 the routing headers are required and must agree with the body — a gateway
    # routing on the header while the server acts on the body is the vulnerability this closes.
    if version == HEADER_ERA:
        h_method = request.headers.get("mcp-method")
        if h_method != method:
            return JSONResponse(status_code=400, content=_err(
                msg.get("id"), HEADER_MISMATCH,
                f"Header mismatch: Mcp-Method '{h_method}' does not match body method '{method}'"))
        if method in ("tools/call", "resources/read", "prompts/get"):
            body_name = (msg.get("params") or {}).get("name") or (msg.get("params") or {}).get("uri")
            h_name = _decode_header(request.headers.get("mcp-name"))
            if h_name != body_name:
                return JSONResponse(status_code=400, content=_err(
                    msg.get("id"), HEADER_MISMATCH,
                    f"Header mismatch: Mcp-Name '{h_name}' does not match body value '{body_name}'"))

    reply = await _dispatch(msg, user, version)
    if reply is None:  # it was a notification
        return Response(status_code=202)
    if reply.get("error", {}).get("code") == METHOD_NOT_FOUND:
        # The spec asks for 404 here so a modern client can tell this from a legacy server's 404.
        return JSONResponse(status_code=404, content=reply)
    return JSONResponse(content=reply)


@router.get("/mcp")
@router.delete("/mcp")
async def mcp_legacy_transport() -> Response:
    """The GET stream and DELETE session teardown were removed in 2026-07-28."""
    return JSONResponse(status_code=405, content=_err(None, INVALID_REQUEST, "this endpoint accepts POST only"))
