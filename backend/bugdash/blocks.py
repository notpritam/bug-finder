# ABOUTME: Structured agent comments — the typed blocks an agent posts and the dashboard renders.
# ABOUTME: Everything here is sanitized at WRITE time, so the stored document is safe for every
# ABOUTME: consumer that ever reads it: the renderer, the markdown briefing, a future digest. A
# ABOUTME: sanitizer that runs at render time has to be remembered by each new reader; this one
# ABOUTME: cannot be forgotten. Stdlib only, so it can be exercised without a browser or a database.
from __future__ import annotations

import re
from html import escape
from html.parser import HTMLParser
from typing import Any

# --------------------------------------------------------------------------- the allowlist

#: Prose, tables, and a tight inline-SVG subset. Anything absent is dropped.
ALLOWED_TAGS = {
    "p", "br", "hr", "div", "span", "section", "article",
    "h1", "h2", "h3", "h4", "h5", "h6",
    "ul", "ol", "li", "dl", "dt", "dd",
    "blockquote", "pre", "code", "kbd", "samp", "var",
    "strong", "b", "em", "i", "u", "s", "del", "ins", "mark", "small", "sub", "sup", "abbr",
    "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption", "colgroup", "col",
    "a", "img", "figure", "figcaption",
    # SVG: shapes and paint only. No foreignObject (arbitrary HTML), no use/image (external
    # references), no animate/set (scriptable), no script.
    "svg", "g", "path", "circle", "ellipse", "rect", "line", "polyline", "polygon",
    "text", "tspan", "defs", "marker", "lineargradient", "radialgradient", "stop", "title",
}

#: Tags whose *contents* are dropped as well as the tag — text inside a <script> is not prose.
DROP_WITH_CONTENT = {"script", "style", "iframe", "object", "embed", "template", "noscript",
                     "form", "input", "button", "select", "textarea", "foreignobject"}

VOID_TAGS = {"br", "hr", "img", "col", "path", "circle", "ellipse", "rect", "line",
             "polyline", "polygon", "stop"}

#: Attributes allowed on any tag. `id` is deliberately absent — an agent-authored id can collide
#: with the dashboard's own and silently retarget a label or an anchor.
GLOBAL_ATTRS = {"class", "title", "dir", "lang", "style", "role", "aria-label"}

PER_TAG_ATTRS: dict[str, set[str]] = {
    "a": {"href", "target", "rel"},
    "img": {"src", "alt", "width", "height", "loading"},
    "td": {"colspan", "rowspan", "align", "valign"},
    "th": {"colspan", "rowspan", "align", "valign", "scope"},
    "col": {"span", "width"},
    "colgroup": {"span"},
    "ol": {"start", "type"},
    "abbr": {"title"},
    "time": {"datetime"},
    "svg": {"viewbox", "xmlns", "width", "height", "fill", "stroke", "preserveaspectratio"},
    "path": {"d", "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin",
             "fill-rule", "clip-rule", "opacity", "transform"},
    "g": {"fill", "stroke", "transform", "opacity"},
    "circle": {"cx", "cy", "r", "fill", "stroke", "stroke-width", "opacity"},
    "ellipse": {"cx", "cy", "rx", "ry", "fill", "stroke", "stroke-width", "opacity"},
    "rect": {"x", "y", "width", "height", "rx", "ry", "fill", "stroke", "stroke-width", "opacity"},
    "line": {"x1", "y1", "x2", "y2", "stroke", "stroke-width", "opacity"},
    "polyline": {"points", "fill", "stroke", "stroke-width"},
    "polygon": {"points", "fill", "stroke", "stroke-width"},
    "text": {"x", "y", "fill", "font-size", "font-family", "text-anchor", "transform"},
    "tspan": {"x", "y", "dy", "dx", "fill", "font-size"},
    "marker": {"id", "markerwidth", "markerheight", "refx", "refy", "orient"},
    "lineargradient": {"id", "x1", "y1", "x2", "y2", "gradientunits"},
    "radialgradient": {"id", "cx", "cy", "r", "gradientunits"},
    "stop": {"offset", "stop-color", "stop-opacity"},
}

#: `position` is absent on purpose: `position:fixed` lets a comment lay an invisible sheet over the
#: dashboard and harvest clicks meant for it. `z-index` and `transform` are absent for the same
#: reason — without them, content that escapes its box still cannot be aimed at anything.
ALLOWED_STYLE_PROPS = {
    "color", "background-color", "background",
    "font-size", "font-weight", "font-style", "font-family", "font-variant",
    "text-align", "text-decoration", "text-transform", "line-height", "letter-spacing",
    "white-space", "word-break", "overflow-wrap", "vertical-align", "list-style", "list-style-type",
    "padding", "padding-top", "padding-right", "padding-bottom", "padding-left",
    "margin", "margin-top", "margin-right", "margin-bottom", "margin-left",
    "border", "border-top", "border-right", "border-bottom", "border-left",
    "border-color", "border-width", "border-style", "border-radius", "border-collapse",
    "width", "min-width", "max-width", "height", "min-height", "max-height",
    "display", "flex", "flex-direction", "flex-wrap", "align-items", "justify-content",
    "gap", "row-gap", "column-gap", "grid-template-columns",
    "opacity", "overflow-x", "overflow-y", "box-shadow",
}

#: Anything that can pull a resource, re-enter the parser, or call out to script.
_STYLE_POISON = re.compile(r"url\s*\(|expression\s*\(|javascript:|@import|behavior\s*:|-moz-binding|<", re.I)

_SCHEME = re.compile(r"^\s*([a-z][a-z0-9+.\-]*)\s*:", re.I)
_SAFE_SCHEMES = {"http", "https", "mailto"}
_SAFE_DATA_IMG = re.compile(r"^\s*data:image/(?:png|jpeg|jpg|gif|webp)\s*;\s*base64\s*,", re.I)
#: Characters a browser strips from a URL before resolving it — `java\tscript:` is `javascript:`.
_URL_NOISE = re.compile(r"[\x00-\x20\x7f]+")


def _safe_url(value: str) -> str | None:
    """A URL we are willing to put in an href or src, or None.

    Relative and fragment URLs pass. Absolute ones must name a scheme we trust. `data:` is allowed
    for raster images only — `data:image/svg+xml` is a script-execution vector wearing an image's
    content type, which is exactly the kind of thing an allowlist exists to catch.
    """
    if not value:
        return None
    cleaned = _URL_NOISE.sub("", value)
    if _SAFE_DATA_IMG.match(value):
        return value.strip()
    m = _SCHEME.match(cleaned)
    if not m:
        return value.strip()  # relative, absolute-path, or #fragment
    return value.strip() if m.group(1).lower() in _SAFE_SCHEMES else None


def _safe_style(value: str) -> str:
    """Keep the declarations we recognise and drop the rest."""
    kept: list[str] = []
    for decl in value.split(";"):
        if ":" not in decl:
            continue
        prop, _, val = decl.partition(":")
        prop, val = prop.strip().lower(), val.strip()
        if prop in ALLOWED_STYLE_PROPS and val and not _STYLE_POISON.search(val):
            kept.append(f"{prop}: {val}")
    return "; ".join(kept)


class _Sanitizer(HTMLParser):
    """Rebuilds the document from tags it recognises, rather than trying to strip the ones it does
    not. An allowlist that emits is safe when it is wrong; a denylist that removes is not."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.out: list[str] = []
        self.open: list[str] = []
        self.suppress = 0          # depth inside a drop-with-content tag
        self.suppress_tag = ""

    # -- helpers ---------------------------------------------------------
    def _attrs(self, tag: str, attrs: list[tuple[str, str | None]]) -> str:
        allowed = GLOBAL_ATTRS | PER_TAG_ATTRS.get(tag, set())
        parts: list[str] = []
        for raw_name, raw_value in attrs:
            name = raw_name.lower()
            value = raw_value or ""
            # Event handlers never survive, whatever tag they are on.
            if name.startswith("on") or name not in allowed:
                continue
            if name in {"href", "src"}:
                safe = _safe_url(value)
                if safe is None:
                    continue
                value = safe
            elif name == "style":
                value = _safe_style(value)
                if not value:
                    continue
            parts.append(f'{name}="{escape(value, quote=True)}"')
        if tag == "a":
            # An agent's link opens away from the dashboard and carries no referrer or ranking.
            parts = [p for p in parts if not p.startswith(("target=", "rel="))]
            if any(p.startswith("href=") for p in parts):
                parts += ['target="_blank"', 'rel="noopener noreferrer nofollow"']
        return (" " + " ".join(parts)) if parts else ""

    # -- parser hooks ----------------------------------------------------
    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        if self.suppress:
            if tag == self.suppress_tag:
                self.suppress += 1
            return
        if tag in DROP_WITH_CONTENT:
            self.suppress, self.suppress_tag = 1, tag
            return
        if tag not in ALLOWED_TAGS:
            return  # drop the tag, keep whatever text it wrapped
        self.out.append(f"<{tag}{self._attrs(tag, attrs)}>")
        if tag not in VOID_TAGS:
            self.open.append(tag)

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        if self.suppress or tag in DROP_WITH_CONTENT or tag not in ALLOWED_TAGS:
            return
        self.out.append(f"<{tag}{self._attrs(tag, attrs)}/>")

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if self.suppress:
            if tag == self.suppress_tag:
                self.suppress -= 1
                if not self.suppress:
                    self.suppress_tag = ""
            return
        if tag in VOID_TAGS or tag not in ALLOWED_TAGS or tag not in self.open:
            return
        # Close anything the author left open inside this element, so the dashboard's own layout
        # cannot be swallowed by an unclosed <td>.
        while self.open:
            top = self.open.pop()
            self.out.append(f"</{top}>")
            if top == tag:
                break

    def handle_data(self, data: str) -> None:
        if not self.suppress:
            self.out.append(escape(data, quote=False))

    def close_all(self) -> str:
        while self.open:
            self.out.append(f"</{self.open.pop()}>")
        return "".join(self.out)


def sanitize_html(raw: Any) -> str:
    """Agent-authored HTML, reduced to what is safe to place inside the dashboard."""
    if not isinstance(raw, str) or not raw.strip():
        return ""
    parser = _Sanitizer()
    try:
        parser.feed(raw)
    except Exception:
        # A parser that gave up mid-document must not hand back a half-open tree.
        return escape(raw, quote=False)
    return parser.close_all()


# --------------------------------------------------------------------------- markdown

_MD_INLINE = (
    (re.compile(r"`([^`\n]+)`"), r"<code>\1</code>"),
    (re.compile(r"\*\*([^*\n]+)\*\*"), r"<strong>\1</strong>"),
    (re.compile(r"(?<!\*)\*([^*\n]+)\*(?!\*)"), r"<em>\1</em>"),
    (re.compile(r"~~([^~\n]+)~~"), r"<del>\1</del>"),
)
_MD_LINK = re.compile(r"\[([^\]\n]+)\]\(([^)\s]+)\)")


def _inline(text: str) -> str:
    """Inline markdown over already-escaped text."""
    for pattern, repl in _MD_INLINE:
        text = pattern.sub(repl, text)

    def link(m: re.Match[str]) -> str:
        url = _safe_url(m.group(2))
        if url is None:
            return m.group(1)
        return f'<a href="{escape(url, quote=True)}" target="_blank" rel="noopener noreferrer nofollow">{m.group(1)}</a>'

    return _MD_LINK.sub(link, text)


def render_markdown(md: Any) -> str:
    """A small, deliberate subset: headings, lists, quotes, fences, rules, and inline marks.

    The source is escaped *before* any tag is introduced, so HTML written inside a markdown block
    renders as the text it looks like rather than as markup. An agent that wants real markup asks
    for it explicitly with an `html` block, which is the one place it is expected and filtered.
    """
    if not isinstance(md, str) or not md.strip():
        return ""
    out: list[str] = []
    para: list[str] = []
    list_tag: str | None = None
    in_fence = False
    fence: list[str] = []

    def flush_para() -> None:
        nonlocal para
        if para:
            out.append("<p>" + _inline("<br>".join(para)) + "</p>")
            para = []

    def flush_list() -> None:
        nonlocal list_tag
        if list_tag:
            out.append(f"</{list_tag}>")
            list_tag = None

    for line in escape(md, quote=False).replace("\r\n", "\n").split("\n"):
        stripped = line.strip()

        if stripped.startswith("```"):
            if in_fence:
                out.append("<pre><code>" + "\n".join(fence) + "</code></pre>")
                fence, in_fence = [], False
            else:
                flush_para(); flush_list()
                in_fence = True
            continue
        if in_fence:
            fence.append(line)
            continue

        if not stripped:
            flush_para(); flush_list()
            continue

        heading = re.match(r"^(#{1,6})\s+(.*)$", stripped)
        if heading:
            flush_para(); flush_list()
            level = len(heading.group(1))
            out.append(f"<h{level}>{_inline(heading.group(2))}</h{level}>")
            continue

        if re.match(r"^(-{3,}|\*{3,}|_{3,})$", stripped):
            flush_para(); flush_list()
            out.append("<hr>")
            continue

        if stripped.startswith("&gt;"):
            flush_para(); flush_list()
            out.append("<blockquote>" + _inline(stripped[4:].strip()) + "</blockquote>")
            continue

        bullet = re.match(r"^[-*+]\s+(.*)$", stripped)
        number = re.match(r"^\d+[.)]\s+(.*)$", stripped)
        if bullet or number:
            want = "ul" if bullet else "ol"
            flush_para()
            if list_tag != want:
                flush_list()
                out.append(f"<{want}>")
                list_tag = want
            out.append("<li>" + _inline((bullet or number).group(1)) + "</li>")
            continue

        flush_list()
        para.append(stripped)

    if in_fence and fence:
        out.append("<pre><code>" + "\n".join(fence) + "</code></pre>")
    flush_para(); flush_list()
    return "".join(out)


# --------------------------------------------------------------------------- the block schema

MAX_BLOCKS = 50
MAX_TABLE_ROWS = 200
MAX_TABLE_COLS = 12
MAX_TEXT = 20_000

BLOCK_TYPES = ("markdown", "callout", "html", "code", "diagram", "table", "keyvalue", "evidence")
CALLOUT_LEVELS = ("info", "warn", "error", "success")
EVIDENCE_KINDS = ("network", "console", "dom", "state", "cookie", "storage", "marker")


def _text(value: Any, limit: int = MAX_TEXT) -> str:
    return value[:limit] if isinstance(value, str) else ""


def _cell(value: Any) -> str:
    """Table and key/value cells stay text and are rendered as text nodes by the client, so they
    never pass through a sanitizer at all — the safest thing an untrusted string can be."""
    if isinstance(value, bool) or value is None:
        return "" if value is None else str(value).lower()
    if isinstance(value, (int, float)):
        return str(value)
    return _text(value, 2_000)


def _one(block: Any, i: int) -> dict[str, Any]:
    if not isinstance(block, dict):
        raise ValueError(f"block {i} is not an object")
    kind = block.get("type")
    if kind not in BLOCK_TYPES:
        raise ValueError(f"block {i}: unknown type {kind!r} — expected one of {', '.join(BLOCK_TYPES)}")

    if kind == "markdown":
        html = render_markdown(block.get("md"))
        if not html:
            raise ValueError(f"block {i}: markdown block needs a non-empty `md`")
        return {"type": "markdown", "html": html}

    if kind == "callout":
        level = block.get("level") or "info"
        if level not in CALLOUT_LEVELS:
            raise ValueError(f"block {i}: level must be one of {', '.join(CALLOUT_LEVELS)}")
        return {"type": "callout", "level": level,
                "title": _text(block.get("title"), 200),
                "html": render_markdown(block.get("md"))}

    if kind == "html":
        html = sanitize_html(block.get("html"))
        if not html.strip():
            raise ValueError(f"block {i}: html block was empty after sanitising")
        return {"type": "html", "html": html}

    if kind == "code":
        src = _text(block.get("src"))
        if not src:
            raise ValueError(f"block {i}: code block needs `src`")
        highlight = [int(n) for n in (block.get("highlight") or []) if isinstance(n, (int, float))][:200]
        return {"type": "code", "lang": _text(block.get("lang"), 30), "src": src,
                "highlight": highlight, "caption": _text(block.get("caption"), 300)}

    if kind == "diagram":
        src = _text(block.get("src"))
        if not src:
            raise ValueError(f"block {i}: diagram block needs `src`")
        lang = _text(block.get("lang"), 30) or "mermaid"
        if lang != "mermaid":
            raise ValueError(f"block {i}: only mermaid diagrams are supported, got {lang!r}")
        return {"type": "diagram", "lang": "mermaid", "src": src,
                "caption": _text(block.get("caption"), 300)}

    if kind == "table":
        columns = [_cell(c) for c in (block.get("columns") or [])][:MAX_TABLE_COLS]
        if not columns:
            raise ValueError(f"block {i}: table needs `columns`")
        rows = [[_cell(c) for c in (row or [])][:MAX_TABLE_COLS]
                for row in (block.get("rows") or []) if isinstance(row, list)][:MAX_TABLE_ROWS]
        return {"type": "table", "columns": columns, "rows": rows,
                "caption": _text(block.get("caption"), 300)}

    if kind == "keyvalue":
        items = [{"k": _cell(it.get("k")), "v": _cell(it.get("v")), "mono": bool(it.get("mono"))}
                 for it in (block.get("items") or []) if isinstance(it, dict)][:MAX_TABLE_ROWS]
        if not items:
            raise ValueError(f"block {i}: keyvalue needs `items`")
        return {"type": "keyvalue", "items": items, "caption": _text(block.get("caption"), 300)}

    # evidence — a pointer into the capture this comment hangs off, resolved by the dashboard into
    # a link. The agent names what it found; it does not get to name where the link goes.
    ref = block.get("ref")
    if not isinstance(ref, dict) or ref.get("kind") not in EVIDENCE_KINDS:
        raise ValueError(f"block {i}: evidence needs ref.kind in {', '.join(EVIDENCE_KINDS)}")
    out: dict[str, Any] = {"kind": ref["kind"]}
    for field in ("index", "t"):
        if isinstance(ref.get(field), (int, float)):
            out[field] = int(ref[field])
    if ref.get("selector"):
        out["selector"] = _text(ref["selector"], 500)
    return {"type": "evidence", "ref": out, "note": _text(block.get("note"), 500)}


def normalize_blocks(raw: Any) -> list[dict[str, Any]]:
    """Validate and sanitize an agent's blocks. Raises ValueError with a message written to be read
    by the agent that sent it, since a rejected comment is one it can correct and retry."""
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise ValueError("`blocks` must be a list")
    if len(raw) > MAX_BLOCKS:
        raise ValueError(f"too many blocks ({len(raw)}) — {MAX_BLOCKS} is the limit")
    return [_one(b, i) for i, b in enumerate(raw)]


# --------------------------------------------------------------------------- flattenings

_TAG = re.compile(r"<[^>]+>")


def _strip(html: str) -> str:
    return re.sub(r"\s+", " ", _TAG.sub(" ", html)).strip()


def blocks_to_text(blocks: list[dict[str, Any]]) -> str:
    """The plain-text rendering every comment carries alongside its blocks.

    `body` stays the one field every surface can rely on — the markdown briefing, a notification,
    anything written before blocks existed. A comment that lived only as blocks would be invisible
    to all of them, which is the failure this project has already had once."""
    parts: list[str] = []
    for b in blocks:
        kind = b["type"]
        if kind in ("markdown", "html"):
            parts.append(_strip(b.get("html", "")))
        elif kind == "callout":
            parts.append(f"[{b['level']}] {b.get('title') or ''} {_strip(b.get('html', ''))}".strip())
        elif kind == "code":
            parts.append(b.get("caption") or f"({b.get('lang') or 'code'} snippet)")
        elif kind == "diagram":
            parts.append(b.get("caption") or "(diagram)")
        elif kind == "table":
            parts.append(" | ".join(b.get("columns", [])) + f" ({len(b.get('rows', []))} rows)")
        elif kind == "keyvalue":
            parts.append("; ".join(f"{i['k']}: {i['v']}" for i in b.get("items", [])))
        elif kind == "evidence":
            ref = b.get("ref", {})
            where = ref.get("kind", "evidence")
            if "index" in ref:
                where += f" #{ref['index']}"
            if "t" in ref:
                where += f" at {ref['t']}ms"
            parts.append(f"[{where}] {b.get('note') or ''}".strip())
    return "\n\n".join(p for p in parts if p).strip()


def blocks_for_body(body: str) -> list[dict[str, Any]]:
    """Blocks for a comment stored before blocks existed, so the client has one code path.

    A side effect worth having: the markdown agents have been writing all along renders now,
    instead of being flattened into a single grey line."""
    html = render_markdown(body)
    return [{"type": "markdown", "html": html}] if html else []


def blocks_to_markdown(blocks: list[dict[str, Any]]) -> list[str]:
    """Blocks rendered back into the markdown briefing an agent reads from get_session."""
    lines: list[str] = []
    for b in blocks:
        kind = b["type"]
        if kind == "callout":
            label = {"info": "ℹ", "warn": "⚠", "error": "✖", "success": "✔"}[b["level"]]
            title = b.get("title") or b["level"].upper()
            lines.append(f"> {label} **{title}** — {_strip(b.get('html', ''))}")
        elif kind == "code":
            lines.append(f"```{b.get('lang') or ''}\n{b['src']}\n```")
        elif kind == "diagram":
            lines.append(f"```mermaid\n{b['src']}\n```")
        elif kind == "table":
            cols = b.get("columns", [])
            lines.append("| " + " | ".join(cols) + " |")
            lines.append("|" + "---|" * len(cols))
            for row in b.get("rows", [])[:50]:
                lines.append("| " + " | ".join(row + [""] * (len(cols) - len(row))) + " |")
        elif kind == "keyvalue":
            lines.extend(f"- **{i['k']}:** {i['v']}" for i in b.get("items", []))
        else:
            text = blocks_to_text([b])
            if text:
                lines.append(text)
    return lines
