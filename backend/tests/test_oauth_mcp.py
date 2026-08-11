# End-to-end check of the browser authorization flow, run as a script rather than under pytest
# because it is one ordered story: register a client, walk the PKCE round trip, then spend the
# token on /mcp. Splitting it into independent test functions would mean re-walking the flow for
# every assertion.
#
# Point it at whatever you want to prove works:
#   python test_oauth_mcp.py                                    # the local backend
#   BF_BASE=https://host BF_MCP_BASE=https://host/api python ... # through the real ingress
#
# The two bases are separate because the ingress forwards only /api/* to this service, so the
# public MCP and OAuth routes carry that prefix while /api/auth/* is already absolute.
# Needs AUTH_SECRET in the environment for the foreign-audience case, which mints a token this
# server must refuse.
import base64, hashlib, json, os, re, secrets, sys, urllib.parse
import requests

B = os.environ.get("BF_BASE", "http://localhost:8001")
M = os.environ.get("BF_MCP_BASE", B)  # where /mcp, /oauth and /.well-known live
S = requests.Session()
S.headers["User-Agent"] = "oauth-e2e-test"
ok = lambda m: print("  OK  " + m)

# 0. a throwaway account to approve with
email = f"oauth-e2e-{secrets.token_hex(4)}@qa-pytest.emergent.sh"
pw = secrets.token_hex(12)
r = requests.post(f"{B}/api/auth/register", json={"name": "OAuth E2E", "email": email, "password": pw}, timeout=15)
assert r.status_code == 200, r.text
uid = r.json()["user"]["id"]
ok(f"test account {email}")

# 1. the 401 challenge
r = requests.post(f"{M}/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"}, timeout=15)
assert r.status_code == 401, r.status_code
wa = r.headers.get("WWW-Authenticate", "")
assert "resource_metadata=" in wa, f"no challenge header: {r.headers}"
ok(f"401 challenge: {wa}")

# 2. discovery
prm = requests.get(f"{M}/.well-known/oauth-protected-resource", timeout=15).json()
assert prm["resource"].endswith("/mcp"), prm
asm = requests.get(f"{M}/.well-known/oauth-authorization-server", timeout=15).json()
assert asm["code_challenge_methods_supported"] == ["S256"], asm
assert asm["authorization_response_iss_parameter_supported"] is True
ok(f"discovery: resource={prm['resource']} issuer={asm['issuer']}")
assert requests.get(f"{M}/.well-known/openid-configuration", timeout=15).status_code == 200
ok("openid-configuration alias serves too")

# 3. dynamic client registration
redirect = "http://localhost:57219/callback"
r = requests.post(asm["registration_endpoint"].replace("http://localhost", B.rsplit(":", 1)[0]) if False else f"{M}/oauth/register",
                  json={"client_name": "Claude Code", "redirect_uris": [redirect]}, timeout=15)
assert r.status_code == 201, r.text
cid = r.json()["client_id"]
ok(f"registered client {cid}")
r = requests.post(f"{M}/oauth/register", json={"client_name": "x", "redirect_uris": ["http://evil.example/cb"]}, timeout=15)
assert r.status_code == 400, "non-loopback http redirect should be refused"
ok("non-TLS, non-loopback redirect_uri refused")

# 4. authorize — PKCE
verifier = secrets.token_urlsafe(64)
challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
state = secrets.token_urlsafe(16)
resource = prm["resource"]
q = {"client_id": cid, "redirect_uri": redirect, "response_type": "code", "state": state,
     "code_challenge": challenge, "code_challenge_method": "S256",
     "scope": "sessions:read sessions:write", "resource": resource}
r = requests.get(f"{M}/oauth/authorize", params=q, timeout=15)
assert r.status_code == 200 and "Claude Code wants to connect" in r.text, r.status_code
ok("consent page renders with the client name")

r = requests.get(f"{M}/oauth/authorize", params={**q, "code_challenge_method": "plain"}, timeout=15)
assert r.status_code == 400, "plain PKCE must be refused"
ok("code_challenge_method=plain refused")
r = requests.get(f"{M}/oauth/authorize", params={**q, "redirect_uri": "https://evil.example/cb"}, timeout=15)
assert r.status_code == 400 and "evil.example" not in r.headers.get("location", ""), "open redirect!"
ok("unregistered redirect_uri refused without redirecting")

# 5. approve — wrong password first
form = {k: urllib.parse.quote(v, safe="") for k, v in q.items() if k != "response_type"}
r = requests.post(f"{M}/oauth/authorize", data={**form, "email": email, "password": "wrong"}, timeout=15)
assert r.status_code == 200 and "Wrong email or password" in r.text
ok("wrong password re-renders the form, no code issued")

r = requests.post(f"{M}/oauth/authorize", data={**form, "email": email, "password": pw},
                  allow_redirects=False, timeout=15)
assert r.status_code == 303, (r.status_code, r.text[:300])
loc = r.headers["location"]
parsed = urllib.parse.parse_qs(urllib.parse.urlparse(loc).query)
code = parsed["code"][0]
assert parsed["state"][0] == state, "state not echoed"
assert "iss" in parsed, "RFC 9207 iss missing"
assert parsed["iss"][0] == asm["issuer"], ("RFC 9207: iss must equal the advertised issuer",
                                              parsed["iss"][0], asm["issuer"])
ok(f"approved -> code, state echoed, iss matches issuer: {parsed['iss'][0]}")

# 6. token exchange
bad = requests.post(f"{M}/oauth/token", data={"grant_type": "authorization_code", "code": code,
     "redirect_uri": redirect, "client_id": cid, "code_verifier": "not-the-verifier"}, timeout=15)
assert bad.status_code == 400 and bad.json()["error"] == "invalid_grant", bad.text
ok("wrong PKCE verifier rejected")
# that consumed the code (single use) — so get a fresh one
r = requests.post(f"{M}/oauth/authorize", data={**form, "email": email, "password": pw},
                  allow_redirects=False, timeout=15)
code = urllib.parse.parse_qs(urllib.parse.urlparse(r.headers["location"]).query)["code"][0]

r = requests.post(f"{M}/oauth/token", data={"grant_type": "authorization_code", "code": code,
     "redirect_uri": redirect, "client_id": cid, "code_verifier": verifier, "resource": resource}, timeout=15)
assert r.status_code == 200, r.text
tok = r.json()
assert tok["token_type"] == "Bearer" and tok["access_token"] and tok["refresh_token"]
ok(f"token issued, expires_in={tok['expires_in']}s scope={tok['scope']!r}")

replay = requests.post(f"{M}/oauth/token", data={"grant_type": "authorization_code", "code": code,
     "redirect_uri": redirect, "client_id": cid, "code_verifier": verifier}, timeout=15)
assert replay.status_code == 400, "code replay must fail"
ok("authorization code is single-use")

# 7. the token actually works on /mcp
h = {"Authorization": f"Bearer {tok['access_token']}"}
r = requests.post(f"{M}/mcp", headers=h, json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"}, timeout=20)
assert r.status_code == 200, r.text[:400]
tools = r.json()["result"]["tools"]
ok(f"tools/list with the OAuth token -> {len(tools)} tools")

r = requests.post(f"{M}/mcp", headers=h, json={"jsonrpc": "2.0", "id": 2, "method": "tools/call",
    "params": {"name": "list_sessions", "arguments": {"limit": 2}}}, timeout=30)
assert r.status_code == 200 and not r.json().get("error"), r.text[:400]
ok("tools/call list_sessions works")

# 8. a refresh token must not pass as an access token
r = requests.post(f"{M}/mcp", headers={"Authorization": f"Bearer {tok['refresh_token']}"},
                  json={"jsonrpc": "2.0", "id": 3, "method": "tools/list"}, timeout=15)
assert r.status_code == 401, "refresh token accepted as access token!"
ok("refresh token refused as an access token")

# 9. refresh grant
r = requests.post(f"{M}/oauth/token", data={"grant_type": "refresh_token",
     "refresh_token": tok["refresh_token"], "client_id": cid}, timeout=15)
assert r.status_code == 200 and r.json()["access_token"], r.text
ok("refresh grant returns a new access token")

# 10. a token for a different audience must be refused
from jose import jwt
from datetime import datetime, timedelta, timezone
foreign = jwt.encode({"sub": uid, "aud": "https://somewhere-else.example/mcp",
                      "exp": datetime.now(timezone.utc) + timedelta(hours=1)},
                     os.environ["AUTH_SECRET"], algorithm="HS256")
r = requests.post(f"{M}/mcp", headers={"Authorization": f"Bearer {foreign}"},
                  json={"jsonrpc": "2.0", "id": 4, "method": "tools/list"}, timeout=15)
assert r.status_code == 401, "token minted for another resource was accepted!"
ok("token with a foreign audience refused (RFC 8707)")

# 11. legacy dashboard token (no aud) still works
r = requests.post(f"{B}/api/auth/login", json={"email": email, "password": pw}, timeout=15)
legacy = r.json()["token"]
r = requests.post(f"{M}/mcp", headers={"Authorization": f"Bearer {legacy}"},
                  json={"jsonrpc": "2.0", "id": 5, "method": "tools/list"}, timeout=15)
assert r.status_code == 200, "hand-pasted dashboard token stopped working"
ok("existing dashboard tokens still work")

# cleanup
requests.delete(f"{B}/api/auth/me", headers={"Authorization": f"Bearer {legacy}"}, timeout=15)
print("\nALL PASS")
