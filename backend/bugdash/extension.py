# ABOUTME: Where the extension asks whether it is out of date. Needed because the shared build is
# ABOUTME: loaded unpacked, and Chrome does not update those — chrome.runtime.onUpdateAvailable
# ABOUTME: never fires for them, so the in-extension update notice would sit silent forever on
# ABOUTME: exactly the installs that have no other way to hear about a new build.
from typing import Any

from fastapi import APIRouter

from .core import db

router = APIRouter()

releases_col = db["bf_extension_release"]

#: The build this dashboard expects.
#:
#: This is now a FALLBACK in the literal sense. Since 0.2.6 the extension asks GitHub first —
#: github.com/notpritam/bug-finder-releases/releases/latest/download/latest.json — and only falls
#: back to this endpoint when that is unreachable. Both are tried, so neither one being down
#: blinds an install.
#:
#: Publishing a build therefore no longer touches this file, or this repo, or the pod. What the
#: dashboard keeps is the ability to OVERRIDE: a row in bf_extension_release wins over everything
#: below, which is how a bad build gets pinned or rolled back without cutting another release.
#: Keep the version here roughly in step anyway — an endpoint that lies about the current build is
#: worse than one that is merely redundant.
FALLBACK = {
    "version": "0.2.6",
    # Points at the GitHub release rather than a file in this repo. The earlier comment here said
    # GitHub was impossible because "the extension repo is private" — true of the SOURCE repo, but
    # the releases repo is public precisely so the download does not need to live in the dashboard.
    # The old /bug-finder-*.zip files stay served so links already shared keep working; nothing new
    # gets committed here.
    "downloadUrl": "https://github.com/notpritam/bug-finder-releases/releases/latest/download/bug-finder-0.2.6.zip",
    "installUrl": "/connect",
    "notes": (
        "Works properly in responsive / device mode: the recording pill only revealed its actions "
        "on hover, which touch and device emulation do not have, so on a narrow viewport the "
        "buttons never appeared at all. It now folds down to the timer, a way into the side panel "
        "and Stop when the row will not fit, and opens on tap where there is room. Compare moved "
        "into the side panel. Also adds a light theme — System, Light or Dark from the panel "
        "header — across the panel and the in-page overlays. If you are on anything older than "
        "0.2.4, remove it before loading this — 0.2.4 pinned the extension ID, so Chrome treats "
        "the two as separate extensions and both would try to record."
    ),
    # 0.2.4 is the first build with a `key`, so it is the first one whose ID is stable. Anything
    # older installed unpacked has a path-derived ID that no update can ever reach; the note above
    # is the only migration path those installs have.
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
