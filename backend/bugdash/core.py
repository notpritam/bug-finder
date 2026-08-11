# ABOUTME: Shared runtime — environment, Mongo handles, and tiny helpers every router uses.
# ABOUTME: Import from here instead of re-reading env or re-creating clients per module.
import os
from datetime import datetime, timezone
from typing import Any

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv()

EMERGENT_LLM_KEY = os.environ["EMERGENT_LLM_KEY"]
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]

_mongo = AsyncIOMotorClient(MONGO_URL)
db = _mongo[DB_NAME]
bugs_col = db["bugs"]
comments_col = db["bug_comments"]
initiatives_col = db["initiatives"]


def now_ms() -> int:
    return int(datetime.now(timezone.utc).timestamp() * 1000)


def clean_bug_doc(doc: dict[str, Any]) -> dict[str, Any]:
    """Strip Mongo internals before a doc leaves the API."""
    doc.pop("_id", None)
    return doc


def fmt_offset(ms: int | float | None) -> str:
    """Replay-clock offset as m:ss — how every timeline reference in summaries reads."""
    if ms is None:
        return "?"
    ms = int(ms)
    s = abs(ms) // 1000
    sign = "-" if ms < 0 else ""
    return f"{sign}{s // 60}:{s % 60:02d}"
