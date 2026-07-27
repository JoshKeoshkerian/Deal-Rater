"""Deterministic enforcement of spec 6.6's one hard rule: no dollar figures.

Spec 6.6:

    DO NOT ATTACH DOLLAR ESTIMATES. An LLM asked for "expected maintenance
    $2,800 to $4,600" will produce a confident fabricated number. Real repair
    cost data requires licensing RepairPal or equivalent. Note where insurance
    or maintenance costs diverge sharply from segment norms IN QUALITATIVE TERMS
    ONLY.

Spec 11 defers repair-cost dollar estimates entirely, pending a licensed source.

WHY THIS EXISTS WHEN THE PROMPT ALREADY SAYS SO
-----------------------------------------------
Because a prompt is a request and this is a requirement. The prompt asks the
model not to produce figures; this module guarantees none reach a user. The two
are not redundant -- one of them can fail silently and the other cannot, and the
failure mode being guarded against (a confident fabricated number, presented
next to real regression output) is exactly the false authority spec 9 exists to
prevent.

Detection is deliberately blunt. "$1,200", "1200 dollars" and "a few hundred
dollars" are all the same error, and the last one has no digits in it, so the
rule is: any currency marker at all. Over-rejecting a legitimate sentence that
happened to mention money costs one bullet point. Under-rejecting ships an
invented repair estimate.
"""

from __future__ import annotations

import re

#: Any of: a currency symbol, the word dollar(s), a currency code, or the
#: colloquial forms. Not anchored to digits on purpose -- see the module note.
_CURRENCY = re.compile(
    r"""
    \$                              # $, with or without a number after it
    | \b(?:dollars?|usd|cad|eur|gbp|euros?|pounds?)\b
    | \b(?:bucks|grand)\b
    | \b\d+\s*k\s*(?:to|-|–)\s*\d+\s*k\b   # "2k to 4k", "3k-5k"
    """,
    re.IGNORECASE | re.VERBOSE,
)


def contains_currency(text: str | None) -> bool:
    """True when a piece of model output states or implies a money figure."""
    if not text:
        return False
    return _CURRENCY.search(text) is not None


#: Substituted when the model states a figure in the summary. Written by this
#: codebase, not by the model, and says so: the alternative is either publishing
#: an invented number or throwing away a set of perfectly good findings because
#: one sentence went wrong. Expensive cars provoke this most, which is exactly
#: where the findings are worth keeping.
SUMMARY_WITHHELD = (
    "No summary here: the one written for this vehicle quoted a repair cost, and "
    "this tool does not publish repair-cost figures -- reliable ones need a "
    "licensed data source, and a plausible invented number is worse than none. "
    "The findings below are unchanged."
)


def scrub_bullets(bullets: list[str]) -> tuple[tuple[str, ...], int]:
    """Drop any bullet containing a money figure.

    Returns the surviving bullets and how many were removed. A single bad bullet
    is not worth discarding a whole answer over -- the rest of the list is still
    useful -- so the item is dropped and the count is surfaced rather than
    silently swallowed.
    """
    kept = tuple(b for b in bullets if not contains_currency(b))
    return kept, len(bullets) - len(kept)
