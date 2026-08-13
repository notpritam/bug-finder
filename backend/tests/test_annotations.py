# Backend tests for /api/bugs/{id}/annotations — flags added AFTER a session was filed.
#
# The reason this is a separate field from `markers` and not an addition to EDITABLE_FIELDS is the
# thing most worth protecting here: `markers` is capture, and capture is immutable. So these check
# not only that annotating works, but that it does NOT become a back door onto the evidence — that
# a stranger cannot rewrite someone else's annotation, and that the recorded markers are untouched
# by any of it.
#
# Follows test_initiatives.py: throwaway accounts registered per run, everything cleaned up after,
# and a loud failure rather than a silent leak if cleanup does not land.
import os
import uuid

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL")
if not BASE_URL:
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip()
BASE_URL = (BASE_URL or "").rstrip("/")

API = f"{BASE_URL}/api/bugs"
TIMEOUT = 15


def _account(label: str) -> requests.Session:
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
def author():
    return _account("annot-author")


@pytest.fixture(scope="module")
def stranger():
    return _account("annot-stranger")


@pytest.fixture(scope="module")
def session_id(author, stranger):
    """A filed session to annotate, with two recorded markers so we can prove those stay put."""
    allocated = requests.post(f"{API}/allocate", json={}, timeout=TIMEOUT)
    assert allocated.status_code == 200, allocated.text
    human_id = allocated.json()["humanId"]

    body = {
        "id": f"d-pytest-{uuid.uuid4().hex[:8]}",
        "humanId": human_id,
        "title": "pytest annotations fixture",
        "description": "",
        "status": "open",
        "severity": "medium",
        "tags": [],
        "pageUrl": "https://example.com/checkout",
        "reporter": author.user,
        "assignee": None,
        "createdAt": 1, "updatedAt": 1, "durationMs": 60_000,
        "scenario": "generic",
        "replay": [], "visits": [], "console": [], "network": [], "pickedElements": [],
        # Two CAPTURE markers. Nothing in this suite may change them.
        "markers": [
            {"t": 4_000, "label": "Flagged moment", "kind": "user"},
            {"t": 9_500, "label": "TypeError: total of undefined", "kind": "error"},
        ],
        "environment": {"browser": "Chrome 153", "os": "macOS", "viewport": {"w": 1440, "h": 900},
                        "dpr": 2, "language": "en", "timezone": "UTC", "online": True},
        "events": [],
    }
    res = requests.put(f"{API}/{human_id}", json=body, timeout=TIMEOUT)
    assert res.status_code == 200, res.text

    yield human_id

    author.delete(f"{API}/{human_id}", timeout=TIMEOUT)
    for s in (author, stranger):
        s.delete(f"{BASE_URL}/api/auth/me", timeout=TIMEOUT)
    gone = requests.get(f"{API}/{human_id}", timeout=TIMEOUT)
    assert gone.status_code == 404, f"test session {human_id} was left behind"


def _annotations(human_id):
    res = requests.get(f"{API}/{human_id}", timeout=TIMEOUT)
    assert res.status_code == 200, res.text
    return res.json().get("annotations") or []


def test_signing_in_is_required(session_id):
    """Anonymous filing is a first-class path, but anonymous ANNOTATION is not: every entry carries
    a name, and a name nobody can be held to is worse than no name."""
    res = requests.post(f"{API}/{session_id}/annotations", json={"t": 1000, "label": "nope"}, timeout=TIMEOUT)
    assert res.status_code == 401, res.text


def test_add_pins_a_moment_with_its_author(author, session_id):
    res = author.post(f"{API}/{session_id}/annotations", json={"t": 12_500, "label": "cart total is wrong here"},
                      timeout=TIMEOUT)
    assert res.status_code == 200, res.text
    made = res.json()
    assert made["t"] == 12_500
    assert made["label"] == "cart total is wrong here"
    assert made["by"]["id"] == author.user["id"], "an annotation is attributable or it is not evidence of anything"
    assert made["at"] > 0
    assert made["id"].startswith("an-")

    stored = _annotations(session_id)
    assert [a["id"] for a in stored] == [made["id"]]


def test_the_pre_roll_is_pinnable(author, session_id):
    """The replay clock runs negative through the two minutes captured before Record was pressed,
    and that window is very often where the cause is. A `ge=0` on `t` would make it unpinnable."""
    res = author.post(f"{API}/{session_id}/annotations", json={"t": -45_000, "label": "the 500 that started it"},
                      timeout=TIMEOUT)
    assert res.status_code == 200, res.text
    assert res.json()["t"] == -45_000


def test_a_blank_label_is_refused(author, session_id):
    for label in ("", "   "):
        res = author.post(f"{API}/{session_id}/annotations", json={"t": 1_000, "label": label}, timeout=TIMEOUT)
        assert res.status_code in (400, 422), f"blank label accepted: {res.text}"


def test_author_can_reword_their_own(author, session_id):
    made = author.post(f"{API}/{session_id}/annotations", json={"t": 3_000, "label": "typo heer"},
                       timeout=TIMEOUT).json()
    res = author.patch(f"{API}/{session_id}/annotations/{made['id']}", json={"label": "typo here"}, timeout=TIMEOUT)
    assert res.status_code == 200, res.text
    assert res.json()["label"] == "typo here"
    assert res.json()["editedAt"] > 0, "an edited annotation says it was edited"

    stored = {a["id"]: a for a in _annotations(session_id)}
    assert stored[made["id"]]["label"] == "typo here"


def test_a_stranger_cannot_rewrite_or_delete_your_annotation(author, stranger, session_id):
    """The one that matters. An annotation carries a name, so letting anyone edit it puts words in
    someone else's mouth on a record other people make decisions from."""
    made = author.post(f"{API}/{session_id}/annotations", json={"t": 5_000, "label": "mine"},
                       timeout=TIMEOUT).json()

    edited = stranger.patch(f"{API}/{session_id}/annotations/{made['id']}", json={"label": "not mine"},
                            timeout=TIMEOUT)
    assert edited.status_code == 403, edited.text

    removed = stranger.delete(f"{API}/{session_id}/annotations/{made['id']}", timeout=TIMEOUT)
    assert removed.status_code == 403, removed.text

    stored = {a["id"]: a for a in _annotations(session_id)}
    assert stored[made["id"]]["label"] == "mine", "the original survived both attempts"


def test_delete_removes_only_that_one(author, session_id):
    keep = author.post(f"{API}/{session_id}/annotations", json={"t": 7_000, "label": "keep me"},
                       timeout=TIMEOUT).json()
    drop = author.post(f"{API}/{session_id}/annotations", json={"t": 8_000, "label": "drop me"},
                       timeout=TIMEOUT).json()

    res = author.delete(f"{API}/{session_id}/annotations/{drop['id']}", timeout=TIMEOUT)
    assert res.status_code == 200, res.text

    ids = [a["id"] for a in _annotations(session_id)]
    assert drop["id"] not in ids
    assert keep["id"] in ids


def test_a_missing_annotation_is_404_not_500(author, session_id):
    assert author.delete(f"{API}/{session_id}/annotations/an-nope", timeout=TIMEOUT).status_code == 404
    assert author.patch(f"{API}/{session_id}/annotations/an-nope", json={"label": "x"},
                        timeout=TIMEOUT).status_code == 404


def test_annotating_never_touches_the_recorded_markers(author, session_id):
    """The whole reason annotations are a separate field. If this ever fails, the UI has been given
    a way to rewrite capture, which is the rule EDITABLE_FIELDS exists to enforce."""
    before = requests.get(f"{API}/{session_id}", timeout=TIMEOUT).json()["markers"]

    made = author.post(f"{API}/{session_id}/annotations", json={"t": 4_000, "label": "same t as a real marker"},
                       timeout=TIMEOUT).json()
    author.patch(f"{API}/{session_id}/annotations/{made['id']}", json={"label": "reworded"}, timeout=TIMEOUT)
    author.delete(f"{API}/{session_id}/annotations/{made['id']}", timeout=TIMEOUT)

    after = requests.get(f"{API}/{session_id}", timeout=TIMEOUT).json()["markers"]
    assert after == before, "capture markers must be byte-identical after any annotation traffic"


def test_markers_are_still_rejected_as_a_patch_field(author, session_id):
    """The other half of the same rule: the field-level edit route must keep refusing capture."""
    res = author.patch(f"{API}/{session_id}", json={"markers": []}, timeout=TIMEOUT)
    assert res.status_code == 400, f"PATCH accepted a capture field: {res.text}"
    assert "markers" in res.text


def test_the_history_trail_records_who_pinned_what(author, session_id):
    author.post(f"{API}/{session_id}/annotations", json={"t": 11_000, "label": "audit trail check"}, timeout=TIMEOUT)
    doc = requests.get(f"{API}/{session_id}", timeout=TIMEOUT).json()
    annotated = [e for e in doc.get("events", []) if e.get("kind") == "annotated"]
    assert annotated, "an annotation is a change to the session and belongs in its history"
    assert any("audit trail check" in e.get("detail", "") for e in annotated)
