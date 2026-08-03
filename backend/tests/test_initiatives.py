# Backend tests for /api/initiatives CRUD + edge cases
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


@pytest.fixture(scope="module")
def owner():
    return {"id": f"u-{uuid.uuid4().hex[:8]}", "name": "QA Tester", "email": "qa@test.com"}


@pytest.fixture(scope="module")
def other_user():
    return {"id": f"u-{uuid.uuid4().hex[:8]}", "name": "Other User", "email": "other@test.com"}


@pytest.fixture(scope="module")
def created_ids():
    ids: list[str] = []
    yield ids
    # cleanup: archive via patch is best effort; delete not exposed. Leave them.


def _unique_name(prefix="TEST_INIT"):
    return f"{prefix}_{uuid.uuid4().hex[:8]}"


def test_health():
    r = requests.get(f"{BASE_URL}/api/health", timeout=10)
    assert r.status_code == 200
    assert r.json().get("status") == "ok"


def test_create_initiative(owner, created_ids):
    name = _unique_name()
    r = requests.post(API, json={"name": name, "description": "desc", "team": "Platform", "owner": owner}, timeout=10)
    assert r.status_code == 201, r.text
    d = r.json()
    assert d["name"] == name
    assert d["status"] == "in_qa"
    assert d["owner"]["id"] == owner["id"]
    assert d["shippedAt"] is None
    assert "id" in d
    assert "nameLower" not in d
    assert "_id" not in d
    created_ids.append(d["id"])


def test_list_initiatives(created_ids):
    r = requests.get(API, timeout=10)
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, list)
    ids = [d["id"] for d in data]
    assert created_ids[0] in ids


def test_duplicate_active_name_returns_409(owner):
    name = _unique_name()
    r1 = requests.post(API, json={"name": name, "owner": owner}, timeout=10)
    assert r1.status_code == 201
    r2 = requests.post(API, json={"name": name, "owner": owner}, timeout=10)
    assert r2.status_code == 409


def test_patch_by_owner_updates_name_and_desc(owner, created_ids):
    iid = created_ids[0]
    new_name = _unique_name("TEST_RENAME")
    r = requests.patch(f"{API}/{iid}", json={"requesterId": owner["id"], "name": new_name, "description": "d2"}, timeout=10)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["name"] == new_name
    assert d["description"] == "d2"


def test_patch_wrong_requester_403(owner, other_user, created_ids):
    iid = created_ids[0]
    r = requests.patch(f"{API}/{iid}", json={"requesterId": other_user["id"], "name": "x"}, timeout=10)
    assert r.status_code == 403


def test_status_shipped_sets_shippedAt_and_reopen_clears(owner, created_ids):
    iid = created_ids[0]
    r = requests.patch(f"{API}/{iid}", json={"requesterId": owner["id"], "status": "shipped"}, timeout=10)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["status"] == "shipped"
    assert d["shippedAt"] is not None and isinstance(d["shippedAt"], int)

    r2 = requests.patch(f"{API}/{iid}", json={"requesterId": owner["id"], "status": "in_qa"}, timeout=10)
    assert r2.status_code == 200
    d2 = r2.json()
    assert d2["status"] == "in_qa"
    assert d2["shippedAt"] is None


def test_invalid_status_400(owner, created_ids):
    iid = created_ids[0]
    r = requests.patch(f"{API}/{iid}", json={"requesterId": owner["id"], "status": "bogus"}, timeout=10)
    assert r.status_code == 400


def test_owner_transfer(owner, other_user, created_ids):
    iid = created_ids[0]
    # transfer to other_user
    r = requests.patch(
        f"{API}/{iid}",
        json={"requesterId": owner["id"], "owner": other_user},
        timeout=10,
    )
    assert r.status_code == 200
    assert r.json()["owner"]["id"] == other_user["id"]
    # now original owner can't edit
    r2 = requests.patch(f"{API}/{iid}", json={"requesterId": owner["id"], "name": "nope"}, timeout=10)
    assert r2.status_code == 403
    # new owner can archive
    r3 = requests.patch(f"{API}/{iid}", json={"requesterId": other_user["id"], "status": "archived"}, timeout=10)
    assert r3.status_code == 200
    assert r3.json()["status"] == "archived"


def test_duplicate_allowed_when_previous_archived(owner):
    name = _unique_name("TEST_DUP_ARCH")
    r1 = requests.post(API, json={"name": name, "owner": owner}, timeout=10)
    assert r1.status_code == 201
    iid = r1.json()["id"]
    ra = requests.patch(f"{API}/{iid}", json={"requesterId": owner["id"], "status": "archived"}, timeout=10)
    assert ra.status_code == 200
    r2 = requests.post(API, json={"name": name, "owner": owner}, timeout=10)
    assert r2.status_code == 201


def test_patch_nonexistent_404(owner):
    r = requests.patch(f"{API}/init-doesnotexist", json={"requesterId": owner["id"], "name": "x"}, timeout=10)
    assert r.status_code == 404
