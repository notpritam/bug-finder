# Backend tests for /api/initiatives CRUD + edge cases.
#
# Rewritten against the token contract. The previous version sent `requesterId` and `owner` in the
# request body, which is exactly what the API stopped accepting: the requester id was compared
# against the stored owner, and GET /api/initiatives hands every owner id to anyone, so sending the
# owner's id was all it took to edit their initiative. Identity now comes from the bearer token
# only. Every test here had been failing 401 since that change and nobody noticed, because a suite
# that fails wholesale reads the same as a suite nobody runs.
#
# It also cleans up after itself. It used to say "delete not exposed. Leave them." and leave them —
# which is how nineteen TEST_INIT_*/E2E_* rows owned by qa@test.com accumulated in a real database.
import os
import uuid

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL")
if not BASE_URL:
    # fall back to reading frontend/.env
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip()
BASE_URL = (BASE_URL or "").rstrip("/")

API = f"{BASE_URL}/api/initiatives"
TIMEOUT = 15


def _account(label: str) -> requests.Session:
    """A throwaway account with its token pre-attached.

    Registered per run rather than reused, so a test can never depend on state another run left
    behind, and so the accounts it makes are identifiable if one ever escapes cleanup.
    """
    # Not .test/.invalid/.example: the email validator rejects reserved TLDs outright, so a
    # throwaway address has to live under a real domain. Nothing is ever sent to it.
    email = f"pytest-{label}-{uuid.uuid4().hex[:10]}@qa-pytest.emergent.sh"
    password = uuid.uuid4().hex
    res = requests.post(
        f"{BASE_URL}/api/auth/register",
        json={"name": f"pytest {label}", "email": email, "password": password},
        timeout=TIMEOUT,
    )
    assert res.status_code == 200, f"could not register a test account: {res.text}"
    body = res.json()
    session = requests.Session()
    session.headers["Authorization"] = f"Bearer {body['token']}"
    session.user = body["user"]  # type: ignore[attr-defined]
    return session


@pytest.fixture(scope="module")
def owner():
    return _account("owner")


@pytest.fixture(scope="module")
def other_user():
    return _account("other")


@pytest.fixture(scope="module")
def created_ids(owner, other_user):
    """Ids to remove afterwards. Ownership may have moved mid-test, so deletion tries both accounts
    before giving up — and says so loudly rather than leaving a row behind silently."""
    ids: list[str] = []
    yield ids
    leaked = []
    for iid in ids:
        if any(s.delete(f"{API}/{iid}", timeout=TIMEOUT).status_code == 200 for s in (owner, other_user)):
            continue
        leaked.append(iid)
    # Close the throwaway logins too. Leaving them behind would put "pytest owner" in the
    # assignee menu of a real dashboard, which is precisely the noise this suite created before.
    for s in (owner, other_user):
        s.delete(f"{BASE_URL}/api/auth/me", timeout=TIMEOUT)
    assert not leaked, f"test initiatives left behind: {leaked}"


def _unique_name(prefix="TEST_INIT"):
    return f"{prefix}_{uuid.uuid4().hex[:8]}"


def _create(session, created_ids, **fields):
    body = {"name": _unique_name(), **fields}
    r = session.post(API, json=body, timeout=TIMEOUT)
    assert r.status_code == 201, r.text
    doc = r.json()
    created_ids.append(doc["id"])
    return doc


def test_health():
    r = requests.get(f"{BASE_URL}/api/health", timeout=TIMEOUT)
    assert r.status_code == 200
    assert r.json().get("status") == "ok"


def test_create_requires_an_account(created_ids):
    """The route that most needs an identity is the one that assigns ownership."""
    r = requests.post(API, json={"name": _unique_name()}, timeout=TIMEOUT)
    assert r.status_code == 401, r.text


def test_create_initiative(owner, created_ids):
    d = _create(owner, created_ids, description="desc", team="Platform")
    assert d["status"] == "in_qa"
    # Ownership comes from the token, never the body.
    assert d["owner"]["id"] == owner.user["id"]
    assert d["shippedAt"] is None
    assert "nameLower" not in d
    assert "_id" not in d


def test_owner_cannot_be_forged(owner, other_user, created_ids):
    """Passing someone else's identity must not hand them the initiative — or, worse, hand the
    sender edit rights over a row they do not own."""
    r = owner.post(API, json={"name": _unique_name(), "owner": other_user.user}, timeout=TIMEOUT)
    assert r.status_code == 201, r.text
    created_ids.append(r.json()["id"])
    assert r.json()["owner"]["id"] == owner.user["id"]


def test_list_initiatives(owner, created_ids):
    _create(owner, created_ids)
    r = owner.get(API, timeout=TIMEOUT)  # reads need a token now — the corpus is not public
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, list)
    assert created_ids[0] in [i["id"] for i in data]


def test_duplicate_active_name_returns_409(owner, created_ids):
    name = _unique_name("TEST_DUP")
    r1 = owner.post(API, json={"name": name}, timeout=TIMEOUT)
    assert r1.status_code == 201
    created_ids.append(r1.json()["id"])
    r2 = owner.post(API, json={"name": name}, timeout=TIMEOUT)
    assert r2.status_code == 409


def test_patch_by_owner_updates_name_and_desc(owner, created_ids):
    iid = _create(owner, created_ids)["id"]
    new_name = _unique_name("TEST_RENAME")
    r = owner.patch(f"{API}/{iid}", json={"name": new_name, "description": "d2"}, timeout=TIMEOUT)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["name"] == new_name
    assert d["description"] == "d2"


def test_patch_by_non_owner_403(owner, other_user, created_ids):
    iid = _create(owner, created_ids)["id"]
    r = other_user.patch(f"{API}/{iid}", json={"name": "x"}, timeout=TIMEOUT)
    assert r.status_code == 403


def test_status_shipped_sets_shippedAt_and_reopen_clears(owner, created_ids):
    iid = _create(owner, created_ids)["id"]
    r = owner.patch(f"{API}/{iid}", json={"status": "shipped"}, timeout=TIMEOUT)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["status"] == "shipped"
    assert isinstance(d["shippedAt"], int)
    r2 = owner.patch(f"{API}/{iid}", json={"status": "in_qa"}, timeout=TIMEOUT)
    assert r2.status_code == 200
    assert r2.json()["shippedAt"] is None


def test_invalid_status_400(owner, created_ids):
    iid = _create(owner, created_ids)["id"]
    r = owner.patch(f"{API}/{iid}", json={"status": "bogus"}, timeout=TIMEOUT)
    assert r.status_code == 400


def test_owner_transfer(owner, other_user, created_ids):
    iid = _create(owner, created_ids)["id"]
    r = owner.patch(f"{API}/{iid}", json={"owner": other_user.user}, timeout=TIMEOUT)
    assert r.status_code == 200
    assert r.json()["owner"]["id"] == other_user.user["id"]
    # the previous owner loses edit rights with it
    assert owner.patch(f"{API}/{iid}", json={"name": "nope"}, timeout=TIMEOUT).status_code == 403
    r3 = other_user.patch(f"{API}/{iid}", json={"status": "archived"}, timeout=TIMEOUT)
    assert r3.status_code == 200
    assert r3.json()["status"] == "archived"


def test_duplicate_allowed_when_previous_archived(owner, created_ids):
    name = _unique_name("TEST_ARCH")
    r1 = owner.post(API, json={"name": name}, timeout=TIMEOUT)
    assert r1.status_code == 201
    created_ids.append(r1.json()["id"])
    assert owner.patch(f"{API}/{r1.json()['id']}", json={"status": "archived"}, timeout=TIMEOUT).status_code == 200
    r2 = owner.post(API, json={"name": name}, timeout=TIMEOUT)
    assert r2.status_code == 201, "archiving should free the name"
    created_ids.append(r2.json()["id"])


def test_patch_nonexistent_404(owner):
    r = owner.patch(f"{API}/init-does-not-exist", json={"name": "x"}, timeout=TIMEOUT)
    assert r.status_code == 404


def test_delete_requires_owner_or_admin(owner, other_user, created_ids):
    iid = _create(owner, created_ids)["id"]
    assert other_user.delete(f"{API}/{iid}", timeout=TIMEOUT).status_code == 403
    assert owner.delete(f"{API}/{iid}", timeout=TIMEOUT).status_code == 200
    created_ids.remove(iid)
    assert owner.delete(f"{API}/{iid}", timeout=TIMEOUT).status_code == 404
