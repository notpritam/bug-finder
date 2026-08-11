# ABOUTME: Pure tests for the rrweb DOM rebuilder — snapshot walk, mutation/input replay to a
# ABOUTME: timestamp, HTML serialization, and the minimal selector engine.
from bugdash.domtime import DomStore, _selector_predicate, dom_at, serialize, text_of

BASE = 1_000_000


def _snapshot_node():
    # html > body > div#list.thread [data-testid=thread] > (div#row-1 "hello", div#row-2 "world")
    return {
        "type": 0,
        "id": 1,
        "childNodes": [
            {
                "type": 2,
                "id": 2,
                "tagName": "html",
                "attributes": {},
                "childNodes": [
                    {
                        "type": 2,
                        "id": 3,
                        "tagName": "body",
                        "attributes": {},
                        "childNodes": [
                            {
                                "type": 2,
                                "id": 10,
                                "tagName": "div",
                                "attributes": {"id": "list", "class": "thread", "data-testid": "thread"},
                                "childNodes": [
                                    {
                                        "type": 2,
                                        "id": 11,
                                        "tagName": "div",
                                        "attributes": {"id": "row-1", "style": "transform: translateY(0px)"},
                                        "childNodes": [{"type": 3, "id": 12, "textContent": "hello"}],
                                    },
                                    {
                                        "type": 2,
                                        "id": 13,
                                        "tagName": "div",
                                        "attributes": {"id": "row-2", "style": "transform: translateY(100px)"},
                                        "childNodes": [{"type": 3, "id": 14, "textContent": "world"}],
                                    },
                                ],
                            }
                        ],
                    }
                ],
            }
        ],
    }


def _events():
    return [
        {"type": 4, "timestamp": BASE, "data": {"href": "http://x/"}},
        {"type": 2, "timestamp": BASE + 10, "data": {"node": _snapshot_node()}},
        # t≈+1000: row-2 slides down and row-1's text changes
        {
            "type": 3,
            "timestamp": BASE + 1000,
            "data": {
                "source": 0,
                "texts": [{"id": 12, "value": "hello EDITED"}],
                "attributes": [{"id": 13, "attributes": {"style": "transform: translateY(228px)"}}],
                "removes": [],
                "adds": [],
            },
        },
        # t≈+2000: a third row mounts before row-2, and an input gets a value
        {
            "type": 3,
            "timestamp": BASE + 2000,
            "data": {
                "source": 0,
                "texts": [],
                "attributes": [],
                "removes": [],
                "adds": [
                    {
                        "parentId": 10,
                        "nextId": 13,
                        "node": {
                            "type": 2,
                            "id": 20,
                            "tagName": "div",
                            "attributes": {"id": "row-1b", "data-testid": "agent-message-abc"},
                            "childNodes": [{"type": 3, "id": 21, "textContent": "inserted"}],
                        },
                    }
                ],
            },
        },
        {"type": 3, "timestamp": BASE + 2500, "data": {"source": 5, "id": 11, "text": "typed value"}},
        # t≈+3000: row-2 is removed
        {
            "type": 3,
            "timestamp": BASE + 3000,
            "data": {"source": 0, "texts": [], "attributes": [], "adds": [], "removes": [{"parentId": 10, "id": 13}]},
        },
    ]


def test_snapshot_only_at_t0():
    store, meta = dom_at(_events(), 0)
    assert meta["mutationsApplied"] == 0
    html = serialize(store, store.root_id)
    assert 'id="row-1"' in html and "hello" in html and "hello EDITED" not in html


def test_mutations_applied_up_to_t():
    store, meta = dom_at(_events(), 1500)
    assert meta["mutationsApplied"] == 1
    html = serialize(store, store.root_id)
    assert "hello EDITED" in html
    assert "translateY(228px)" in html
    assert 'id="row-1b"' not in html  # the +2000 add is in the future


def test_add_insert_position_and_input():
    store, _ = dom_at(_events(), 2600)
    parent = store.nodes[10]
    assert parent["childIds"] == [11, 20, 13]  # inserted BEFORE row-2 via nextId
    assert store.nodes[11]["attributes"]["value"] == "typed value"


def test_remove_detaches_subtree_from_serialization():
    store, _ = dom_at(_events(), 3500)
    html = serialize(store, store.root_id)
    assert 'id="row-2"' not in html and "world" not in html
    assert 'id="row-1b"' in html


def test_selector_engine_shapes():
    store, _ = dom_at(_events(), 2600)
    nodes = store.nodes
    by_id = _selector_predicate("#row-1b")
    assert [nid for nid, n in nodes.items() if by_id(n)] == [20]
    by_class = _selector_predicate("div.thread")
    assert [nid for nid, n in nodes.items() if by_class(n)] == [10]
    by_attr_contains = _selector_predicate('[data-testid*="agent-message"]')
    assert [nid for nid, n in nodes.items() if by_attr_contains(n)] == [20]
    by_attr_equals = _selector_predicate('div[data-testid="thread"]')
    assert [nid for nid, n in nodes.items() if by_attr_equals(n)] == [10]


def test_text_of_collapses_whitespace():
    store, _ = dom_at(_events(), 2600)
    assert text_of(store, 10).startswith("hello")


def test_late_t_uses_latest_snapshot_and_dangling_target_is_safe():
    events = _events()
    # A second snapshot at +5000 replaces everything with one div.
    events.append(
        {
            "type": 2,
            "timestamp": BASE + 5000,
            "data": {
                "node": {
                    "type": 0,
                    "id": 1,
                    "childNodes": [
                        {"type": 2, "id": 2, "tagName": "html", "attributes": {}, "childNodes": [
                            {"type": 2, "id": 30, "tagName": "div", "attributes": {"id": "fresh"}, "childNodes": []}
                        ]}
                    ],
                }
            },
        }
    )
    store, meta = dom_at(events, 6000)
    assert meta["mutationsApplied"] == 0
    html = serialize(store, store.root_id)
    assert 'id="fresh"' in html and 'id="row-1"' not in html


def test_mutation_against_unknown_node_is_ignored():
    store = DomStore()
    store.root_id = store.register({"type": 2, "id": 1, "tagName": "body", "attributes": {}, "childNodes": []}, None)
    # Should not raise: patches referencing ids that were never registered.
    from bugdash.domtime import _apply_mutation

    _apply_mutation(store, {"texts": [{"id": 99, "value": "x"}], "attributes": [{"id": 98, "attributes": {"a": "b"}}], "removes": [{"id": 97}], "adds": []})
    assert serialize(store, store.root_id) == "<body></body>"
