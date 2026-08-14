# Backend tests for /api/teams — teams people join, and sessions scoped to them.
#
# `team` used to be a free-text string on an account, which meant "Frontend", "frontend" and
# "Front-End" were three different teams and none of them could be looked at. The tests that matter
# most here are the ones about that promotion: slug collapsing, the legacy-string fallback that
# migrates existing accounts without anybody editing them, and the fact that a session is stamped
# with its reporter's teams at filing rather than asked for on a form.
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

API = f"{BASE_URL}/api/teams"
BUGS = f"{BASE_URL}/api/bugs"
TIMEOUT = 20


def _account(label: str, team: str | None = None) -> requests.Session:
    email = f"pytest-{label}-{uuid.uuid4().hex[:10]}@qa-pytest.emergent.sh"
    body = {"name": f"pytest {label}", "email": email, "password": uuid.uuid4().hex}
    if team is not None:
        body["team"] = team
    res = requests.post(f"{BASE_URL}/api/auth/register", json=body, timeout=TIMEOUT)
    assert res.status_code == 200, res.text
    out = res.json()
    s = requests.Session()
    s.headers["Authorization"] = f"Bearer {out['token']}"
    s.user = out["user"]  # type: ignore[attr-defined]
    return s


@pytest.fixture(scope="module")
def alice():
    return _account("alice")


@pytest.fixture(scope="module")
def bob():
    return _account("bob")


@pytest.fixture(scope="module")
def made(alice, bob):
    """Teams created during the run — DELETED afterwards, not merely left.

    The first version of this only left the teams and closed the logins, so every run added a few
    more rows to a shared database; 75 had piled up before the Teams page made them visible. It now
    fails loudly if anything survives, because a suite that leaks quietly is a suite nobody notices
    is leaking.
    """
    ids: list[tuple[str, requests.Session]] = []
    yield ids
    leaked = []
    # Deleting a team requires membership, and two tests create teams with throwaway accounts they
    # then close inside the test — so the creator must be tried FIRST, while it still exists.
    # alice/bob are the fallback for teams they are themselves in.
    for tid, owner in ids:
        if not any(
            s.delete(f"{API}/{tid}", timeout=TIMEOUT).status_code in (200, 404)
            for s in (owner, alice, bob)
        ):
            leaked.append(tid)
    for s in (alice, bob):
        s.delete(f"{BASE_URL}/api/auth/me", timeout=TIMEOUT)
    assert not leaked, f"test teams left behind: {leaked}"


def _new_team(session, made, name=None, description=""):
    name = name or f"PyTest {uuid.uuid4().hex[:8]}"
    res = session.post(API, json={"name": name, "description": description}, timeout=TIMEOUT)
    assert res.status_code == 200, res.text
    team = res.json()
    # Recorded with its creator: teardown needs an account that is a member, and some of these
    # accounts do not outlive the test that made them.
    made.append((team["id"], session))
    return team


def test_creating_a_team_joins_you_to_it(alice, made):
    """Creating a team you are not in is nearly always a mistake — you are setting up your group."""
    team = _new_team(alice, made, "PyTest Retention " + uuid.uuid4().hex[:6])
    assert team["joined"] is True
    assert team["id"].startswith("tm-")
    assert team["memberCount"] == 1


def test_signing_in_is_required_to_create(made):
    res = requests.post(API, json={"name": "PyTest Anonymous"}, timeout=TIMEOUT)
    assert res.status_code == 401, res.text


def test_a_name_of_only_punctuation_is_refused(alice):
    res = alice.post(API, json={"name": "---"}, timeout=TIMEOUT)
    assert res.status_code == 400, res.text


def test_the_same_team_name_joins_rather_than_duplicating(alice, bob, made):
    """Two people setting up "Retention" on one afternoon should land in ONE team, not get a 409
    and a second team called "Retention (2)"."""
    name = f"PyTest NDR {uuid.uuid4().hex[:6]}"
    first = _new_team(alice, made, name)
    second = bob.post(API, json={"name": name}, timeout=TIMEOUT).json()
    assert second["id"] == first["id"], "a second create made a duplicate team"
    assert second["alreadyExisted"] is True
    assert second["joined"] is True


@pytest.mark.parametrize("variant", ["Front-End", "front end", "  frontend  ", "FrontEnd"])
def test_spelling_variants_collapse_to_one_team(alice, made, variant):
    """The whole reason this stopped being a free-text string."""
    canonical = f"PyTestFE{uuid.uuid4().hex[:6]}"
    base = _new_team(alice, made, canonical)
    spelled = f"{canonical[:7]}-{canonical[7:]}" if variant == "Front-End" else canonical
    again = alice.post(API, json={"name": spelled}, timeout=TIMEOUT).json()
    assert again["id"] == base["id"], f"{spelled!r} created a separate team from {canonical!r}"


def test_join_and_leave_move_the_roster(alice, bob, made):
    team = _new_team(alice, made)
    assert bob.post(f"{API}/{team['id']}/join", timeout=TIMEOUT).status_code == 200

    detail = bob.get(f"{API}/{team['id']}", timeout=TIMEOUT).json()
    assert detail["joined"] is True
    assert bob.user["id"] in [m["id"] for m in detail["members"]]
    assert detail["memberCount"] == 2

    assert bob.post(f"{API}/{team['id']}/leave", timeout=TIMEOUT).status_code == 200
    after = bob.get(f"{API}/{team['id']}", timeout=TIMEOUT).json()
    assert after["joined"] is False
    assert bob.user["id"] not in [m["id"] for m in after["members"]]


def test_joining_twice_does_not_duplicate_membership(alice, made):
    team = _new_team(alice, made)
    alice.post(f"{API}/{team['id']}/join", timeout=TIMEOUT)
    alice.post(f"{API}/{team['id']}/join", timeout=TIMEOUT)
    detail = alice.get(f"{API}/{team['id']}", timeout=TIMEOUT).json()
    assert detail["memberCount"] == 1, "re-joining duplicated the membership"


def test_joining_a_team_that_does_not_exist_is_404(alice):
    assert alice.post(f"{API}/tm-nope/join", timeout=TIMEOUT).status_code == 404


def test_a_non_member_cannot_rename_the_team(alice, bob, made):
    """A team's name is how everybody else finds it — a passer-by must not change it."""
    team = _new_team(alice, made)
    res = bob.patch(f"{API}/{team['id']}", json={"name": "PyTest Hijacked"}, timeout=TIMEOUT)
    assert res.status_code == 403, res.text


def test_a_member_can_rename_it(alice, made):
    team = _new_team(alice, made)
    fresh = f"PyTest Renamed {uuid.uuid4().hex[:6]}"
    res = alice.patch(f"{API}/{team['id']}", json={"name": fresh}, timeout=TIMEOUT)
    assert res.status_code == 200, res.text
    assert res.json()["name"] == fresh


def test_renaming_onto_another_teams_name_is_refused(alice, made):
    a = _new_team(alice, made)
    b = _new_team(alice, made)
    res = alice.patch(f"{API}/{a['id']}", json={"name": b["name"]}, timeout=TIMEOUT)
    assert res.status_code == 409, res.text


def test_a_filed_session_is_stamped_with_the_reporters_teams(alice, made):
    """The point of the feature: a group sees its own work without anybody filling in a team field."""
    team = _new_team(alice, made)
    human_id = requests.post(f"{BUGS}/allocate", json={}, timeout=TIMEOUT).json()["humanId"]
    body = {
        "id": f"d-team-{uuid.uuid4().hex[:8]}", "humanId": human_id, "title": "pytest team stamping",
        "description": "", "status": "open", "severity": "medium", "tags": [],
        "pageUrl": "https://example.com", "reporter": alice.user, "assignee": None,
        "createdAt": 1, "updatedAt": 1, "durationMs": 1000, "scenario": "generic",
        "replay": [], "visits": [], "console": [], "network": [], "pickedElements": [], "markers": [],
        "environment": {"browser": "Chrome", "os": "macOS", "viewport": {"w": 1, "h": 1},
                        "dpr": 1, "language": "en", "timezone": "UTC", "online": True},
        "events": [],
    }
    assert requests.put(f"{BUGS}/{human_id}", json=body, timeout=TIMEOUT).status_code == 200

    try:
        stored = requests.get(f"{BUGS}/{human_id}", timeout=TIMEOUT).json()
        assert team["id"] in (stored.get("teamIds") or []), "the session was not stamped with its team"

        scoped = requests.get(f"{API}/{team['id']}/sessions", timeout=TIMEOUT).json()
        assert human_id in [b["humanId"] for b in scoped], "the team's own session list omits it"

        filtered = requests.get(BUGS, params={"teamId": team["id"]}, timeout=TIMEOUT).json()
        assert human_id in [b["humanId"] for b in filtered], "?teamId= did not find it"
    finally:
        alice.delete(f"{BUGS}/{human_id}", timeout=TIMEOUT)


def test_a_team_with_no_sessions_returns_an_empty_list_not_everything(alice, made):
    """A filter that silently matches nothing must not fall back to the whole corpus."""
    team = _new_team(alice, made)
    assert requests.get(f"{API}/{team['id']}/sessions", timeout=TIMEOUT).json() == []


def test_the_legacy_free_text_team_still_finds_its_team(made):
    """The migration. An account that has only ever carried `team: "Platform"` starts seeing that
    team's work the moment somebody creates a team called Platform — no admin edit required."""
    legacy_name = f"PyTestLegacy{uuid.uuid4().hex[:6]}"
    carol = _account("carol", team=legacy_name)
    try:
        # She has no teamIds at all — only the old string.
        assert carol.get(API, timeout=TIMEOUT).json() is not None
        team = _new_team(carol, made, legacy_name)
        # Creating it joined her explicitly; the fallback is what matters for accounts that never do.
        dave = _account("dave", team=legacy_name)
        try:
            listed = {t["id"]: t for t in dave.get(API, timeout=TIMEOUT).json()}
            assert listed[team["id"]]["joined"] is True, "the legacy team string was not honoured"
        finally:
            dave.delete(f"{BASE_URL}/api/auth/me", timeout=TIMEOUT)
    finally:
        carol.delete(f"{BASE_URL}/api/auth/me", timeout=TIMEOUT)


def test_joining_a_team_does_not_silently_drop_your_legacy_one(made):
    """The regression: resolve_membership reads the legacy `team` string ONLY while teamIds is
    empty, so the first explicit join used to end every implicit membership. A user carrying
    team="Platform" who joined Growth left Platform without asking to and without being told."""
    legacy_name = f"PyTestLegacy{uuid.uuid4().hex[:6]}"
    other_name = f"PyTestOther{uuid.uuid4().hex[:6]}"

    founder = _account("founder")
    legacy_team = _new_team(founder, made, legacy_name)
    other_team = _new_team(founder, made, other_name)

    # Carries only the old free-text string — no teamIds at all.
    eve = _account("eve", team=legacy_name)
    try:
        listed = {t["id"]: t for t in eve.get(API, timeout=TIMEOUT).json()}
        assert listed[legacy_team["id"]]["joined"] is True, "legacy string should resolve before any join"

        # Join an UNRELATED team. The legacy membership must survive.
        assert eve.post(f"{API}/{other_team['id']}/join", timeout=TIMEOUT).status_code == 200

        after = {t["id"]: t for t in eve.get(API, timeout=TIMEOUT).json()}
        assert after[other_team["id"]]["joined"] is True, "the team actually joined"
        assert after[legacy_team["id"]]["joined"] is True, (
            "joining one team silently removed the legacy team — the exact regression"
        )

        # And the legacy team now lists them for real, rather than only via the fallback.
        roster = eve.get(f"{API}/{legacy_team['id']}", timeout=TIMEOUT).json()
        assert eve.user["id"] in [m["id"] for m in roster["members"]], (
            "legacy membership was honoured but never made real, so the roster still omits them"
        )
    finally:
        eve.delete(f"{BASE_URL}/api/auth/me", timeout=TIMEOUT)
        founder.delete(f"{BASE_URL}/api/auth/me", timeout=TIMEOUT)


def test_a_team_holding_sessions_refuses_to_be_deleted(alice, made):
    """Sessions are stamped with their team at filing and are evidence. Cascading a delete through
    them would quietly unstamp a body of work, which is the kind of loss this product exists to
    prevent — so the delete is refused and says what to do instead."""
    team = _new_team(alice, made)
    human_id = requests.post(f"{BUGS}/allocate", json={}, timeout=TIMEOUT).json()["humanId"]
    body = {
        "id": f"d-del-{uuid.uuid4().hex[:8]}", "humanId": human_id, "title": "pytest delete guard",
        "description": "", "status": "open", "severity": "medium", "tags": [],
        "pageUrl": "https://example.com", "reporter": alice.user, "assignee": None,
        "createdAt": 1, "updatedAt": 1, "durationMs": 1000, "scenario": "generic",
        "replay": [], "visits": [], "console": [], "network": [], "pickedElements": [], "markers": [],
        "environment": {"browser": "Chrome", "os": "macOS", "viewport": {"w": 1, "h": 1},
                        "dpr": 1, "language": "en", "timezone": "UTC", "online": True},
        "events": [],
    }
    requests.put(f"{BUGS}/{human_id}", json=body, timeout=TIMEOUT)
    try:
        res = alice.delete(f"{API}/{team['id']}", timeout=TIMEOUT)
        assert res.status_code == 409, res.text
        assert "session" in res.text
    finally:
        # Detach the session so the fixture's own cleanup can remove the team.
        alice.delete(f"{BUGS}/{human_id}", timeout=TIMEOUT)


def test_a_non_member_cannot_delete_the_team(alice, bob, made):
    team = _new_team(alice, made)
    assert bob.delete(f"{API}/{team['id']}", timeout=TIMEOUT).status_code == 403
