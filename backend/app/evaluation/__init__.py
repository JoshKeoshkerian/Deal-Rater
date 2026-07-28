"""Full evaluation: all dimensions, one payload (spec 5.2, 7, build step 8).

    score.py   spec 5.2's composite headline, plus the breakdown that keeps it
               honest
    report.py  spec 7's output structure and the notices that ship with it

This is the only module that knows about all four dimensions at once. Each of
`pricing`, `negotiation`, `flags`, `nhtsa` and `alternatives` still knows nothing
about the others, which is what spec 6's separation requires and what keeps any
one of them testable on its own.
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from ..alternatives import find_alternatives
from ..config import Settings, get_settings
from ..flags import (
    TitleReading,
    assess_completeness,
    assess_scam_patterns,
    read_title_status,
)
from ..known_issues import KnownIssuesReading, evaluate_gate, fetch_known_issues
from ..negotiation import assess_negotiation
from ..nhtsa import assess_vehicle, enrich_target
from ..pricing import assess_listing
from ..pricing.loader import StoredCapture
from .report import (
    ASKING_PRICE_NOTICE,
    BETA_NOTICE,
    DISCLAIMER,
    Evaluation,
    build_evaluation,
)
from .score import WEIGHTS, DealScore, ScoreComponent, compute_deal_score

__all__ = [
    "ASKING_PRICE_NOTICE",
    "BETA_NOTICE",
    "DISCLAIMER",
    "WEIGHTS",
    "DealScore",
    "Evaluation",
    "ScoreComponent",
    "build_evaluation",
    "compute_deal_score",
    "evaluate_capture",
]


def _known_issues(
    session: Session,
    capture: StoredCapture,
    settings: Settings,
    *,
    title: TitleReading,
    pricing_band: str | None,
    offline: bool,
) -> KnownIssuesReading:
    """Spec 6.6's section, behind spec 10's gate.

    The gate runs FIRST and unconditionally, before the cache is even consulted.
    A salvage-title listing should report the salvage title whether or not the
    answer for that vehicle happens to be sitting in the cache already -- spec
    10's checks are about relevance as much as cost.
    """
    decision = evaluate_gate(
        title=title,
        description=capture.target_description,
        pricing_band=pricing_band,
        year=capture.target.year,
        make=capture.target.make,
        model=capture.target.model,
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
        year=capture.target.year,
        make=capture.target.make,
        model=capture.target.model,
        trim=capture.target.trim_text,
        mileage=capture.target.mileage,
        offline=offline,
    )


def evaluate_capture(
    session: Session,
    capture: StoredCapture,
    *,
    offline: bool = False,
    settings: Settings | None = None,
) -> Evaluation:
    """Run every dimension over one stored capture.

    Order matters in two places.

    The VIN decode runs FIRST, because spec 13.6 defines step 6 as "NHTSA
    integration; feed decoded trim back into comp matching" and a decode that
    arrives after the comp set is filtered cannot feed anything. `enrich_target`
    fills a missing trim from the decode; it never overwrites a stated one.

    This is NOT a risk finding moving a price, which spec 2 forbids. What
    crosses over is the decoded SPECIFICATION -- the factory trim, a fact about
    which vehicle this is -- and it crosses over to decide which listings are
    comparable. The risk half of the same assessment (recalls, complaints) is
    read only by the vehicle-risk dimension and never reaches the fit.

    Then pricing runs before the rest, because the negotiation interaction
    (spec 6.4), the scam discount signal (spec 6.3), the alternatives ranking
    (spec 6.5) and spec 10's cost gate all take the price residual or its band
    as an input. Nothing flows back the other way.
    """
    settings = settings or get_settings()
    vehicle_risk = assess_vehicle(
        session,
        vin=capture.target_vin,
        year=capture.target.year,
        make=capture.target.make,
        model=capture.target.model,
        offline=offline,
    )
    pricing = assess_listing(
        enrich_target(capture.target, vehicle_risk.spec),
        capture.candidates,
        location_scoped=capture.location_scoped,
    )
    residual = pricing.residual_fraction

    negotiation = assess_negotiation(
        posted_at=capture.target_posted_at,
        observed_at=capture.target_observed_at,
        description=capture.target_description,
        price_residual=residual,
    )
    title = read_title_status(capture.target_title_status)
    completeness = assess_completeness(
        description=capture.target_description,
        photo_count=capture.target_photo_count,
        mileage=capture.target.mileage,
        title_status=capture.target_title_status,
        vin=capture.target_vin,
        year=capture.target.year,
        trim_text=capture.target.trim_text,
    )
    scam = assess_scam_patterns(
        description=capture.target_description,
        photo_count=capture.target_photo_count,
        vin=capture.target_vin,
        price_residual=residual,
        price_changed=capture.target_price_changed,
    )
    alternatives = find_alternatives(
        pricing.target,
        pricing.comp_set.included,
        pricing.estimate,
        pricing.confidence.level,
    )
    deal_score = compute_deal_score(
        rating=pricing.rating,
        completeness=completeness,
        title=title,
        vehicle_risk=vehicle_risk,
        scam=scam,
        seller_rating_average=capture.target_seller_rating_average,
        seller_rating_count=capture.target_seller_rating_count,
    )

    # Last, and deliberately outside `compute_deal_score`: spec 6.6 is
    # qualitative context, not a scored dimension (spec 5.2 lists four weights
    # and this is none of them).
    known_issues = _known_issues(
        session,
        capture,
        settings,
        title=title,
        pricing_band=pricing.rating.band if pricing.rating else None,
        offline=offline,
    )

    return build_evaluation(
        pricing=pricing,
        negotiation=negotiation,
        title=title,
        completeness=completeness,
        vehicle_risk=vehicle_risk,
        scam=scam,
        alternatives=alternatives,
        deal_score=deal_score,
        known_issues=known_issues,
        seller_rating_average=capture.target_seller_rating_average,
        seller_rating_count=capture.target_seller_rating_count,
    )
