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
from ..flags import assess_completeness, assess_scam_patterns, read_title_status
from ..negotiation import assess_negotiation
from ..nhtsa import assess_vehicle
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


def evaluate_capture(
    session: Session,
    capture: StoredCapture,
    *,
    offline: bool = False,
) -> Evaluation:
    """Run every dimension over one stored capture.

    Order matters in one place only: pricing runs first, because the negotiation
    interaction (spec 6.4), the scam discount signal (spec 6.3) and the
    alternatives ranking (spec 6.5) all take the price residual as an input.
    Nothing flows the other way -- no risk or negotiation finding is allowed to
    move a price (spec 2).
    """
    pricing = assess_listing(
        capture.target, capture.candidates, location_scoped=capture.location_scoped
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
    vehicle_risk = assess_vehicle(
        session,
        vin=capture.target_vin,
        year=capture.target.year,
        make=capture.target.make,
        model=capture.target.model,
        offline=offline,
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
        pricing.rating.rating if pricing.rating else None,
    )
    deal_score = compute_deal_score(
        rating=pricing.rating,
        negotiation=negotiation,
        completeness=completeness,
        title=title,
        vehicle_risk=vehicle_risk,
        scam=scam,
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
    )
