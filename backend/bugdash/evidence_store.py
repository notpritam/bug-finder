# ABOUTME: Resolve a bug's offloaded evidence. To keep the Mongo document well under the 16MB limit
# ABOUTME: the dashboard uploads the heavy capture fields (network bodies, app state, cookies,
# ABOUTME: storage, browser log) to the file-storage service and leaves only `evidenceFileId` on the
# ABOUTME: doc. Agents read through the same endpoints as always; this fetches that one file and
# ABOUTME: merges the fields back in, so an offloaded bug is indistinguishable from an inline one to
# ABOUTME: a reader. Backward compatible: a bug with everything inline (no evidenceFileId) is a no-op.
import asyncio
import gzip
import json
import os
import urllib.request
from typing import Any

from fastapi import HTTPException

# Same storage service the frontend uploads to and domtime already reads rrweb from.
_STORAGE_API = os.environ.get("STORAGE_API_URL") or "https://storage-api-docs.internal.emergent.host/api"

# THIS CAP IS A MEMORY LIMIT, NOT A PREFERENCE. The API container runs with 512Mi. Parsing JSON
# into Python costs roughly 4-8x the wire bytes (every string, dict and list is a separate object),
# and FastAPI then serialises the merged document back out for the response - a second copy. A
# 60MB cap stood here initially and OOM-killed the container (exit 137) the first time a real
# capture was read: captures are uncapped by design, and a single console entry can carry a whole
# bundled source file. Raise this only together with the container's memory limit.
_FETCH_CAP_BYTES = 8_000_000

# Evidence files are immutable per id (a re-publish uploads a new file, a new id), so caching by id
# is always coherent. Agents drill the same bug across several endpoints back to back; without this
# each call would re-download the whole evidence file. ONE entry only: each is up to _FETCH_CAP_BYTES
# on the wire and several times that in memory, so holding four of them was itself an OOM.
_cache: dict[str, dict[str, Any]] = {}
_CACHE_MAX = 1


def download_url(file_id: str) -> str:
    """Where a reader can fetch the evidence itself when it is too large for us to inline."""
    return f"{_STORAGE_API}/files/{file_id}/download"


class EvidenceTooLarge(Exception):
    """The evidence file is real and reachable, but too big to parse inside the API's memory."""


def _fetch_json(url: str) -> Any:
    with urllib.request.urlopen(url, timeout=30) as res:  # noqa: S310 - fixed internal host
        # Check the advertised length before reading a byte, so an oversized file costs nothing.
        declared = res.headers.get("Content-Length")
        if declared and declared.isdigit() and int(declared) > _FETCH_CAP_BYTES:
            raise EvidenceTooLarge(f"{int(declared)} bytes exceeds the {_FETCH_CAP_BYTES}-byte inline limit")
        # Read one byte past the cap: enough to know we are over without holding the whole file.
        data = res.read(_FETCH_CAP_BYTES + 1)
        if len(data) > _FETCH_CAP_BYTES:
            del data
            raise EvidenceTooLarge(f"exceeds the {_FETCH_CAP_BYTES}-byte inline limit")
        # The extension gzips JSON artefacts before upload. Detect it from the magic bytes rather
        # than a filename or header, so files stored before that change still read unchanged.
        if data[:2] == b"\x1f\x8b":
            data = gzip.decompress(data)
            # The cap exists to protect memory, and decompression is exactly where memory grows:
            # a small gzip can expand into hundreds of megabytes. Re-check on the real size.
            if len(data) > _FETCH_CAP_BYTES:
                size = len(data)
                del data
                raise EvidenceTooLarge(f"expands to {size} bytes, over the {_FETCH_CAP_BYTES}-byte inline limit")
        return json.loads(data)


async def resolve_evidence(doc: dict[str, Any]) -> dict[str, Any]:
    """Merge a doc's offloaded heavy fields back in from storage.

    Best-effort and NON-fatal: on a fetch failure the light doc is returned unchanged with
    `_evidenceUnavailable` set, so metadata (title/status) still reads and a drill can report the
    fetch failure honestly instead of looking like an empty capture. Mutates and returns `doc`.
    """
    file_id = doc.get("evidenceFileId")
    if not file_id or doc.get("_evidenceResolved"):
        return doc
    key = str(file_id)
    try:
        heavy = _cache.get(key)
        if heavy is None:
            heavy = await asyncio.to_thread(_fetch_json, f"{_STORAGE_API}/files/{key}/download")
            if not isinstance(heavy, dict):
                raise ValueError("evidence file is not a JSON object")
            if len(_cache) >= _CACHE_MAX:
                _cache.pop(next(iter(_cache)))
            _cache[key] = heavy
        # Inline wins: an upload that failed may have left the real data on the doc. Only fill the
        # fields the doc does not already carry.
        for field, value in heavy.items():
            doc.setdefault(field, value)
        doc["_evidenceResolved"] = True
    except EvidenceTooLarge as err:
        # Not a failure of the capture — the evidence exists and is fetchable, just not by us.
        # Hand back the address so the caller can stream it directly instead of us dying trying.
        doc["_evidenceUnavailable"] = {
            "fileId": key,
            "error": f"evidence file too large to inline ({err})",
            "downloadUrl": download_url(key),
            "tooLarge": True,
        }
    except Exception as err:  # noqa: BLE001 - any fetch/parse failure is reported, never raised
        doc["_evidenceUnavailable"] = {
            "fileId": key,
            "error": str(err),
            "downloadUrl": download_url(key),
        }
    return doc


def evidence_unavailable(doc: dict[str, Any]) -> dict[str, Any] | None:
    """Set when a doc's evidence was offloaded to storage but could not be fetched — the difference
    between 'this capture has no cookies' and 'the cookies are in a file we couldn't reach'."""
    return doc.get("_evidenceUnavailable")


def guard_offloaded(doc: dict[str, Any]) -> None:
    """Raise a clear 502 when a field is missing because its evidence file could not be fetched, so
    'offloaded but storage is unreachable' never masquerades as 'this capture had nothing here'.

    Every reader of an offloaded key must call this before concluding the key is empty. Silence is
    the dangerous outcome: an agent handed a hollow report reasons confidently from no evidence,
    and a 404 saying 'this bug carries no cookies' is a statement the server cannot actually make
    while the file holding those cookies is unreachable.
    """
    unavailable = evidence_unavailable(doc)
    if not unavailable:
        return
    # 413 when it is simply bigger than we can hold, 502 when storage genuinely failed us: the
    # caller's next move differs. For 413 the evidence is intact and one GET away.
    if unavailable.get("tooLarge"):
        raise HTTPException(
            413,
            f"this capture's evidence is too large to serve inline ({unavailable['error']}). "
            f"Fetch it directly: {unavailable['downloadUrl']}",
        )
    raise HTTPException(
        502,
        f"evidence for this bug was offloaded to storage but could not be fetched "
        f"({unavailable['error']}); fileId={unavailable['fileId']}",
    )
