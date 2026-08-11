# ABOUTME: Rebuild web-storage writes the extension compacted before handing them to an agent. A
# ABOUTME: page whose analytics SDK rewrites its whole state blob per event produced a 53MB capture,
# ABOUTME: 48MB of it one key, which OOM-killed this service. The extension now drops each write's
# ABOUTME: oldValue when it is byte-identical to the previous write's newValue, and stores repeat
# ABOUTME: writes as RFC 6902 patches against the value before them. Nothing was discarded — this
# ABOUTME: puts the original strings back, so an agent never has to know compaction happened.
# ABOUTME: Mirrors extension/src/lib/storageCompact.ts and the dashboard's lib/storageCompact.ts.
import json
from typing import Any


def _unescape(token: str) -> str:
    """RFC 6901 pointer token: ~1 is '/', ~0 is '~', and in that order."""
    return token.replace("~1", "/").replace("~0", "~")


def _apply_op(doc: Any, op: dict[str, Any]) -> Any:
    """Apply one RFC 6902 op. Only add/remove/replace are produced by the extension's `compare`,
    but move/copy/test are handled so an unexpected op is never silently ignored."""
    kind = op.get("op")
    path = op.get("path", "")
    if kind in ("move", "copy"):
        source = _resolve(doc, op.get("from", ""))
        if kind == "move":
            doc = _apply_op(doc, {"op": "remove", "path": op.get("from", "")})
        return _apply_op(doc, {"op": "add", "path": path, "value": source})
    if kind == "test":
        if _resolve(doc, path) != op.get("value"):
            raise ValueError("test op failed")
        return doc

    tokens = [_unescape(t) for t in path.split("/")[1:]]
    if not tokens:
        return op.get("value") if kind in ("add", "replace") else None

    parent = doc
    for token in tokens[:-1]:
        parent = parent[int(token)] if isinstance(parent, list) else parent[token]
    leaf = tokens[-1]

    if isinstance(parent, list):
        if leaf == "-":
            parent.append(op["value"])
        elif kind == "add":
            parent.insert(int(leaf), op["value"])
        elif kind == "remove":
            parent.pop(int(leaf))
        else:
            parent[int(leaf)] = op["value"]
    elif kind == "remove":
        parent.pop(leaf, None)
    else:
        parent[leaf] = op["value"]
    return doc


def _resolve(doc: Any, path: str) -> Any:
    for token in (_unescape(t) for t in path.split("/")[1:]):
        doc = doc[int(token)] if isinstance(doc, list) else doc[token]
    return doc


def _slot(w: dict[str, Any]) -> str:
    """Per area, per origin, per key: two origins can hold the same key with different values, and
    sharing a baseline between them would corrupt both."""
    return f"{w.get('area')}|{w.get('origin') or ''}|{w.get('key') or ''}"


def expand_storage_changes(writes: list[Any]) -> list[Any]:
    """Restore full values. A no-op on uncompacted lists, so callers need not know which they hold."""
    last: dict[str, str] = {}
    out: list[Any] = []
    for entry in writes:
        if not isinstance(entry, dict):
            out.append(entry)
            continue
        w = dict(entry)
        slot = _slot(w)
        prev = last.get(slot)

        if w.pop("oldFromPrev", None) and prev is not None:
            w["oldValue"] = prev

        patch = w.pop("newPatch", None)
        if patch is not None and prev is not None:
            try:
                w["newValue"] = json.dumps(_apply_patch(json.loads(prev), patch), separators=(",", ":"))
            except Exception:  # noqa: BLE001
                # Leave newValue absent rather than invent one: a missing value is honest, a wrong
                # one sends a developer chasing state the page never held.
                pass

        if w.get("newValue") is not None:
            last[slot] = w["newValue"]
        elif w.get("op") in ("remove", "clear"):
            last.pop(slot, None)
        out.append(w)
    return out


def _apply_patch(doc: Any, patch: list[Any]) -> Any:
    for op in patch:
        doc = _apply_op(doc, op)
    return doc
