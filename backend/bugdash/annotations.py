# ABOUTME: Flags added to a session AFTER it was filed. Deliberately not the same field as
# ABOUTME: `markers`: those are capture — what the reporter flagged live, or an error the recording
# ABOUTME: caught — and EDITABLE_FIELDS excludes every capture field because nothing in the UI may
# ABOUTME: rewrite the evidence. A mark made in triage three days later is a different claim about
# ABOUTME: the world, so it gets its own list, with an author and a time on every entry. The replay
# ABOUTME: draws both on one timeline; the provenance is what stays distinguishable underneath.
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pymongo import ReturnDocument

from . import events as feed
from .auth import is_admin_doc, require_user
# Same projection as every other bug route — never ship the heavy capture back on a write that
# only touched a one-line annotation. (bugs.py does not import this module, so no cycle.)
from .bugs import LIGHT
from .core import bugs_col, now_ms
from .models import AnnotationInput, AnnotationPatch

router = APIRouter()

#: A label has to fit on a timeline pin and in a summary line. Longer belongs in a comment, which
#: is a thread and renders as one.
MAX_LABEL = 200


def _actor(user: dict[str, Any]) -> dict[str, Any]:
    return {"id": user.get("id"), "name": user.get("name") or user.get("email") or "Someone"}


def _may_edit(annotation: dict[str, Any], user: dict[str, Any]) -> bool:
    """Authors edit and delete their own; admins can clean up anyone's.

    Not 'any signed-in user', which is what the first draft of this did: an annotation carries a
    name, so letting a stranger rewrite the text under someone else's name puts words in their
    mouth on a record other people are making decisions from.
    """
    return annotation.get("by", {}).get("id") == user.get("id") or is_admin_doc(user)


async def _load(human_id: str) -> dict[str, Any]:
    doc = await bugs_col.find_one({"humanId": human_id}, LIGHT)
    if not doc:
        raise HTTPException(404, f"bug {human_id} not found")
    return doc


def _find(doc: dict[str, Any], annotation_id: str) -> dict[str, Any]:
    for a in doc.get("annotations") or []:
        if a.get("id") == annotation_id:
            return a
    raise HTTPException(404, f"annotation {annotation_id} not found")


@router.post("/api/bugs/{human_id}/annotations")
async def add_annotation(
    human_id: str,
    body: AnnotationInput,
    user: dict[str, Any] = Depends(require_user),
) -> dict[str, Any]:
    """Pin a moment on an already-filed session.

    `t` is the replay clock in ms and MAY be negative — the pre-roll window sits before zero, and
    the thing worth flagging is often in it, so this must not be validated as non-negative.
    """
    await _load(human_id)
    label = body.label.strip()
    if not label:
        raise HTTPException(400, "An annotation needs a label — say what happens here.")

    annotation = {
        "id": f"an-{uuid.uuid4().hex[:10]}",
        "t": int(body.t),
        "label": label[:MAX_LABEL],
        "by": _actor(user),
        "at": now_ms(),
    }
    now = annotation["at"]
    #: $push rather than a whole-array $set, so two people pinning different moments at the same
    #: time both land — the same reason patch_bug is field-level.
    fresh = await bugs_col.find_one_and_update(
        {"humanId": human_id},
        {
            "$push": {
                "annotations": annotation,
                "events": {
                    "id": f"e-{uuid.uuid4().hex[:10]}",
                    "actor": annotation["by"]["name"],
                    "kind": "annotated",
                    "detail": f"flagged {_fmt(annotation['t'])} — {annotation['label']}",
                    "at": now,
                },
            },
            "$set": {"updatedAt": now, "_updatedAt": now},
        },
        projection=LIGHT,
        return_document=ReturnDocument.AFTER,
    )
    await feed.record(
        "annotation",
        summary=f"{human_id}: flagged {_fmt(annotation['t'])} — {annotation['label']}",
        bug_human_id=human_id,
        initiative_id=(fresh or {}).get("initiativeId"),
        actor_id=user.get("id"),
        actor_name=annotation["by"]["name"],
    )
    return annotation


@router.patch("/api/bugs/{human_id}/annotations/{annotation_id}")
async def edit_annotation(
    human_id: str,
    annotation_id: str,
    body: AnnotationPatch,
    user: dict[str, Any] = Depends(require_user),
) -> dict[str, Any]:
    """Reword a pin. `t` is fixed once placed — moving it would silently change which frame the
    text refers to, and everyone who already read it saw the old pairing."""
    doc = await _load(human_id)
    existing = _find(doc, annotation_id)
    if not _may_edit(existing, user):
        raise HTTPException(403, "You can only edit annotations you added.")
    label = body.label.strip()
    if not label:
        raise HTTPException(400, "An annotation needs a label — delete it instead of blanking it.")

    now = now_ms()
    await bugs_col.update_one(
        {"humanId": human_id, "annotations.id": annotation_id},
        {"$set": {"annotations.$.label": label[:MAX_LABEL], "annotations.$.editedAt": now,
                  "updatedAt": now, "_updatedAt": now}},
    )
    return {**existing, "label": label[:MAX_LABEL], "editedAt": now}


@router.delete("/api/bugs/{human_id}/annotations/{annotation_id}")
async def delete_annotation(
    human_id: str,
    annotation_id: str,
    user: dict[str, Any] = Depends(require_user),
) -> dict[str, str]:
    doc = await _load(human_id)
    existing = _find(doc, annotation_id)
    if not _may_edit(existing, user):
        raise HTTPException(403, "You can only delete annotations you added.")
    now = now_ms()
    await bugs_col.update_one(
        {"humanId": human_id},
        {"$pull": {"annotations": {"id": annotation_id}}, "$set": {"updatedAt": now, "_updatedAt": now}},
    )
    return {"ok": "deleted"}


def _fmt(ms: int) -> str:
    """m:ss, matching how every other timeline reference in this codebase reads. Negative stays
    negative — that is the pre-roll, and '-0:12' is meaningfully different from '0:12'."""
    s = abs(int(ms)) // 1000
    return f"{'-' if ms < 0 else ''}{s // 60}:{s % 60:02d}"
