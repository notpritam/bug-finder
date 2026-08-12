# ABOUTME: An agent writes these comments and the dashboard renders them into a page that is
# ABOUTME: already holding someone's session — so a sanitizer that lets one thing through is a
# ABOUTME: stored XSS with an authenticated audience. These are the payloads that actually get
# ABOUTME: used, not a demonstration that the happy path works.
# ABOUTME: Run: python backend/tests/test_blocks.py
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from bugdash.blocks import (  # noqa: E402
    blocks_for_body,
    blocks_to_markdown,
    blocks_to_text,
    normalize_blocks,
    render_markdown,
    sanitize_html,
)

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


def clean(payload):
    return sanitize_html(payload).lower()


print("the sanitizer holds")

# --- script execution, every route in --------------------------------------------------------
ATTACKS = [
    ("<script>alert(1)</script>", "script tag"),
    ("<p onclick=\"alert(1)\">x</p>", "inline handler"),
    ("<p ONCLICK='alert(1)'>x</p>", "handler, shouted"),
    ("<a href=\"javascript:alert(1)\">x</a>", "javascript: url"),
    ("<a href=\"JaVaScRiPt:alert(1)\">x</a>", "javascript: url, mixed case"),
    ("<a href=\"java\tscript:alert(1)\">x</a>", "javascript: split by a tab"),
    ("<a href=\"java\nscript:alert(1)\">x</a>", "javascript: split by a newline"),
    ("<img src=x onerror=alert(1)>", "img onerror"),
    ("<img src=\"data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=\">", "svg smuggled as an image"),
    ("<iframe src=\"https://evil\"></iframe>", "iframe"),
    ("<object data=\"x\"></object>", "object"),
    ("<embed src=\"x\">", "embed"),
    ("<svg><foreignObject><script>alert(1)</script></foreignObject></svg>", "script inside svg"),
    ("<form action=\"//evil\"><input name=p></form>", "credential-shaped form"),
    ("<style>body{display:none}</style>", "style element"),
    ("<div style=\"background:url(javascript:alert(1))\">x</div>", "url() in a style"),
    ("<div style=\"width:expression(alert(1))\">x</div>", "expression() in a style"),
    ("<template><script>alert(1)</script></template>", "script parked in a template"),
    ("<base href=\"//evil\">", "base tag rewriting every relative url"),
]
for payload, label in ATTACKS:
    out = clean(payload)
    bad = any(t in out for t in ("<script", "javascript:", "onclick", "onerror", "<iframe",
                                 "<object", "<embed", "<form", "<style", "expression(",
                                 "svg+xml", "<base"))
    check(f"neutralises {label}", not bad, f"{payload[:42]!r} → {sanitize_html(payload)[:60]!r}")

# --- the overlay attack ------------------------------------------------------------------------
# A comment that can position itself can lay a transparent sheet over the dashboard and take the
# clicks meant for it. Filtering scripts alone does not stop this one.
overlay = sanitize_html('<div style="position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:9999">x</div>')
check("a comment cannot escape its box and cover the page",
      "position" not in overlay and "z-index" not in overlay,
      f"→ {overlay!r}")

# --- what must survive, or the feature is pointless ---------------------------------------------
kept = sanitize_html(
    '<p>a <strong>bold</strong> point and <code>x = 1</code></p>'
    '<table><tr><th colspan="2">h</th></tr><tr><td>a</td><td>b</td></tr></table>'
    '<a href="https://example.com/x?y=1">link</a>'
    '<div style="color:#c00;padding:4px">tinted</div>'
)
for want, label in [("<strong>", "bold"), ("<code>", "inline code"), ("<table>", "tables"),
                    ('colspan="2"', "colspan"), ("https://example.com", "http links"),
                    ("color: #c00", "safe inline colour")]:
    check(f"keeps {label}", want in kept)
check("outbound links cannot reach back through window.opener",
      'rel="noopener noreferrer nofollow"' in kept and 'target="_blank"' in kept)

check("an unclosed tag cannot swallow the page that follows it",
      sanitize_html("<td>orphan").count("</td>") == 1,
      f"→ {sanitize_html('<td>orphan')!r}")

# --- markdown ------------------------------------------------------------------------------------
check("markdown renders structure", "<h1>H</h1>" in render_markdown("# H"))
check("markdown renders lists", "<ul><li>a</li><li>b</li></ul>" in render_markdown("- a\n- b"))
check("markdown renders fences", "<pre><code>" in render_markdown("```\nx=1\n```"))
# Markdown is prose, not a second way in: HTML written there renders as the text it looks like.
check("html inside a markdown block becomes text, not markup",
      "&lt;script&gt;" in render_markdown("<script>alert(1)</script>"))
check("a markdown link to javascript: keeps the words and drops the link",
      "<a" not in render_markdown("[click](javascript:alert(1))"))

# --- block validation ----------------------------------------------------------------------------
ok = normalize_blocks([
    {"type": "markdown", "md": "**why**"},
    {"type": "callout", "level": "warn", "title": "Careful", "md": "it truncates"},
    {"type": "code", "lang": "ts", "src": "const a = 1", "highlight": [1]},
    {"type": "diagram", "lang": "mermaid", "src": "graph TD; A-->B"},
    {"type": "table", "columns": ["observed", "expected"], "rows": [["461", "820"]]},
    {"type": "keyvalue", "items": [{"k": "scrollWidth", "v": "1840", "mono": True}]},
    {"type": "evidence", "ref": {"kind": "network", "index": 31}, "note": "the 200 with bad data"},
])
check("every block type round-trips", len(ok) == 7)
check("table cells stay text and never become html",
      ok[4]["rows"][0] == ["461", "820"],
      "the client renders these as text nodes — no sanitizer involved")
check("evidence refs keep only fields the dashboard can resolve",
      ok[6]["ref"] == {"kind": "network", "index": 31})

for bad, why in [
    ([{"type": "nope"}], "unknown type"),
    ([{"type": "code"}], "code with no src"),
    ([{"type": "diagram", "lang": "graphviz", "src": "x"}], "a diagram language we cannot render"),
    ([{"type": "evidence", "ref": {"kind": "invented"}}], "an evidence kind that resolves nowhere"),
    ("not a list", "blocks that are not a list"),
]:
    try:
        normalize_blocks(bad)
        check(f"rejects {why}", False)
    except ValueError as err:
        check(f"rejects {why}", True, str(err)[:70])

try:
    normalize_blocks([{"type": "markdown", "md": "fine"}, {"type": "code"}])
    check("a rejection names which block was wrong", False)
except ValueError as err:
    check("a rejection names which block was wrong", "block 1" in str(err), str(err))

# --- the plain-text half -------------------------------------------------------------------------
# body is what get_session, notifications, and every pre-blocks reader see. A comment that existed
# only as blocks would be invisible to all of them — the failure this project already had once.
text = blocks_to_text(ok)
check("blocks derive a readable plain body", "why" in text and "scrollWidth: 1840" in text, text[:80])
check("a body-only comment still yields blocks to render",
      blocks_for_body("**hi**")[0]["html"] == "<p><strong>hi</strong></p>")
check("a body of nothing yields no blocks", blocks_for_body("") == [])

md = "\n".join(blocks_to_markdown(ok))
check("the agent briefing keeps a diagram a diagram", "```mermaid" in md)
check("the agent briefing keeps a table a table", "| observed | expected |" in md)

print(f"\n{passed} checks passed" if not failed else f"\nFAILED: {json.dumps(failed, indent=2)}")
sys.exit(1 if failed else 0)
