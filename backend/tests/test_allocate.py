# Backend tests for /api/bugs/allocate — the atomicity that stops one recording becoming several
# bugs.
#
# This is the regression suite for a real field report: "sometimes it creates multiple jobs of the
# same submission". The cause was not on the client. `allocate` looked for a bug row carrying the
# draftId and allocated a fresh number when it found none — but the bug row is not written until
# the client PUTs it, several round trips later, so EVERY caller inside that window found nothing
# and burned its own number. Eight concurrent allocations for one recording returned BF-129
# through BF-136.
#
# The client-side guard that existed (a React ref holding handled draft ids) could never close it:
# refs are per tab and per page load, so two dashboard tabs, or one reload mid-filing, sailed
# straight past it. Hence the test that matters here is the CONCURRENT one.
import os
import uuid
from concurrent.futures import ThreadPoolExecutor

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL")
if not BASE_URL:
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip()
BASE_URL = (BASE_URL or "").rstrip("/")

API = f"{BASE_URL}/api/bugs/allocate"
TIMEOUT = 30


def _allocate(draft_id):
    res = requests.post(API, json={"draftId": draft_id}, timeout=TIMEOUT)
    assert res.status_code == 200, res.text
    return res.json()


def test_one_draft_gets_one_number_however_many_times_you_ask():
    draft_id = f"d-seq-{uuid.uuid4().hex[:10]}"
    ids = {_allocate(draft_id)["humanId"] for _ in range(5)}
    assert len(ids) == 1, f"sequential re-allocation issued {ids}"


def test_the_first_call_is_new_and_the_rest_are_reused():
    draft_id = f"d-flag-{uuid.uuid4().hex[:10]}"
    first = _allocate(draft_id)
    assert first["reused"] is False, "the first allocation for a draft is not a reuse"
    assert _allocate(draft_id)["reused"] is True, "a repeat must report itself as a reuse"


@pytest.mark.parametrize("concurrency", [8, 16])
def test_concurrent_allocation_is_atomic(concurrency):
    """THE regression test. Sequential idempotency was already working when the bug was live —
    what was broken was the race, and the race is the case that actually happens: the bridge
    re-posts every 500ms, and two dashboard tabs drain one shared queue."""
    draft_id = f"d-race-{uuid.uuid4().hex[:10]}"
    with ThreadPoolExecutor(max_workers=concurrency) as ex:
        ids = list(ex.map(lambda _: _allocate(draft_id)["humanId"], range(concurrency)))
    unique = sorted(set(ids))
    assert len(unique) == 1, (
        f"{concurrency} concurrent allocations for ONE recording produced {len(unique)} "
        f"bug numbers: {unique}. Every one of those becomes a separate row."
    )


def test_different_drafts_still_get_different_numbers():
    """The fix must not overshoot into handing everyone the same id."""
    a = _allocate(f"d-a-{uuid.uuid4().hex[:10]}")["humanId"]
    b = _allocate(f"d-b-{uuid.uuid4().hex[:10]}")["humanId"]
    assert a != b, "two unrelated recordings collapsed onto one bug number"


def test_concurrent_distinct_drafts_never_collide():
    """The counter is shared, so atomicity for one draft must not serialise two into one number."""
    drafts = [f"d-multi-{uuid.uuid4().hex[:8]}-{i}" for i in range(12)]
    with ThreadPoolExecutor(max_workers=12) as ex:
        ids = list(ex.map(lambda d: _allocate(d)["humanId"], drafts))
    assert len(set(ids)) == len(drafts), f"12 distinct recordings shared numbers: {sorted(ids)}"


def test_allocation_without_a_draft_id_still_works():
    """Filing offline, or from a client too old to send one, must not 500."""
    res = requests.post(API, json={}, timeout=TIMEOUT)
    assert res.status_code == 200, res.text
    assert res.json()["humanId"].startswith("BF-")


def test_a_non_string_draft_id_cannot_become_a_mongo_operator():
    """`{"$regex": "."}` here would reach Mongo as a query operator and match somebody else's
    capture — handing this caller a bug number already belonging to another recording."""
    res = requests.post(API, json={"draftId": {"$regex": "."}}, timeout=TIMEOUT)
    assert res.status_code == 200, res.text
    assert res.json()["reused"] is False, "an operator was matched against stored draftIds"
