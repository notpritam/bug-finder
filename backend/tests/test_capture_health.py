# ABOUTME: The extension's own crash report has to survive the trip. It is written in the
# ABOUTME: reporter's browser, rides out on a capture that files successfully, and is the ONLY
# ABOUTME: channel by which an extension crash reaches anyone who could fix it — so a silent drop
# ABOUTME: anywhere on this path makes every report claim a healthy capture whether or not it was.
# ABOUTME: Run: python backend/tests/test_capture_health.py
import json
import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from bugdash.capture_health import capture_health, capture_health_lines  # noqa: E402

FRONTEND = pathlib.Path(__file__).resolve().parents[2] / "frontend" / "src" / "lib"

passed = 0
failed = []


def check(name, cond, detail=""):
    global passed
    if cond:
        passed += 1
        print(f"  ok  - {name}" + (f"\n      → {detail}" if detail else ""))
    else:
        failed.append(name)
        print(f"  NOT OK - {name}" + (f"\n      → {detail}" if detail else ""))


DIAG = {
    "extensionVersion": "0.2.1",
    "captureSchemaVersion": 5,
    "packagedInMs": 1840,
    "durationMs": 41_000,
    "counts": {"replay": 210, "console": 44, "network": 96, "stateChanges": 300,
               "storageChanges": 12, "rrwebEvents": 5_100, "harEntries": 96},
    "bytes": {"network": 8_400_000, "cdpBodyBytes": 31_000_000, "cdpBodyBytesDropped": 4_100_000},
    "degradations": ["app-state source redux-0 demoted to snapshot-at-stop — live tracking was pegging the main thread"],
    "memory": {"usedJsHeapMb": 412, "jsHeapLimitMb": 4096},
    "recentErrors": [{"at": 1_700_000_000_000, "where": "service-worker.collectDeepCapture",
                      "message": "Debugger is not attached to the tab with id: 42"}],
}

print("capture health reaches a reader")

# --- the frontend must carry the field at all ---------------------------------------------------
# This is where it was lost: both draft→bug mappings enumerate their fields explicitly, and the
# extension had been attaching diagnostics to every capture that neither list mentioned.
drafts_ts = (FRONTEND / "drafts.ts").read_text()
keys = re.search(r"const DEEP_CAPTURE_KEYS = \[(.*?)\] as const", drafts_ts, re.S)
check("the dashboard's draft→bug passthrough names `diagnostics`",
      bool(keys) and '"diagnostics"' in keys.group(1))

offloaded = re.search(r"export const OFFLOADED_EVIDENCE_KEYS = \[(.*?)\] as const", drafts_ts, re.S)
check("and does NOT offload it with the heavy evidence",
      bool(offloaded) and '"diagnostics"' not in offloaded.group(1),
      "it must stay inline on the document — being readable without a fetch is the whole point")

check("the Bug type declares it", "diagnostics?: CaptureDiagnostics" in (FRONTEND / "types.ts").read_text())

# --- the MCP directory view ---------------------------------------------------------------------
health = capture_health(DIAG)
check("the agent view reports the extension build", health["extensionVersion"] == "0.2.1")
check("it surfaces what the capture gave up", health["degradations"] == DIAG["degradations"])
check("it surfaces the extension's OWN errors",
      len(health["extensionErrors"]) == 1
      and health["extensionErrors"][0]["where"] == "service-worker.collectDeepCapture")
check("stacks do not travel — the message and the site are what triage needs",
      "stack" not in health["extensionErrors"][0])
check("the numbers that predict an out-of-memory kill travel too",
      health["bytes"]["cdpBodyBytesDropped"] == 4_100_000 and health["memory"]["usedJsHeapMb"] == 412)

# Absent, not zeroed: a row of zeroes on a capture that never carried diagnostics would read as
# a clean run, which is the one thing it must never claim.
check("a capture with no diagnostics reports nothing rather than health",
      capture_health(None) is None and capture_health("garbage") is None)

# --- the markdown briefing, which is what get_session actually returns ---------------------------
md = "\n".join(capture_health_lines(DIAG))
check("the briefing names the extension build", "v0.2.1" in md)
check("the briefing warns that evidence was given up", "Evidence given up" in md and "pegging the main thread" in md)
check("the briefing reports the extension error", "Extension error" in md and "collectDeepCapture" in md)
check("it says whose fault a gap is not",
      "not to the page under test" in md,
      "a thin report and a broken capture look identical without this")

clean = {**DIAG, "degradations": [], "recentErrors": []}
check("a clean run says nothing at all",
      capture_health_lines(clean) == [],
      "a health section on every report trains the reader to skip it")
check("a capture with no diagnostics says nothing", capture_health_lines(None) == [])

print(f"\n{passed} checks passed" if not failed else f"\nFAILED: {json.dumps(failed, indent=2)}")
sys.exit(1 if failed else 0)
