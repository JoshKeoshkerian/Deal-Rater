"""Gate-then-fetch orchestration, shared by every caller of spec 6.6's call.

Two callers need the exact same "run the gate, then maybe fetch" sequence:
the eager evaluation (`evaluation/__init__.py`, which must never spend money
on a plain page load) and the on-demand endpoint the AI Insights click hits
(`api/evaluations.py`, which is the only place allowed to). Duplicating the
sequence between them risks the two drifting -- one forgetting a check the
other has -- so it lives here once and both call it.
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from ..config import Settings
from ..flags import TitleReading
from .client import KnownIssuesReading, fetch_known_issues
from .gate import evaluate_gate


def known_issues_reading(
    session: Session,
    settings: Settings,
    *,
    title: TitleReading,
    description: str | None,
    year: int | None,
    make: str | None,
    model: str | None,
    trim: str | None,
    mileage: int | None,
    pricing_band: str | None,
    offline: bool = False,
    network_allowed: bool = True,
) -> KnownIssuesReading:
    """Spec 6.6's section, behind spec 10's gate.

    The gate runs FIRST and unconditionally, before the cache is even
    consulted. A salvage-title listing should report the salvage title
    whether or not the answer for that vehicle happens to be sitting in the
    cache already -- spec 10's checks are about relevance as much as cost.
    """
    decision = evaluate_gate(
        title=title,
        description=description,
        pricing_band=pricing_band,
        year=year,
        make=make,
        model=model,
    )
    if not decision.allowed:
        return KnownIssuesReading(
            unavailable_reason=decision.reason,
            skip_code=decision.code,
        )

    # The gate guarantees these three are present.
    return fetch_known_issues(
        session,
        settings,
        year=year,
        make=make,
        model=model,
        trim=trim,
        mileage=mileage,
        offline=offline,
        network_allowed=network_allowed,
    )
