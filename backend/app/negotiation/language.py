"""Seller language signals (spec 6.4).

Spec 6.4: "Description phrasing correlates with flexibility. Lift the full
keyword set: 'firm on price,' 'no lowballers,' 'need gone today,' 'moving,'
'inherited,' 'bought a new car,' 'wife says sell,' 'OBO,' 'must sell by [date].'
Some signal rigidity, others signal motivation, and they should be scored in
OPPOSITE directions."

That last instruction is the whole design. A single "seller language" score that
lumped "firm, no lowballers" together with "moving, must sell this week" would
cancel two strong and opposite signals into a meaningless middle. So each phrase
carries a direction, matches are reported individually, and the two directions
are counted separately before they are ever combined.

DELIBERATELY NOT HERE
---------------------
Price-drop history. Spec 6.4 calls it "the strongest version of this signal" and
then assigns it to phase three (spec 12), because it needs accumulated
observations that do not exist yet. `price_changed` is NULL on every observation
captured. Implementing it against a column that is always null would produce a
signal that silently never fires.

UNCALIBRATED, LIKE EVERY OTHER SCORING CONSTANT IN THIS CODEBASE
-----------------------------------------------------------------
Every per-phrase `weight` (1-3) in `SIGNALS` below is a relative judgment call
-- "must sell by Friday" is a stronger statement than "moving", so they are not
flattened to the same weight -- but none of them are fitted to anything. Kept
inline rather than moved to `negotiation/params.py` (which centralizes this
module's OTHER constants, see its docstring) because splitting a phrase from
its own weight and pattern would hurt readability more than centralizing helps.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from enum import StrEnum


class Direction(StrEnum):
    """Which way a phrase moves the buyer's leverage."""

    #: Seller signals urgency or a reason to sell. Buyer leverage goes UP.
    MOTIVATED = "motivated"
    #: Seller signals price rigidity. Buyer leverage goes DOWN.
    RIGID = "rigid"


@dataclass(frozen=True)
class LanguageSignal:
    label: str
    direction: Direction
    pattern: re.Pattern[str]
    #: Relative strength, 1-3. UNCALIBRATED; "must sell by Friday" is a stronger
    #: statement than "moving", and flattening them would lose that.
    weight: int


def _p(pattern: str) -> re.Pattern[str]:
    return re.compile(pattern, re.I)


# Every phrase spec 6.4 names, plus close variants a seller would actually type.
# The spec's list is treated as the required minimum, not the maximum.
SIGNALS: tuple[LanguageSignal, ...] = (
    # --- rigidity: the seller is telling you not to negotiate ---------------
    LanguageSignal("firm on price", Direction.RIGID, _p(r"\bfirm\b(\s+on\s+(the\s+)?price)?"), 3),
    LanguageSignal("no lowballers", Direction.RIGID, _p(r"\bno\s+low\s?ball(er)?s?\b"), 3),
    LanguageSignal("price is set", Direction.RIGID, _p(r"\bprice\s+is\s+(set|final)\b"), 3),
    LanguageSignal("not negotiable", Direction.RIGID, _p(r"\b(non|not)[\s-]*negotiable\b"), 3),
    LanguageSignal("no trades", Direction.RIGID, _p(r"\bno\s+trades?\b"), 1),
    LanguageSignal(
        "serious inquiries only", Direction.RIGID, _p(r"\bserious\s+(inquir|buyer)"), 1
    ),
    LanguageSignal("worth more", Direction.RIGID, _p(r"\bworth\s+(more|every\s+penny)\b"), 2),
    # --- motivation: the seller is telling you why they need it gone --------
    LanguageSignal("OBO", Direction.MOTIVATED, _p(r"\bo\.?b\.?o\.?\b|\bbest\s+offer\b"), 2),
    LanguageSignal(
        "must sell by a date",
        Direction.MOTIVATED,
        _p(r"\bmust\s+sell\b|\bneed(s)?\s+to\s+(be\s+)?(sold|gone)\b"),
        3,
    ),
    LanguageSignal(
        "need gone today", Direction.MOTIVATED, _p(r"\b(need|want)s?\s+(it\s+)?gone\b"), 3
    ),
    LanguageSignal("moving", Direction.MOTIVATED, _p(r"\bmoving\b|\brelocat"), 2),
    LanguageSignal("inherited", Direction.MOTIVATED, _p(r"\binherit(ed)?\b|\bestate\s+sale\b"), 2),
    LanguageSignal(
        "bought a new car",
        Direction.MOTIVATED,
        _p(r"\b(bought|got|purchased)\s+(a\s+)?(new(er)?|another)\s+(car|truck|vehicle)\b"),
        2,
    ),
    LanguageSignal(
        "wife says sell",
        Direction.MOTIVATED,
        _p(r"\b(wife|husband|spouse)\s+(says|wants|told)\b"),
        1,
    ),
    LanguageSignal("no longer needed", Direction.MOTIVATED, _p(r"\b(no\s+longer|dont)\s+need"), 2),
    LanguageSignal("open to offers", Direction.MOTIVATED, _p(r"\bopen\s+to\s+(offers|trade)"), 2),
    LanguageSignal("price reduced", Direction.MOTIVATED, _p(r"\b(price\s+)?reduced\b|\bdrop"), 2),
    LanguageSignal("motivated seller", Direction.MOTIVATED, _p(r"\bmotivated\b"), 3),
    LanguageSignal(
        "deployment or job move",
        Direction.MOTIVATED,
        _p(r"\bdeploy(ing|ment)\b|\bnew\s+job\b|\bschool\b"),
        1,
    ),
)


@dataclass(frozen=True)
class LanguageReading:
    """Phrases found in the description, kept separated by direction."""

    motivated: tuple[str, ...]
    rigid: tuple[str, ...]
    motivated_weight: int
    rigid_weight: int
    #: False when there was no description to read at all, which is different
    #: from a description containing no signals.
    had_text: bool

    @property
    def net_weight(self) -> int:
        """Motivation minus rigidity.

        Reported alongside both raw sides rather than instead of them: a listing
        saying "moving, must sell, firm on price" nets to roughly zero, and that
        is genuinely ambiguous rather than genuinely neutral. The caller sees
        both counts and can tell the two apart.
        """
        return self.motivated_weight - self.rigid_weight

    @property
    def is_contradictory(self) -> bool:
        """Both directions present. Common, and worth surfacing as its own fact."""
        return bool(self.motivated and self.rigid)


def read_seller_language(description: str | None) -> LanguageReading:
    """Extract directional phrases from a listing description."""
    if not description or not description.strip():
        return LanguageReading((), (), 0, 0, had_text=False)

    motivated: list[str] = []
    rigid: list[str] = []
    motivated_weight = 0
    rigid_weight = 0

    for signal in SIGNALS:
        if not signal.pattern.search(description):
            continue
        if signal.direction is Direction.MOTIVATED:
            motivated.append(signal.label)
            motivated_weight += signal.weight
        else:
            rigid.append(signal.label)
            rigid_weight += signal.weight

    return LanguageReading(
        motivated=tuple(motivated),
        rigid=tuple(rigid),
        motivated_weight=motivated_weight,
        rigid_weight=rigid_weight,
        had_text=True,
    )
