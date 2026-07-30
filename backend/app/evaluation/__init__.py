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
    TitleRisk,
    assess_completeness,
    assess_scam_patterns,
    read_title_status,
)
from ..known_issues import KnownIssuesReading, evaluate_gate, fetch_known_issues
from ..negotiation import (
    NegotiationAssessment,
    OfferPlan,
    assess_negotiation,
    draft_opening_message,
    plan_offer,
    vehicle_phrase,
)
from ..nhtsa import assess_vehicle, enrich_target
from ..pricing import Limiter, PricingAssessment, assess_listing
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
        stated_seller_type=capture.target.seller_type,
    )
    title = read_title_status(capture.target_title_status)
    completeness = assess_completeness(
        description=capture.target_description,
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

    offer, opening_message = _offer_and_message(capture, pricing, negotiation)

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
        offer=offer,
        opening_message=opening_message,
        title=title,
        completeness=completeness,
        vehicle_risk=vehicle_risk,
        scam=scam,
        alternatives=alternatives,
        deal_score=deal_score,
        known_issues=known_issues,
        seller_rating_average=capture.target_seller_rating_average,
        seller_rating_count=capture.target_seller_rating_count,
        extra_notices=_title_explains_discount_notice(pricing, title),
    )


def _offer_and_message(
    capture: StoredCapture,
    pricing: PricingAssessment,
    negotiation: NegotiationAssessment,
) -> tuple[OfferPlan, str | None]:
    """Spec 7.5's offer figures, and the message that carries them.

    THE ONE JUDGEMENT MADE HERE: whether the offer may be anchored to the comp
    set. `plan_offer` takes `expected_asking_cents=None` unless pricing PUBLISHED
    its anchors, because `should_publish_anchors` is pricing's own statement about
    whether the comp set supports a dollar figure at all, and the negotiation
    module has no business re-deciding it. When it did not, the plan falls back to
    an ask-anchored one, which makes the weaker claim and says so
    (`negotiation/offer.py`).

    That distinction is not a rare branch. `MAX_INTERVAL_WIDTH_FOR_ANCHORS`
    withholds the anchors on roughly 95% of real evaluations, so the ask-anchored
    path is the normal one and the comp-anchored path is the exception.
    """
    published = bool(pricing.anchors)
    band = pricing.rating.band if pricing.rating else None

    offer = plan_offer(
        ask_cents=pricing.ask_cents,
        expected_asking_cents=pricing.estimate.expected_asking_cents if published else None,
        walk_away_cents=pricing.anchors.get("walk_away_above_cents"),
        negotiation=negotiation,
        overpriced=band == "overpriced",
    )

    # The range only reaches the draft when pricing published anchors -- quoting a
    # range this tool itself withheld would put a number in the buyer's mouth
    # that nothing here stands behind.
    message = draft_opening_message(
        vehicle=vehicle_phrase(capture.target.year, capture.target.make, capture.target.model),
        plan=offer,
        negotiation=negotiation,
        expected_low_cents=pricing.estimate.asking_interval_low_cents if published else None,
        expected_high_cents=pricing.estimate.asking_interval_high_cents if published else None,
        ask_cents=pricing.ask_cents,
    )
    return offer, message


def _title_explains_discount_notice(
    pricing: PricingAssessment, title: TitleReading
) -> tuple[str, ...]:
    """Connect two dimensions the pricing and vehicle-risk modules never see
    each other's output to compute (spec 6 forbids it there).

    The comp set carries no title status (spec 4.3), so the expected asking
    price is, in effect, a clean-title benchmark. When the price residual is
    deep enough to trip `Limiter.ADVERSE_SELECTION`, pricing's own confidence
    text says the discount has "no stated reason" -- which is true of what
    pricing looked at, but not true of the listing: a branded or disqualifying
    title is exactly such a stated reason, it is just read by a different
    dimension. Left alone, a buyer sees both statements separately and has to
    notice the contradiction themselves.
    """
    if title.risk not in (TitleRisk.BRANDED, TitleRisk.DISQUALIFYING):
        return ()
    if Limiter.ADVERSE_SELECTION not in pricing.confidence.limiters:
        return ()
    return (
        "This vehicle's title is "
        f"{title.risk.value}, which is a stated reason the price may sit below "
        "comparable listings. The expected asking price above is not adjusted "
        "for title status -- comp listings rarely state theirs -- so treat it "
        "as a clean-title benchmark, not a same-title one.",
    )
