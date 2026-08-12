# ABOUTME: Pure evidence shaping — turns the raw capture arrays stored on a bug doc into the
# ABOUTME: deduped/indexed/clipped forms the summary, the drill endpoints, and the AI fill consume.
from typing import Any
from urllib.parse import urlparse

from .core import fmt_offset

# A capture can hold hundreds of identical React warnings (BF-107: 108× the same duplicate-key
# line). Dedupe by (level, text) with counts so 25 slots of budget describe 25 DISTINCT problems,
# and keep the first stack seen — stacks for the same message differ only in noise.


def clip_text(s: str | None, cap: int) -> str:
    if not s:
        return ""
    s = str(s)
    return s if len(s) <= cap else s[:cap] + "…"


def dedupe_console(entries: list[dict[str, Any]], levels: set[str]) -> list[dict[str, Any]]:
    """Group console entries of the given levels by exact text; order by first occurrence."""
    grouped: dict[tuple[str, str], dict[str, Any]] = {}
    for c in entries:
        level = str(c.get("level", "log"))
        if level not in levels:
            continue
        text = str(c.get("text", ""))
        key = (level, text)
        slot = grouped.get(key)
        if slot is None:
            grouped[key] = {
                "level": level,
                "text": text,
                "stack": c.get("stack") or None,
                "count": 1,
                "firstT": c.get("t"),
                "lastT": c.get("t"),
            }
        else:
            slot["count"] += 1
            slot["lastT"] = c.get("t")
            if not slot["stack"] and c.get("stack"):
                slot["stack"] = c["stack"]
    return sorted(grouped.values(), key=lambda g: (g["firstT"] is None, g["firstT"]))


def is_api_call(n: dict[str, Any]) -> bool:
    return n.get("type") in ("fetch", "xhr")


def network_index(net: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Slim per-entry index keyed by the entry's position `i` in the stored array — `i` is the
    drill key for GET /api/bugs/{id}/network/{i}. API calls plus anything that failed; the
    resource-timing noise (slow images, fonts) stays out unless it errored."""
    out: list[dict[str, Any]] = []
    for i, n in enumerate(net):
        status = n.get("status")
        failed = isinstance(status, int) and (status == 0 or status >= 400)
        if not is_api_call(n) and not failed:
            continue
        out.append(
            {
                "i": i,
                "t": n.get("t"),
                "method": n.get("method"),
                "url": clip_text(n.get("url"), 300),
                "status": status,
                "durationMs": n.get("durationMs"),
                "sizeBytes": n.get("sizeBytes"),
                "hasRequestBody": bool(n.get("requestBody")),
                "hasResponseBody": bool(n.get("responseBody")),
            }
        )
    return out


def _path_of(url: str) -> str:
    """Origin-relative path without query — the identity reviewers think in."""
    u = url.split("?", 1)[0]
    for sep in ("://",):
        if sep in u:
            u = u.split(sep, 1)[1]
            u = "/" + u.split("/", 1)[1] if "/" in u else "/"
    return u


def api_rollup(net: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """One row per (method, path): every endpoint the page talked to, its statuses, and where
    to drill. This is how an agent finds the response that CONTAINS the bad data — the broken
    render usually came from a 200, not from the one visible 4xx."""
    rows: dict[tuple[str, str], dict[str, Any]] = {}
    for i, n in enumerate(net):
        if not is_api_call(n):
            continue
        method = str(n.get("method", "?"))
        path = _path_of(str(n.get("url", "")))
        key = (method, path)
        slot = rows.get(key)
        if slot is None:
            rows[key] = {
                "method": method,
                "path": path,
                "count": 1,
                "statuses": {n.get("status")},
                "worstMs": n.get("durationMs") or 0,
                "indexes": [i],
            }
        else:
            slot["count"] += 1
            slot["statuses"].add(n.get("status"))
            slot["worstMs"] = max(slot["worstMs"], n.get("durationMs") or 0)
            if len(slot["indexes"]) < 3:
                slot["indexes"].append(i)
    out = []
    for row in rows.values():
        row["statuses"] = sorted(s for s in row["statuses"] if s is not None)
        out.append(row)
    out.sort(key=lambda r: (-max([s for s in r["statuses"] if isinstance(s, int)] or [0]), -r["count"]))
    return out


def layout_lines(layout: Any) -> list[str]:
    """Markdown lines for the layout-debugger evidence the extension pulls off pages that expose
    window.__layoutDebug (slot table + overlap verdicts) and window.__rowLedger (measurement
    history). Written for an agent: verdicts first, then only the slots that disagree."""
    if not isinstance(layout, dict):
        return []
    lines: list[str] = []
    snapshot = layout.get("snapshot") or {}
    issues = snapshot.get("virtualRowIssues") or []
    rows = snapshot.get("virtualRows") or []
    ledger = layout.get("rowLedgerTail") or []
    if issues:
        lines.append(f"{len(issues)} verdict(s) from the page's layout debugger:")
        for issue in issues[:10]:
            lines.append(
                f"- **{issue.get('severity','?').upper()} {issue.get('kind','?')}** · index {issue.get('index')} · "
                f"{issue.get('amountPx')}px — {issue.get('detail','')}"
            )
    else:
        lines.append("Layout debugger was active; no overlap/gap verdicts at capture time.")
    # Two slot shapes exist in the wild: the overlay's Copy payload flattens rows
    # ({index, label, realHeight, ...}), while the extension's auto-pull ships snapshot()
    # verbatim — VirtualRowSlot objects with the row nested ({row: {index, label, height}, delta}).
    def _slot_fields(s: dict[str, Any]) -> dict[str, Any]:
        row = s.get("row") if isinstance(s.get("row"), dict) else s
        return {
            "index": row.get("index"),
            "label": row.get("label", ""),
            "reserved": s.get("reserved"),
            "real": s.get("realHeight", row.get("height")),
            "delta": s.get("delta"),
        }

    bad_slots = [
        _slot_fields(s) for s in rows
        if isinstance(s, dict) and isinstance(s.get("delta"), (int, float)) and abs(s["delta"]) > 1
    ]
    if bad_slots:
        lines.append("")
        lines.append("Rows whose real height disagrees with their reserved slot (`delta` px):")
        for s in bad_slots[:12]:
            lines.append(
                f"- idx {s['index']} `{s['label']}` — reserved {s['reserved']}px, "
                f"real {s['real']}px, delta {s['delta']}px"
            )
    if ledger:
        lines.append("")
        lines.append(f"Measurement ledger tail attached ({len(ledger)} events) — full copy in the bug JSON `layoutDebug.rowLedgerTail`.")
    return lines


def console_md(deduped: list[dict[str, Any]], budget: int, stack_budget: int) -> list[str]:
    """Markdown for deduped console groups: one line each, plus fenced stacks for the first few
    groups that carry one — the stack is what names the owning component."""
    lines: list[str] = []
    stacks_shown = 0
    for g in deduped[:budget]:
        count = f" ×{g['count']}" if g["count"] > 1 else ""
        lines.append(f"- `{fmt_offset(g['firstT'])}`{count} {clip_text(g['text'], 400)}")
        if g.get("stack") and stacks_shown < stack_budget:
            stacks_shown += 1
            stack_head = "\n".join(str(g["stack"]).splitlines()[:12])
            lines.append("  ```")
            for stack_line in stack_head.splitlines():
                lines.append(f"  {stack_line}")
            lines.append("  ```")
    return lines


# ------------------- app build + picked-element rendering -------------------

def site_of(host: str) -> str:
    """eTLD+1, near enough. `ap.emergent.sh` and `app.emergent.sh` are one product;
    `analytics.tiktok.com` is not. Two labels misjudges `co.uk`-style suffixes and errs toward
    calling something first-party — the failure worth avoiding is hiding the app's own error."""
    return ".".join(host.split(".")[-2:])


def is_first_party(url: str, site: str) -> bool:
    if not site:
        return True  # unknown page origin — never hide anything on a guess
    try:
        host = urlparse(url).hostname or ""
    except ValueError:
        return False
    return bool(host) and site_of(host) == site


def script_lines(scripts: Any, human_id: str) -> list[str]:
    """Only the app's own chunk URLs are evidence — they map a minified stack to the deployed
    bundle. The extension now sends {firstParty, thirdPartyCount}; bugs filed before that sent one
    flat list with the app bundle buried among every ad pixel on the page, so both shapes render."""
    if isinstance(scripts, dict):
        first = [s for s in (scripts.get("firstParty") or []) if isinstance(s, str)]
        third = scripts.get("thirdPartyCount") or 0
        out = [f"- app chunk: `{s}`" for s in first[:8]]
        if len(first) > 8:
            out.append(f"- …and {len(first) - 8} more first-party chunk(s)")
        if third:
            out.append(f"- {third} third-party script(s) (ads/analytics) — not listed")
        return out
    if isinstance(scripts, list) and scripts:
        return [f"- {len(scripts)} script chunk(s) loaded — full URLs in `/api/bugs/{human_id}` `appInfo.scripts`"]
    return []


def pick_px(p: dict[str, Any], viewport: Any) -> dict[str, float] | None:
    """The pick's box in CSS pixels. New captures carry `px` outright; older ones only stored the
    viewport-NORMALISED rect, so multiply it back. Worth the branch: it makes every bug already
    in the database readable, and the normalised form is exactly what made BF-108 hard to read
    (its two picks both recorded h=0.08878504672897196, which is 76px said the long way)."""
    px = p.get("px")
    if isinstance(px, dict):
        return {k: v for k, v in px.items() if isinstance(v, (int, float))}
    rect = p.get("rect")
    if not isinstance(rect, dict) or not isinstance(viewport, dict):
        return None
    vw, vh = viewport.get("w"), viewport.get("h")
    if not isinstance(vw, (int, float)) or not isinstance(vh, (int, float)):
        return None
    out: dict[str, float] = {}
    for key, extent in (("x", vw), ("w", vw), ("y", vh), ("h", vh)):
        v = rect.get(key)
        if isinstance(v, (int, float)):
            out[key] = round(v * extent, 1)
    return out or None


def _box_str(b: Any) -> str | None:
    if not isinstance(b, dict):
        return None
    return f"{b.get('w')}×{b.get('h')} at ({b.get('x')}, {b.get('y')})"


def pick_detail_lines(p: dict[str, Any], viewport: Any = None) -> list[str]:
    """The context around one pick. An element that looks collapsed is usually a correct element
    in a wrong slot, so the ancestor heights and the hit-test answer what a rect alone cannot."""
    out: list[str] = []
    box = _box_str(pick_px(p, viewport))
    if box:
        sizes = [f"{k} {p[k]}" for k in ("offsetHeight", "scrollHeight", "offsetWidth", "scrollWidth")
                 if p.get(k) is not None]
        out.append(f"  - box: {box} px" + (f" · {' · '.join(sizes)}" if sizes else ""))
        # Say it, rather than leaving it to be spotted. A row of buttons wider than the strip
        # holding it is one of the commonest CSS bugs, and two numbers a reader has to subtract is
        # the difference between evidence and a pile of measurements.
        for axis, content, visible in (("horizontally", "scrollWidth", "clientWidth"),
                                       ("vertically", "scrollHeight", "clientHeight")):
            need, have = p.get(content), p.get(visible)
            if isinstance(need, (int, float)) and isinstance(have, (int, float)) and need > have + 1:
                out.append(f"  - ⚠ **content overflows {axis}** — needs {need}px, has {have}px "
                           f"({int(need - have)}px cut off or scrolled)")
    overlap = p.get("overlap")
    if isinstance(overlap, dict):
        covered = overlap.get("covered") or []
        if covered:
            who = ", ".join(f"`{c.get('selector')}` (at {c.get('at')})" for c in covered[:3])
            out.append(f"  - ⚠ **covered by** {who} — not visible to the reporter at that point")
        else:
            out.append(f"  - not covered (hit-tested {overlap.get('probed')} point(s))")
    clip = p.get("clip")
    if isinstance(clip, dict):
        sides = ", ".join(f"{k} {clip[k]}px" for k in ("top", "right", "bottom", "left") if clip.get(k))
        if sides:
            out.append(f"  - ⚠ **clipped** by `{clip.get('by')}` — {sides} outside it")
    components = [c for c in (p.get("components") or []) if isinstance(c, dict) and c.get("name")]
    if components:
        rendered = " ← ".join(
            f"`{c['name']}`" + (f" ({c['source']})" if c.get("source") else "") for c in components[:5]
        )
        out.append(f"  - rendered by: {rendered}")
    for a in (p.get("ancestors") or [])[:4]:
        if not isinstance(a, dict):
            continue
        data = a.get("data") or {}
        attrs = " ".join(f"{k}={v}" for k, v in list(data.items())[:3])
        overflow = a.get("overflow")
        out.append(
            f"  - ↑ `{a.get('tag')}{('#' + a['id']) if a.get('id') else ''}`"
            f" h={a.get('offsetHeight')} scrollH={a.get('scrollHeight')}"
            # Widths only when they disagree — on most ancestors they do not, and a chain of
            # identical numbers is what stops people reading the chain.
            + (f" w={a.get('offsetWidth')} scrollW={a.get('scrollWidth')}"
               if isinstance(a.get("scrollWidth"), (int, float))
               and isinstance(a.get("offsetWidth"), (int, float))
               and a["scrollWidth"] > a["offsetWidth"] + 1 else "")
            + (f" overflow={overflow}" if overflow and overflow != "visible" else "")
            + (f" [{attrs}]" if attrs else "")
        )
    return out


def compare_lines(picked: list[Any], viewport: Any = None) -> list[str]:
    """A pick captured through "Compare with" carries `comparesTo`: the id of the pick it is the
    intended reference for. Appearance bugs are nearly always comparative ("the member message is
    not capped like the user message") and two DIFFERENT selectors never pair on their own, so
    without this the reference half of the complaint lives only in prose."""
    by_id = {p["id"]: p for p in picked if isinstance(p, dict) and p.get("id")}
    out: list[str] = []
    for ref in picked:
        if not isinstance(ref, dict):
            continue
        subject = by_id.get(ref.get("comparesTo") or "")
        if not subject:
            continue
        a, b = pick_px(subject, viewport), pick_px(ref, viewport)
        if not isinstance(a, dict) or not isinstance(b, dict):
            continue
        out.append(f"- **Reported as wrong vs a reference** — `{subject.get('selector')}` should match `{ref.get('selector')}`")
        if subject.get("note"):
            out.append(f"  - reporter: “{subject['note']}”")
        for key, label in (("w", "width"), ("h", "height")):
            av, bv = a.get(key), b.get(key)
            if not isinstance(av, (int, float)) or not isinstance(bv, (int, float)):
                continue
            verdict = "same" if av == bv else f"{round(av - bv, 1):+g} vs reference"
            out.append(f"  - {label}: subject {av} · reference {bv} ({verdict})")
        for who, p in (("subject", subject), ("reference", ref)):
            styles = p.get("styles")
            if isinstance(styles, dict) and styles:
                shown = ", ".join(f"{k}: {v}" for k, v in list(styles.items())[:6])
                out.append(f"  - {who} styles: {shown}")
    return out


def pick_delta_lines(picked: list[Any], viewport: Any = None) -> list[str]:
    """Two picks of the SAME selector are a before/after: the reporter captured one state, did
    something, captured the other. That diff IS the finding, so compute it instead of leaving two
    rects for the reader to subtract by hand and hope they notice which number stayed still."""
    by_selector: dict[str, list[dict[str, Any]]] = {}
    for p in picked:
        if isinstance(p, dict) and p.get("comparesTo"):
            continue  # belongs to compare_lines, not to the same-selector before/after
        if isinstance(p, dict) and p.get("selector"):
            by_selector.setdefault(p["selector"], []).append(p)
    out: list[str] = []
    for selector, group in by_selector.items():
        if len(group) < 2:
            continue
        first, last = group[0], group[-1]
        a, b = pick_px(first, viewport), pick_px(last, viewport)
        if not isinstance(a, dict) or not isinstance(b, dict):
            continue
        out.append(f"- **Same element picked {len(group)}×** — `{selector}`")
        note_a, note_b = first.get("note"), last.get("note")
        if note_a or note_b:
            out.append(f"  - notes: “{note_a or '—'}” → “{note_b or '—'}”")
        for key, label in (("w", "width"), ("h", "height"), ("x", "x"), ("y", "y")):
            av, bv = a.get(key), b.get(key)
            if not isinstance(av, (int, float)) or not isinstance(bv, (int, float)):
                continue
            d = round(bv - av, 1)
            out.append(f"  - {label}: {av} → {bv} ({'unchanged' if d == 0 else format(d, '+g')})")
        if a.get("h") == b.get("h") and a.get("w") != b.get("w"):
            out.append(
                "  - ⚠ the element's own height did NOT change — if it looks collapsed, what changed "
                "is the slot around it, not the element"
            )
    return out
