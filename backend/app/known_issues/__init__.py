"""Ownership cost context: spec 6.6, the one LLM call in the product.

    "Price is not value. A cheap BMW is not a cheap car."

    params.py   model choice, mileage bands, cost rates, gate phrases
    gate.py     spec 10's deterministic checks -- when NOT to spend a call
    prompt.py   the system prompt and the structured output shape
    guard.py    spec 6.6's hard rule: no dollar figures reach a user
    client.py   cache read, the call, cost accounting
    service.py  gate-then-fetch, shared by the eager evaluation and the
                on-demand AI Insights endpoint so they can't drift apart

WHAT MAKES THIS DIFFERENT FROM EVERY OTHER DIMENSION
----------------------------------------------------
Everything else in this evaluation is deterministic: the same capture produces
the same output forever, and any number can be traced to a comp or a keyword.
This module cannot make that promise. So it is fenced in three ways:

  1. It is QUALITATIVE ONLY. Nothing here feeds the deal score, the price, or
     any rating. Spec 5.2's weights do not include it, and adding it would let
     unverifiable text move a number that spec 9 has to be able to calibrate.
  2. It states NO FIGURES (`guard.py`), enforced in code rather than by prompt.
  3. It is OPTIONAL. With no API key, or behind spec 10's gate, the rest of the
     evaluation is unchanged and the section explains its own absence.
"""

from __future__ import annotations

from .client import KnownIssuesReading, fetch_known_issues
from .gate import GateDecision, evaluate_gate, find_disqualifier
from .guard import contains_currency, scrub_bullets
from .params import cost_microdollars, mileage_band
from .prompt import KnownIssuesReport
from .service import known_issues_reading

__all__ = [
    "GateDecision",
    "KnownIssuesReading",
    "KnownIssuesReport",
    "contains_currency",
    "cost_microdollars",
    "evaluate_gate",
    "fetch_known_issues",
    "find_disqualifier",
    "known_issues_reading",
    "mileage_band",
    "scrub_bullets",
]
