# ABOUTME: The extension's report on its own run — shaped for an agent, and rendered for the
# ABOUTME: markdown briefing. Deliberately free of framework and database imports so it can be
# ABOUTME: exercised from a fixture; the path this travels is one where a silent drop makes every
# ABOUTME: report claim a healthy capture, so it is worth being able to test without a browser.
from typing import Any


def capture_health(diag: Any) -> dict[str, Any] | None:
    """The extension's report on its own run, flattened for an agent. None on captures made before
    the extension carried one — absent, rather than a row of zeroes that would read as "healthy"."""
    if not isinstance(diag, dict):
        return None
    errors = diag.get("recentErrors") or []
    degradations = diag.get("degradations") or []
    return {
        "extensionVersion": diag.get("extensionVersion"),
        "packagedInMs": diag.get("packagedInMs"),
        # Empty means a clean run: nothing was given up to stay inside memory.
        "degradations": degradations,
        # Errors thrown inside the EXTENSION, never the page under test. Anything here means the
        # capture may be incomplete for a reason the page is not responsible for.
        "extensionErrors": [
            {"where": e.get("where"), "message": e.get("message"), "at": e.get("at")}
            for e in errors
            if isinstance(e, dict)
        ],
        "counts": diag.get("counts"),
        "bytes": diag.get("bytes"),
        "memory": diag.get("memory"),
    }


def capture_health_lines(diag: Any) -> list[str]:
    """What the extension has to say about its own run.

    Silent on a clean capture, because a health section on every report would train the reader to
    skip it. It speaks for the two cases where a gap in the evidence is NOT the page's fault: the
    capture gave something up to stay inside memory, or the extension itself threw. The second is
    the important one — those errors are recorded in the reporter's browser and reach nobody
    unless a later capture files successfully and carries them out.
    """
    if not isinstance(diag, dict):
        return []
    degradations = [d for d in (diag.get("degradations") or []) if d]
    errors = [e for e in (diag.get("recentErrors") or []) if isinstance(e, dict)]
    if not degradations and not errors:
        return []

    lines = ["## Capture health", ""]
    version = diag.get("extensionVersion")
    lines.append(
        f"Recorded by Bug Finder v{version}. Anything below happened to the CAPTURE, not to the "
        f"page under test — read a gap in the evidence against it before concluding the page was quiet."
        if version
        else "Anything below happened to the CAPTURE, not to the page under test."
    )
    lines.append("")
    for d in degradations:
        lines.append(f"- **⚠ Evidence given up:** {d}")
    for e in errors[-10:]:
        lines.append(f"- **✖ Extension error** in `{e.get('where')}`: {e.get('message')}")
    lines.append("")
    return lines
