# ABOUTME: OAuth 2.1 for the MCP endpoint, so connecting an agent is "approve in a browser" rather
# ABOUTME: than "paste a token". Discovery (RFC 9728 + 8414), dynamic client registration (7591),
# ABOUTME: PKCE-only authorization codes, and audience-bound tokens (8707).
import base64
import hashlib
import secrets
import time
import urllib.parse
from typing import Any

import bcrypt
from fastapi import APIRouter, Form, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse

from .auth import SECRET, ALGORITHM, users_col
from .core import db, now_ms

router = APIRouter()
clients_col = db["oauth_clients"]
codes_col = db["oauth_codes"]

# How long an authorization code lives. Short by design: it is exchanged within seconds of the
# redirect, and every extra second is a window for a leaked code to be replayed.
CODE_TTL_S = 120
TOKEN_TTL_S = 30 * 24 * 3600

SCOPES = ["sessions:read", "sessions:write"]


def _origin(request: Request) -> str:
    """The public origin of this server, from the proxy's headers when present.

    The canonical resource URI must match what the client typed, or the audience check rejects
    every token it issues. Behind a reverse proxy the raw request URL is the internal one.
    """
    proto = request.headers.get("x-forwarded-proto") or request.url.scheme
    host = request.headers.get("x-forwarded-host") or request.headers.get("host") or request.url.netloc
    return f"{proto}://{host}"


#: RFC 8414 does not append the issuer's path to /.well-known — it *inserts* the well-known segment
#: between host and path. So for issuer https://host/api a client fetches
#: https://host/.well-known/oauth-authorization-server/api, which is outside /api/ entirely. Those
#: paths are served too, and they must still describe the /api issuer or the metadata contradicts
#: the document that pointed at it.
_ISSUER_IS_API = (
    "/.well-known/oauth-authorization-server/api",
    "/.well-known/oauth-protected-resource/api",
    "/.well-known/openid-configuration/api",
    # RFC 9728 inserts the well-known segment before the *resource's* full path, so a client
    # configured at https://host/api/mcp asks for this one first. It answered 404, the client fell
    # back to the bare document at the root, and that described the other deployment — the error it
    # reported was a resource mismatch, which reads as a server misconfiguration rather than a
    # missing route.
    "/.well-known/oauth-protected-resource/api/mcp",
)


def _base(request: Request) -> str:
    """Public base URL these endpoints live under.

    The ingress in front of this service forwards only /api/* to the backend; everything else goes
    to the dashboard's static files. So the same routes are mounted twice, and which prefix a
    client actually reached us on decides every URL we hand back. Getting this wrong is invisible
    until a client follows one of them and lands on the SPA's index.html instead of JSON.
    """
    origin = _origin(request)
    path = request.url.path
    if path.startswith("/api/") or path in _ISSUER_IS_API:
        return f"{origin}/api"
    return origin


def resource_uri(request: Request) -> str:
    """Canonical URI of the MCP server — no trailing slash, per RFC 8707 guidance."""
    return f"{_base(request)}/mcp"


def challenge_header(request: Request) -> str:
    """The 401 challenge that starts the whole flow. Without resource_metadata a client has no way
    to discover where to authorize, and falls back to asking a human for a token."""
    return (
        f'Bearer resource_metadata="{_base(request)}/.well-known/oauth-protected-resource", '
        f'scope="{" ".join(SCOPES)}"'
    )


# --------------------------------------------------------------------------- discovery

@router.get("/.well-known/oauth-protected-resource")
@router.get("/.well-known/oauth-protected-resource/mcp")
@router.get("/.well-known/oauth-protected-resource/api")
@router.get("/.well-known/oauth-protected-resource/api/mcp")
async def protected_resource_metadata(request: Request) -> JSONResponse:
    """RFC 9728. The client reads this to learn which authorization server to talk to."""
    o = _base(request)
    return JSONResponse({
        "resource": f"{o}/mcp",
        "authorization_servers": [o],
        "scopes_supported": SCOPES,
        "bearer_methods_supported": ["header"],
        "resource_documentation": f"{_origin(request)}/",
    })


@router.get("/.well-known/oauth-authorization-server")
@router.get("/.well-known/oauth-authorization-server/mcp")
@router.get("/.well-known/oauth-authorization-server/api")
@router.get("/.well-known/openid-configuration")
@router.get("/.well-known/openid-configuration/api")
async def authorization_server_metadata(request: Request) -> JSONResponse:
    """RFC 8414. Served at the OpenID path too because clients try both in priority order."""
    o = _base(request)
    return JSONResponse({
        "issuer": o,
        "authorization_endpoint": f"{o}/oauth/authorize",
        "token_endpoint": f"{o}/oauth/token",
        "registration_endpoint": f"{o}/oauth/register",
        "scopes_supported": SCOPES,
        "response_types_supported": ["code"],
        "grant_types_supported": ["authorization_code", "refresh_token"],
        "token_endpoint_auth_methods_supported": ["none"],
        # PKCE only, and only S256: OAuth 2.1 drops the implicit grant and `plain` challenges.
        "code_challenge_methods_supported": ["S256"],
        # RFC 9207 — we return `iss` on the redirect, so say so.
        "authorization_response_iss_parameter_supported": True,
    })


# --------------------------------------------------------------------------- registration

@router.post("/oauth/register")
async def register_client(body: dict[str, Any]) -> JSONResponse:
    """RFC 7591. Deprecated in favour of Client ID Metadata Documents but still what most installed
    clients use, and a client that cannot register cannot connect at all."""
    redirects = body.get("redirect_uris") or []
    if not isinstance(redirects, list) or not redirects:
        return JSONResponse(status_code=400, content={"error": "invalid_redirect_uri",
                                                      "error_description": "redirect_uris is required"})
    for uri in redirects:
        # Loopback is how a desktop client receives the code; anything else must be TLS.
        if not (uri.startswith("https://") or uri.startswith("http://127.0.0.1")
                or uri.startswith("http://localhost")):
            return JSONResponse(status_code=400, content={
                "error": "invalid_redirect_uri",
                "error_description": f"redirect_uri must be https or loopback: {uri}"})
    doc = {
        "client_id": f"bf-{secrets.token_urlsafe(16)}",
        "client_name": str(body.get("client_name") or "MCP client")[:120],
        "redirect_uris": redirects[:10],
        "grant_types": body.get("grant_types") or ["authorization_code", "refresh_token"],
        "response_types": ["code"],
        # Public client: no secret. A CLI cannot keep one, and PKCE is what actually protects the
        # exchange.
        "token_endpoint_auth_method": "none",
        "created_at": now_ms(),
    }
    await clients_col.insert_one(dict(doc))
    doc.pop("_id", None)
    return JSONResponse(status_code=201, content={**doc, "client_id_issued_at": int(time.time())})


async def _client(client_id: str) -> dict[str, Any] | None:
    if not client_id:
        return None
    doc = await clients_col.find_one({"client_id": client_id}, {"_id": 0})
    if doc:
        return doc
    # Client ID Metadata Documents: an https URL used directly as the client_id. Accepted so newer
    # clients work; the redirect_uri is still checked against its origin below.
    if client_id.startswith("https://"):
        return {"client_id": client_id, "client_name": client_id, "redirect_uris": None}
    return None


def _redirect_ok(client: dict[str, Any], redirect_uri: str) -> bool:
    known = client.get("redirect_uris")
    if known:
        return redirect_uri in known
    # A URL client_id vouches for redirects under its own origin.
    cid = client["client_id"]
    return redirect_uri.startswith(cid.rsplit("/", 1)[0])


# --------------------------------------------------------------------------- authorize

_PAGE = """<!doctype html><meta charset=utf-8><title>Connect to Bug Finder</title>
<meta name=viewport content="width=device-width,initial-scale=1">
<style>
:root{--bg:#f7f8f9;--card:#fff;--ink:#0f1519;--muted:#6b7a84;--line:#dde3e6;--accent:#00727f}
@media(prefers-color-scheme:dark){:root{--bg:#0c1114;--card:#121a1e;--ink:#e9eef0;--muted:#8496a0;--line:#233036;--accent:#3fd0e0}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--ink);
font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;padding:24px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:30px;max-width:420px;width:100%}
h1{font-size:19px;margin:0 0 6px;letter-spacing:-.01em}
p{color:var(--muted);margin:0 0 18px;font-size:13.5px}
b{color:var(--ink)}
ul{margin:0 0 20px;padding-left:18px;color:var(--muted);font-size:13px}
li{margin-bottom:5px}
label{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin:0 0 5px}
input{width:100%;padding:9px 11px;border:1px solid var(--line);border-radius:8px;background:var(--bg);
color:var(--ink);font-size:14px;margin-bottom:13px}
input:focus{outline:2px solid var(--accent);outline-offset:1px}
button{width:100%;padding:10px;border:0;border-radius:8px;background:var(--accent);color:#fff;
font-size:14px;font-weight:600;cursor:pointer}
button:hover{opacity:.92}
.err{background:#fbe9ec;color:#a3273f;border-radius:8px;padding:9px 11px;font-size:13px;margin-bottom:14px}
@media(prefers-color-scheme:dark){.err{background:#351520;color:#f2879b}}
.foot{margin:16px 0 0;font-size:12px;text-align:center}
</style>
<div class=card>
<h1>__NAME__ wants to connect</h1>
<p>Sign in to Bug Finder to let it read your recorded sessions.</p>
<ul>
<li>Read sessions, console, network, DOM and app state</li>
<li>Post findings and change session status</li>
<li>It cannot alter captured evidence, or see your password</li>
</ul>
__ERROR__
<form method=post action="__ACTION__">
__HIDDEN__
<label for=email>Email</label><input id=email name=email type=email required autofocus autocomplete=username>
<label for=password>Password</label><input id=password name=password type=password required autocomplete=current-password>
<button type=submit>Sign in and approve</button>
</form>
<p class=foot>Approving grants access for 30 days.</p>
</div>"""


def _page(client_name: str, params: dict[str, str], error: str = "",
          action: str = "/oauth/authorize") -> HTMLResponse:
    hidden = "".join(
        f'<input type=hidden name="{k}" value="{urllib.parse.quote(v, safe="")}">' for k, v in params.items() if v
    )
    html = (_PAGE
            .replace("__NAME__", _esc(client_name))
            .replace("__ACTION__", action)
            .replace("__HIDDEN__", hidden)
            .replace("__ERROR__", f'<div class=err>{_esc(error)}</div>' if error else ""))
    return HTMLResponse(html)


def _esc(s: str) -> str:
    return (s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
             .replace('"', "&quot;").replace("'", "&#39;"))


def _bad(msg: str, desc: str) -> JSONResponse:
    return JSONResponse(status_code=400, content={"error": msg, "error_description": desc})


@router.get("/oauth/authorize")
async def authorize_form(request: Request) -> Any:
    q = dict(request.query_params)
    client = await _client(q.get("client_id", ""))
    if not client:
        return _bad("invalid_client", "unknown client_id")
    redirect_uri = q.get("redirect_uri", "")
    if not _redirect_ok(client, redirect_uri):
        # Never redirect to an unregistered URI, even to report the error — that is the open
        # redirector this check exists to prevent.
        return _bad("invalid_request", "redirect_uri does not match the registered value")
    if q.get("code_challenge_method") != "S256" or not q.get("code_challenge"):
        return _bad("invalid_request", "PKCE with S256 is required")
    return _page(client.get("client_name") or "An agent", {
        k: q.get(k, "") for k in
        ("client_id", "redirect_uri", "state", "code_challenge", "code_challenge_method", "scope", "resource")
    }, action=request.url.path)


@router.post("/oauth/authorize")
async def authorize_submit(
    request: Request,
    email: str = Form(...),
    password: str = Form(...),
    client_id: str = Form(...),
    redirect_uri: str = Form(...),
    code_challenge: str = Form(...),
    code_challenge_method: str = Form("S256"),
    state: str = Form(""),
    scope: str = Form(""),
    resource: str = Form(""),
) -> Any:
    unq = urllib.parse.unquote
    redirect_uri, state, scope, resource = unq(redirect_uri), unq(state), unq(scope), unq(resource)
    code_challenge, client_id = unq(code_challenge), unq(client_id)

    client = await _client(client_id)
    if not client or not _redirect_ok(client, redirect_uri):
        return _bad("invalid_request", "redirect_uri does not match the registered value")

    params = {"client_id": client_id, "redirect_uri": redirect_uri, "state": state,
              "code_challenge": code_challenge, "code_challenge_method": code_challenge_method,
              "scope": scope, "resource": resource}

    user = await users_col.find_one({"email": email.strip().lower()}, {"_id": 0})
    if not user or not bcrypt.checkpw(password.encode(), user.get("passwordHash", "").encode()):
        # One message for both cases, so this cannot enumerate which emails have accounts.
        return _page(client.get("client_name") or "An agent", params, "Wrong email or password.",
                     action=request.url.path)

    code = secrets.token_urlsafe(32)
    await codes_col.insert_one({
        "code": code,
        "client_id": client_id,
        "user_id": user["id"],
        "redirect_uri": redirect_uri,
        "code_challenge": code_challenge,
        "scope": scope or " ".join(SCOPES),
        # The audience the token will carry. Bound at authorization time so it cannot be widened
        # at the token endpoint.
        "resource": resource or resource_uri(request),
        "expires_at": time.time() + CODE_TTL_S,
    })
    # RFC 9207: `iss` must equal the issuer in our metadata by simple string comparison,
    # so it carries the same /api prefix. The bare origin looks right and fails validation.
    sep = "&" if "?" in redirect_uri else "?"
    out = f"{redirect_uri}{sep}code={urllib.parse.quote(code)}&iss={urllib.parse.quote(_base(request), safe='')}"
    if state:
        out += f"&state={urllib.parse.quote(state)}"
    return RedirectResponse(out, status_code=303)


# --------------------------------------------------------------------------- token

@router.post("/oauth/token")
async def token(
    request: Request,
    grant_type: str = Form(...),
    code: str = Form(""),
    redirect_uri: str = Form(""),
    client_id: str = Form(""),
    code_verifier: str = Form(""),
    refresh_token: str = Form(""),
    resource: str = Form(""),
) -> JSONResponse:
    from jose import JWTError, jwt

    if grant_type == "refresh_token":
        try:
            # Same reason as the resource server: python-jose rejects any token carrying an `aud`
            # unless it is told which one to expect, and a refresh token always carries one.
            payload = jwt.decode(refresh_token, SECRET, algorithms=[ALGORITHM],
                                 options={"verify_aud": False})
        except JWTError:
            return _bad("invalid_grant", "refresh token is not valid")
        if payload.get("typ") != "refresh":
            return _bad("invalid_grant", "not a refresh token")
        return _issue(payload["sub"], payload.get("aud", ""), payload.get("scope", ""))

    if grant_type != "authorization_code":
        return _bad("unsupported_grant_type", f"unsupported grant_type: {grant_type}")

    # Single use: delete on read, so a replayed code finds nothing.
    rec = await codes_col.find_one_and_delete({"code": code})
    if not rec:
        return _bad("invalid_grant", "authorization code is invalid or already used")
    if rec["expires_at"] < time.time():
        return _bad("invalid_grant", "authorization code has expired")
    if rec["client_id"] != client_id or rec["redirect_uri"] != redirect_uri:
        return _bad("invalid_grant", "code was issued to a different client or redirect_uri")

    # PKCE: the verifier must hash to the challenge recorded at authorization time.
    digest = hashlib.sha256(code_verifier.encode()).digest()
    expected = base64.urlsafe_b64encode(digest).decode().rstrip("=")
    if not secrets.compare_digest(expected, rec["code_challenge"]):
        return _bad("invalid_grant", "PKCE verification failed")

    return _issue(rec["user_id"], rec["resource"], rec["scope"])


def _issue(user_id: str, audience: str, scope: str) -> JSONResponse:
    from datetime import datetime, timedelta, timezone
    from jose import jwt

    now = datetime.now(timezone.utc)
    base = {"sub": user_id, "aud": audience, "scope": scope}
    access = jwt.encode({**base, "exp": now + timedelta(seconds=TOKEN_TTL_S)}, SECRET, algorithm=ALGORITHM)
    refresh = jwt.encode({**base, "typ": "refresh", "exp": now + timedelta(days=180)}, SECRET, algorithm=ALGORITHM)
    return JSONResponse({
        "access_token": access,
        "token_type": "Bearer",
        "expires_in": TOKEN_TTL_S,
        "refresh_token": refresh,
        "scope": scope,
    })
