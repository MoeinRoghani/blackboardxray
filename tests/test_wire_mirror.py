"""The two halves cannot spell the vocabulary differently.

`blackboard.wire` gets this guarantee by having both halves import one module.
The halves here are Python and TypeScript and cannot share a module, so they
share a test instead: a kind added in one and forgotten in the other fails the
build rather than rendering a blank row in front of an operator.
"""

from __future__ import annotations

import re
from pathlib import Path

from blackboardxray.events import EventKind

_UI = Path(__file__).resolve().parents[1] / "ui" / "src" / "lib" / "events.ts"


def _typescript() -> str:
    return _UI.read_text()


def test_the_two_halves_name_the_same_kinds() -> None:
    block = re.search(
        r"export const EVENT_KINDS = \[(.*?)\] as const;", _typescript(), re.S
    )
    assert block is not None, "EVENT_KINDS is not declared in ui/src/lib/events.ts"
    named = re.findall(r'"([^"]+)"', block.group(1))
    assert named == list(EventKind.ALL), (
        "the TypeScript kinds and the Python kinds disagree.\n"
        f"  python:     {list(EventKind.ALL)}\n"
        f"  typescript: {named}"
    )


def test_every_kind_has_a_label_and_a_tone() -> None:
    source = _typescript()
    for section in ("KIND_LABEL", "KIND_TONE"):
        block = re.search(rf"export const {section}[^=]*= \{{(.*?)\n\}};", source, re.S)
        assert block is not None, f"{section} is not declared"
        keyed = set(re.findall(r'"([^"]+)":', block.group(1)))
        missing = set(EventKind.ALL) - keyed
        assert not missing, f"{section} has no entry for {sorted(missing)}"


def test_the_three_outcomes_agree_with_the_library() -> None:
    # These are the names `blackboard` writes into the store, and the platform
    # reads them back on `run.closed`.
    source = _typescript()
    block = re.search(r"export type Outcome =([^;]+);", source)
    assert block is not None
    named = set(re.findall(r'"([^"]+)"', block.group(1)))
    assert named == {"settled", "wall_clock_expired", "aborted"}
