# ABOUTME: DOM time-travel — rebuilds the page DOM at any replay timestamp from the bug's rrweb
# ABOUTME: stream, so an agent can inspect element state at t=4s vs t=30s without a browser.
#
# rrweb records a FullSnapshot (serialized node tree) plus incremental events; the DOM at time t
# is: the latest snapshot at-or-before t, plus every mutation up to t. This module implements
# exactly that subset (mutations + input value flips — the state-bearing events). It does NOT
# apply scroll/viewport/media events: they don't change the tree an agent greps.
import asyncio
import gzip
import json
import os
import re
import urllib.request
from html import escape
from typing import Any

from fastapi import APIRouter, HTTPException, Query

from .bugs import load_bug
from .evidence_store import guard_offloaded

router = APIRouter()

# Mirrors the frontend's storage client (frontend/src/lib/storage-api.ts) — recordings live in
# the storage service; the bug doc carries only rrwebFileId.
_STORAGE_API = os.environ.get("STORAGE_API_URL") or "https://storage-api-docs.internal.emergent.host/api"
_FETCH_CAP_BYTES = 40_000_000
_HTML_CAP = 300_000
# 4_000 was small enough to cut a single component in half — one button with an inline SVG icon
# runs to most of a kilobyte, so a tab strip exceeded it and came back looking like a tab strip
# with three tabs. Ten matches at this cap is still a bounded response.
_OUTER_HTML_CAP = 40_000

# Tiny in-process cache: agents drill the same recording at several timestamps back to back.
_events_cache: dict[str, list[dict[str, Any]]] = {}
_EVENTS_CACHE_MAX = 4


def _fetch_json(url: str) -> Any:
    with urllib.request.urlopen(url, timeout=20) as res:  # noqa: S310 — fixed internal host
        data = res.read(_FETCH_CAP_BYTES + 1)
        if len(data) > _FETCH_CAP_BYTES:
            raise HTTPException(413, "recording too large to rebuild server-side")
    # The extension gzips JSON artefacts before upload. Detect it from the magic bytes rather than
    # a filename or a Content-Encoding header — the storage service serves the bytes verbatim as
    # application/octet-stream, so nothing downstream decompresses for us. Without this every
    # recording uploaded since gzipping landed reached json.loads as binary and 500ed the endpoint,
    # while the replay player and the evidence reader (which both already sniff) kept working —
    # so DOM time-travel looked broken for new bugs only.
    if data[:2] == b"\x1f\x8b":
        data = gzip.decompress(data)
        # The cap protects memory, and decompression is where memory grows: a small gzip can
        # expand into hundreds of megabytes. Re-check against the real size.
        if len(data) > _FETCH_CAP_BYTES:
            raise HTTPException(413, "recording too large to rebuild server-side")
    return json.loads(data)


async def resolve_rrweb_events(doc: dict[str, Any]) -> list[dict[str, Any]]:
    """Inline events when the upload failed and they stayed on the doc; otherwise the storage
    service copy. Raises 404 when the bug simply has no recording."""
    inline = doc.get("rrweb")
    if isinstance(inline, list) and len(inline) > 1:
        return inline
    file_id = doc.get("rrwebFileId")
    if not file_id:
        # `rrweb` is an offloaded key, so an unreachable evidence file lands here looking exactly
        # like a capture that never recorded one. Say which it was.
        guard_offloaded(doc)
        raise HTTPException(404, "bug has no rrweb recording (neither inline nor a storage file id)")
    key = str(file_id)
    if key in _events_cache:
        return _events_cache[key]
    events = await asyncio.to_thread(_fetch_json, f"{_STORAGE_API}/files/{key}/download")
    if not isinstance(events, list):
        raise HTTPException(502, "stored recording is not an rrweb event list")
    if len(_events_cache) >= _EVENTS_CACHE_MAX:
        _events_cache.pop(next(iter(_events_cache)))
    _events_cache[key] = events
    return events


# ------------------- node store: snapshot + mutations -------------------

class DomStore:
    """The rebuilt tree, indexed by rrweb node id. Parent/child links are ids, not references,
    so applying removes/adds is dictionary surgery."""

    def __init__(self) -> None:
        self.nodes: dict[int, dict[str, Any]] = {}
        self.root_id: int | None = None

    def register(self, serialized: dict[str, Any], parent_id: int | None) -> int:
        node_id = int(serialized["id"])
        self.nodes[node_id] = {
            "type": serialized.get("type"),
            "tagName": (serialized.get("tagName") or "").lower() or None,
            "attributes": dict(serialized.get("attributes") or {}),
            "textContent": serialized.get("textContent"),
            "childIds": [],
            "parentId": parent_id,
        }
        for child in serialized.get("childNodes") or []:
            child_id = self.register(child, node_id)
            self.nodes[node_id]["childIds"].append(child_id)
        return node_id

    def detach(self, node_id: int) -> None:
        node = self.nodes.get(node_id)
        if not node:
            return
        parent = self.nodes.get(node.get("parentId") or -1)
        if parent and node_id in parent["childIds"]:
            parent["childIds"].remove(node_id)
        node["parentId"] = None

    def insert(self, serialized: dict[str, Any], parent_id: int, next_id: int | None) -> None:
        node_id = self.register(serialized, parent_id)
        parent = self.nodes.get(parent_id)
        if not parent:
            return
        siblings = parent["childIds"]
        if node_id in siblings:
            siblings.remove(node_id)
        if next_id is not None and next_id in siblings:
            siblings.insert(siblings.index(next_id), node_id)
        else:
            siblings.append(node_id)


def _apply_mutation(store: DomStore, data: dict[str, Any]) -> None:
    # Order mirrors rrweb's replayer: removes, adds, then text/attribute patches.
    for removal in data.get("removes") or []:
        store.detach(int(removal.get("id", -1)))
    for addition in data.get("adds") or []:
        node = addition.get("node")
        if isinstance(node, dict):
            store.insert(node, int(addition.get("parentId", -1)), addition.get("nextId"))
    for text in data.get("texts") or []:
        node = store.nodes.get(int(text.get("id", -1)))
        if node:
            node["textContent"] = text.get("value")
    for patch in data.get("attributes") or []:
        node = store.nodes.get(int(patch.get("id", -1)))
        if not node:
            continue
        for key, value in (patch.get("attributes") or {}).items():
            if value is None:
                node["attributes"].pop(key, None)
            else:
                node["attributes"][key] = value


def _apply_input(store: DomStore, data: dict[str, Any]) -> None:
    node = store.nodes.get(int(data.get("id", -1)))
    if not node:
        return
    if "text" in data:
        node["attributes"]["value"] = data.get("text")
    if data.get("isChecked") is not None:
        if data["isChecked"]:
            node["attributes"]["checked"] = "true"
        else:
            node["attributes"].pop("checked", None)


def dom_at(events: list[dict[str, Any]], t_ms: int, rrweb_offset: int = 0) -> tuple[DomStore, dict[str, Any]]:
    """Rebuild the tree at replay-clock `t_ms`. rrweb timestamps are absolute; the replay clock
    starts at the first event (plus the trim offset a dashboard-trimmed bug carries)."""
    if not events:
        raise HTTPException(422, "empty recording")
    base = int(events[0].get("timestamp") or 0)
    target = base + rrweb_offset + max(0, t_ms)
    snapshot_index = None
    for i, ev in enumerate(events):
        if ev.get("type") == 2 and int(ev.get("timestamp") or 0) <= target:
            snapshot_index = i
    if snapshot_index is None:
        snapshot_index = next((i for i, ev in enumerate(events) if ev.get("type") == 2), None)
        if snapshot_index is None:
            raise HTTPException(422, "recording has no FullSnapshot")
    store = DomStore()
    snapshot_event = events[snapshot_index]
    store.root_id = store.register(snapshot_event["data"]["node"], None)
    applied = 0
    for ev in events[snapshot_index + 1 :]:
        if int(ev.get("timestamp") or 0) > target:
            break
        if ev.get("type") != 3:
            continue
        data = ev.get("data") or {}
        source = data.get("source")
        if source == 0:
            _apply_mutation(store, data)
            applied += 1
        elif source == 5:
            _apply_input(store, data)
            applied += 1
    meta = {
        "resolvedTimestamp": target,
        "snapshotAt": int(snapshot_event.get("timestamp") or 0) - base,
        "mutationsApplied": applied,
        "nodeCount": len(store.nodes),
    }
    return store, meta


# ------------------- serialize + query -------------------

_VOID_TAGS = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"}


def serialize(store: DomStore, node_id: int | None, cap: int | None = None) -> str:
    out: list[str] = []
    total = 0

    def walk(nid: int) -> None:
        nonlocal total
        if cap is not None and total > cap:
            return
        node = store.nodes.get(nid)
        if not node:
            return
        ntype = node["type"]
        if ntype == 3:  # text
            piece = escape(str(node.get("textContent") or ""))
            out.append(piece)
            total += len(piece)
            return
        if ntype in (4, 5):  # cdata/comment — invisible to element queries, skip in HTML too
            return
        if ntype in (0, 1):  # document / doctype — emit children
            for cid in node["childIds"]:
                walk(cid)
            return
        tag = node.get("tagName") or "div"
        attrs = "".join(
            f' {k}="{escape(str(v), quote=True)}"'
            for k, v in sorted(node["attributes"].items())
            if not k.startswith("rr_") and v is not None and v is not False
        )
        opening = f"<{tag}{attrs}>"
        out.append(opening)
        total += len(opening)
        if tag not in _VOID_TAGS:
            for cid in node["childIds"]:
                walk(cid)
            out.append(f"</{tag}>")
            total += len(tag) + 3

    if node_id is not None:
        walk(node_id)
    return "".join(out)


def text_of(store: DomStore, node_id: int, cap: int = 200) -> str:
    parts: list[str] = []
    total = 0

    def walk(nid: int) -> None:
        nonlocal total
        if total > cap:
            return
        node = store.nodes.get(nid)
        if not node:
            return
        if node["type"] == 3:
            piece = str(node.get("textContent") or "")
            parts.append(piece)
            total += len(piece)
        for cid in node["childIds"]:
            walk(cid)

    walk(node_id)
    return re.sub(r"\s+", " ", "".join(parts)).strip()[:cap]


_SELECTOR_PART = re.compile(r"(\[[^\]]+\])|([#.]?[\w-]+)")


def _selector_predicate(selector: str):
    """One compound selector — tag, #id, .class, [attr], [attr=v], [attr*=v] — no combinators.
    Enough to ask "where is agent-message-X / #checkout-button / [data-testid*=banner] at t"."""
    tag = None
    checks: list[tuple[str, str, str | None]] = []
    for bracket, word in _SELECTOR_PART.findall(selector.strip()):
        if bracket:
            inner = bracket[1:-1]
            if "*=" in inner:
                key, _, val = inner.partition("*=")
                checks.append(("attr-contains", key.strip(), val.strip().strip('"\'')))
            elif "=" in inner:
                key, _, val = inner.partition("=")
                checks.append(("attr-equals", key.strip(), val.strip().strip('"\'')))
            else:
                checks.append(("attr-has", inner.strip(), None))
        elif word.startswith("#"):
            checks.append(("attr-equals", "id", word[1:]))
        elif word.startswith("."):
            checks.append(("class", word[1:], None))
        elif word:
            tag = word.lower()

    def matches(node: dict[str, Any]) -> bool:
        if node["type"] != 2:
            return False
        if tag and node.get("tagName") != tag:
            return False
        attrs = node["attributes"]
        for kind, key, val in checks:
            if kind == "class":
                if key not in str(attrs.get("class", "")).split():
                    return False
            elif kind == "attr-has":
                if key not in attrs:
                    return False
            elif kind == "attr-equals":
                if str(attrs.get(key, "")) != val:
                    return False
            elif kind == "attr-contains":
                if val is None or val not in str(attrs.get(key, "")):
                    return False
        return True

    return matches


def _node_path(store: DomStore, node_id: int) -> str:
    parts: list[str] = []
    current: int | None = node_id
    while current is not None and len(parts) < 12:
        node = store.nodes.get(current)
        if not node:
            break
        if node["type"] == 2:
            label = node.get("tagName") or "?"
            if node["attributes"].get("id"):
                label += f"#{node['attributes']['id']}"
            elif node["attributes"].get("data-testid"):
                label += f"[data-testid={node['attributes']['data-testid']}]"
            parts.append(label)
        current = node.get("parentId")
    return " > ".join(reversed(parts))


# ------------------- endpoints -------------------


@router.get("/api/bugs/{human_id}/dom")
async def bug_dom_at(
    human_id: str,
    t: int = Query(0, description="Replay-clock milliseconds (same clock as markers/console/network `t`)"),
    selector: str = Query("", description="Compound CSS selector: tag, #id, .class, [attr], [attr=v], [attr*=v]"),
    q: str = Query("", description="Case-insensitive text-contains filter on the element's text"),
    limit: int = Query(10, ge=1, le=50),
    full: bool = Query(False, description="Include the serialized page HTML (capped) when no selector is given"),
) -> dict[str, Any]:
    """The DOM as it stood at `t`. With `selector`/`q`: the matching elements (outerHTML, text,
    path) — ask at two timestamps and diff to see how state moved. Without: tree stats, plus the
    full serialized HTML when `full=1`."""
    doc = await load_bug(human_id)
    events = await resolve_rrweb_events(doc)
    store, meta = dom_at(events, t, int(doc.get("rrwebOffset") or 0))
    result: dict[str, Any] = {"humanId": human_id, "t": t, **meta}
    if selector or q:
        predicate = _selector_predicate(selector) if selector else (lambda node: node["type"] == 2)
        needle = q.lower()
        matches = []
        for node_id, node in store.nodes.items():
            if node.get("parentId") is None and node_id != store.root_id:
                continue  # detached subtree — not in the visible document
            if not predicate(node):
                continue
            text = text_of(store, node_id)
            if needle and needle not in text.lower():
                continue
            raw = serialize(store, node_id, cap=_OUTER_HTML_CAP)
            matches.append(
                {
                    "nodeId": node_id,
                    "tag": node.get("tagName"),
                    "attributes": node["attributes"],
                    "path": _node_path(store, node_id),
                    "text": text,
                    "outerHTML": raw[: _OUTER_HTML_CAP + 200],
                    # Always stated, never inferred. serialize() closes every tag it opened, so a
                    # subtree cut off at the cap is still well-formed HTML and reads as complete —
                    # a reader who checks that it parses concludes the content was never recorded.
                    # That is precisely the wrong conclusion to hand an agent about its evidence.
                    "truncated": len(raw) > _OUTER_HTML_CAP,
                }
            )
            if len(matches) >= limit:
                break
        result["matchCount"] = len(matches)
        result["matches"] = matches
        return result
    if full:
        html = serialize(store, store.root_id, cap=_HTML_CAP)
        result["truncated"] = len(html) > _HTML_CAP
        result["html"] = html[:_HTML_CAP]
    return result


@router.get("/api/bugs/{human_id}/state")
async def bug_debug_state(human_id: str) -> dict[str, Any]:
    """The app's opt-in `window.__DEBUG_STATE__` snapshot from capture stop, parsed when it is
    valid JSON. 404 when the app under test exposed nothing."""
    doc = await load_bug(human_id)
    raw = doc.get("debugState")
    if not raw:
        # debugState is offloaded too — "the app exposed nothing" is only true if we could read
        # the evidence file to check.
        guard_offloaded(doc)
        raise HTTPException(404, f"bug {human_id} carries no debugState — the app under test did not expose window.__DEBUG_STATE__")
    try:
        return {"humanId": human_id, "state": json.loads(raw)}
    except (json.JSONDecodeError, TypeError):
        return {"humanId": human_id, "state_raw": str(raw)}
