"""Map an `Evaluation` onto its wire schema (spec 7).

Kept separate from both the evaluation package and the API layer: the dimension
modules stay free of Pydantic, and the endpoint stays free of field-by-field
mapping. The one rule enforced here is spec 7.4's -- the seller section is None
when there is nothing to say, rather than an empty object a UI would render as a
heading with nothing under it.
"""

from __future__ import annotations

from ..evaluation import Evaluation
from ..pricing.loader import StoredCapture
from ..schemas import (
    AlternativeOut,
    AlternativesOut,
    DealScoreOut,
    EvaluationOut,
    KnownIssuesOut,
    NegotiationOut,
    PricingOut,
    ScoreComponentOut,
    SellerRiskOut,
    VehicleRiskOut,
    WithheldAlternativeOut,
)


def _vehicle_label(capture: StoredCapture) -> str:
    t = capture.target
    parts = [str(t.year) if t.year else None, t.make, t.model, t.trim_text]
    return " ".join(p for p in parts if p) or "Unidentified vehicle"


def evaluation_to_schema(capture: StoredCapture, evaluation: Evaluation) -> EvaluationOut:
    pricing = evaluation.pricing
    estimate = pricing.estimate
    negotiation = evaluation.negotiation
    risk = evaluation.vehicle_risk
    scam = evaluation.scam

    suggested_offer: int | None = None
    if pricing.anchors:
        base = pricing.anchors["strong_offer_cents"]
        suggested_offer = int(base * (1.0 - negotiation.extra_discount))

    # Spec 6.6. Absent far more often than present -- no key, spec 10's gate, or
    # a failed call -- so both halves are always emitted and exactly one of them
    # is populated.
    known = evaluation.known_issues
    known_issues: KnownIssuesOut | None = None
    if known.report is not None:
        known_issues = KnownIssuesOut(
            summary=known.report.summary,
            failure_modes=list(known.report.failure_modes),
            inspect=list(known.report.inspect),
            ask=list(known.report.ask),
            ownership_notes=list(known.report.ownership_notes),
            model=known.llm_model,
            mileage_band=known.mileage_band,
            generated_at=known.generated_at,
            cached=known.cache_hit,
        )

    seller_risk: SellerRiskOut | None = None
    if evaluation.has_seller_section:
        messages = list(scam.explain())
        if negotiation.seller.is_dealer:
            messages.insert(
                0,
                "This appears to be a dealer listing rather than the private-party "
                "sale this tool is built to evaluate. Dealer asking prices carry "
                "reconditioning, warranty and overhead.",
            )
        if (
            evaluation.seller_rating_average is not None
            and evaluation.seller_rating_count is not None
        ):
            messages.append(
                f"Seller has a {evaluation.seller_rating_average:g}/5 star rating from "
                f"{evaluation.seller_rating_count} review"
                f"{'s' if evaluation.seller_rating_count != 1 else ''} on Marketplace."
            )
        seller_risk = SellerRiskOut(
            seller_type=negotiation.seller.seller_type.value,
            dealer_markers=list(negotiation.seller.markers),
            scam_warning=scam.warn,
            scam_signals_fired=[r.signal.value for r in scam.fired],
            scam_signals_evaluable=len(scam.evaluable),
            scam_signals_total=len(scam.results),
            scam_reduced_sensitivity=scam.reduced_sensitivity,
            seller_rating_average=evaluation.seller_rating_average,
            seller_rating_count=evaluation.seller_rating_count,
            messages=messages,
        )

    return EvaluationOut(
        capture_id=capture.capture_id,
        headline=evaluation.headline(),
        vehicle=_vehicle_label(capture),
        deal_score=DealScoreOut(
            score=evaluation.deal_score.score,
            components=[
                ScoreComponentOut(
                    name=c.name,
                    weight=c.weight,
                    value=c.value,
                    unavailable_reason=c.unavailable_reason,
                )
                for c in evaluation.deal_score.components
            ],
            coverage=evaluation.deal_score.coverage,
            suppressed_reason=evaluation.deal_score.suppressed_reason,
            beta=evaluation.deal_score.beta,
        ),
        pricing=PricingOut(
            ask_cents=pricing.ask_cents,
            expected_asking_cents=estimate.expected_asking_cents,
            asking_interval_low_cents=estimate.asking_interval_low_cents,
            asking_interval_high_cents=estimate.asking_interval_high_cents,
            interval_coverage=estimate.coverage,
            strong_offer_cents=pricing.anchors.get("strong_offer_cents"),
            walk_away_above_cents=pricing.anchors.get("walk_away_above_cents"),
            residual_fraction=pricing.residual_fraction,
            rating=pricing.rating.rating if pricing.rating else None,
            rating_band=pricing.rating.band if pricing.rating else None,
            rating_calibrated=pricing.rating.calibrated if pricing.rating else False,
            estimator=estimate.kind.value,
            comps_included=estimate.n_included,
            comps_with_mileage=estimate.n_fit_points,
            year_window=pricing.comp_set.year_window,
            year_window_widened=pricing.comp_set.year_window_widened,
            confidence=pricing.confidence.level.value,
            confidence_reasons=pricing.confidence.explain(),
            confidence_limiters=[limiter.value for limiter in pricing.confidence.limiters],
            fallback_reasons=list(estimate.fallback_reasons),
        ),
        vehicle_risk=VehicleRiskOut(
            title_risk=evaluation.title.risk.value,
            title_message=evaluation.title.message,
            decoded_spec=risk.spec.summary if risk.spec else None,
            recall_count=risk.recall_count,
            complaint_count=risk.complaint_count,
            top_complaint_components=risk.top_complaint_components(),
            messages=risk.messages(),
        ),
        seller_risk=seller_risk,
        negotiation=NegotiationOut(
            leverage=negotiation.leverage.value,
            strength=negotiation.strength,
            days_listed=negotiation.days_listed,
            time_on_market_score=negotiation.time_on_market_score,
            leverage_points=list(negotiation.leverage_points),
            suggested_offer_cents=suggested_offer,
            motivated_phrases=list(negotiation.language.motivated),
            rigid_phrases=list(negotiation.language.rigid),
        ),
        alternatives=AlternativesOut(
            message=evaluation.alternatives.message(),
            target_is_best=evaluation.alternatives.target_is_best,
            items=[
                AlternativeOut(
                    description=a.describe(),
                    url=a.url,
                    price_cents=a.candidate.price_cents,
                    mileage=a.candidate.mileage,
                    location_text=a.candidate.location_text,
                    advantage=a.advantage,
                    mileage_tradeoff=a.mileage_tradeoff,
                )
                for a in evaluation.alternatives.alternatives
            ],
            withheld=[
                WithheldAlternativeOut(
                    description=w.describe(),
                    url=w.url,
                    price_cents=w.candidate.price_cents,
                    mileage=w.candidate.mileage,
                    location_text=w.candidate.location_text,
                    reason=w.reason,
                )
                for w in evaluation.alternatives.withheld
            ],
        ),
        known_issues=known_issues,
        known_issues_unavailable_reason=known.unavailable_reason,
        known_issues_unavailable_code=known.skip_code,
        notices=list(evaluation.notices),
    )
