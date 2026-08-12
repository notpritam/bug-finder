# ABOUTME: Where the extension asks whether it is out of date. Needed because the shared build is
# ABOUTME: loaded unpacked, and Chrome does not update those — chrome.runtime.onUpdateAvailable
# ABOUTME: never fires for them, so the in-extension update notice would sit silent forever on
# ABOUTME: exactly the installs that have no other way to hear about a new build.
from typing import Any

from fastapi import APIRouter

from .core import db

router = APIRouter()

releases_col = db["bf_extension_release"]

#: The build this dashboard expects. Bumped when a new extension ships. A row in
#: bf_extension_release overrides it, so a release can be announced without redeploying the API —
#: the dashboard and the extension ship on different clocks and always will.
FALLBACK = {
    "version": "0.2.3",
    # Served by the dashboard, not GitHub: the extension repo is private, so a release link
    # 404s for every person it would be shared with. The dashboard is the one place everyone
    # already has access to — they need it to see the bug they just filed.
    "downloadUrl": "/bug-finder-0.2.3.zip",
    "installUrl": "/connect",
    "notes": "Finds out when it is out of date — a build loaded unpacked is never updated by Chrome.",
    "minSupported": "0.2.0",
}


@router.get("/api/extension/latest")
async def latest() -> dict[str, Any]:
    """Unauthenticated on purpose: an extension that has not been signed into yet still needs to
    be able to find out it is three versions behind."""
    doc = await releases_col.find_one({"_id": "current"})
    if not doc:
        return FALLBACK
    doc.pop("_id", None)
    return {**FALLBACK, **doc}
