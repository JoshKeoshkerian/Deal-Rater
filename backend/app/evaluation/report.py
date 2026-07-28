"""The full evaluation, in spec 7's output order (build step 8).

Spec 7:

    1. Headline: deal score, confidence, and the expected price comparison
    2. Pricing: the four-number range from section 5.1
    3. Vehicle risk: known issues, recalls, title flags
    4. Seller and scam risk: ONLY WHEN THERE IS SOMETHING TO SAY
    5. Negotiation: strength, leverage points, suggested offer with reasoning
    6. Better alternatives
    7. What to check on this specific car

Item 7 is spec 6.6's cached LLM call -- the only non-deterministic part of this
payload. It carries its own unavailable reason (see `app/known_issues`) because
there are several ways for it to be absent (no API key, spec 10's cost gate, a
failed call) and a renderer should not have to guess which.

IT DOES NOT FEED THE SCORE. Spec 5.2's weights cover four dimensions and this is
not one of them. Qualitative text that cannot be calibrated against spec 9's
ground truth set must not be able to move a number that spec 9 has to calibrate.

Item 4's "only when there is something to say" is honoured literally: the seller
section is None when nothing fired, rather than an empty heading.

LIABILITY FRAMING IS PART OF THE PAYLOAD, NOT THE TERMS
-------------------------------------------------------
Spec 7: "informational analysis of a listing, not a purchase recommendation, and
never a substitute for a pre-purchase inspection or vehicle history report. IN
THE UI, not just the terms." So `DISCLAIMER` ships inside the evaluation itself,
where a renderer cannot forget it.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from ..alternatives import AlternativesResult
from ..flags import CompletenessReading, ScamAssessment, TitleReading
from ..known_issues import KnownIssuesReading
from ..known_issues.client import NOT_REQUESTED_CODE, NOT_REQUESTED_REASON
from ..negotiation import NegotiationAssessment
from ..nhtsa import VehicleRiskAssessment
from ..pricing import PricingAssessment
from .score import SELLER_RATING_MIN_REVIEWS, DealScore

DISCLAIMER = (
    "Informational analysis of a listing, not a purchase recommendation. Never a "
    "substitute for a pre-purchase inspection or a vehicle history report."
)

#: Spec 9: "Until step 1 is done, present output as a beta signal, not an
#: authoritative rating." Step 1 is the manual ground truth set, which does not
#: exist, so this ships on every evaluation.
BETA_NOTICE = (
    "Beta signal, not an authoritative rating. The scoring weights and the "
    "discount curve are starting hypotheses that have not been checked against "
    "hand-evaluated listings yet."
)

ASKING_PRICE_NOTICE = (
    "Marketplace shows asking prices, not sale prices. Every figure here "
    "describes how comparable vehicles are ADVERTISED, not what they sell for."
)


@dataclass(frozen=True)
class Evaluation:
    """One listing, fully assessed, in spec 7's order."""

    # 1. Headline
    deal_score: DealScore
    pricing: PricingAssessment

    # 2-6
    title: TitleReading
    completeness: CompletenessReading
    vehicle_risk: VehicleRiskAssessment
    scam: ScamAssessment
    negotiation: NegotiationAssessment
    alternatives: AlternativesResult

    # The seller's Marketplace star rating (spec 6.3), read straight off the
    # listing page. A reputation number, not identity -- see
    # `SellerObservation`'s docstring. Caps `seller_and_scam_risk` directly
    # (`score.py`'s `_seller_rating_ceiling`); kept here too so the report can
    # say WHY, rather than the cap acting silently on a number the user can't
    # trace back to anything.
    seller_rating_average: float | None = None
    seller_rating_count: int | None = None

    # 7. Spec 6.6's cached, qualitative-only ownership context.
    known_issues: KnownIssuesReading = field(
        default_factory=lambda: KnownIssuesReading(
            unavailable_reason=NOT_REQUESTED_REASON, skip_code=NOT_REQUESTED_CODE
        )
    )

    notices: tuple[str, ...] = field(
        default_factory=lambda: (BETA_NOTICE, ASKING_PRICE_NOTICE, DISCLAIMER)
    )

    @property
    def has_seller_section(self) -> bool:
        """Spec 7.4: seller and scam risk appear "only when there is something
        to say"."""
        rating_matters = (
            self.seller_rating_average is not None
            and self.seller_rating_count is not None
            and self.seller_rating_count >= SELLER_RATING_MIN_REVIEWS
        )
        return bool(self.scam.fired) or self.negotiation.seller.is_dealer or rating_matters

    def headline(self) -> str:
        """Spec 7's first line: score, confidence, expected price comparison."""
        confidence = self.pricing.confidence.level.value
        estimate = self.pricing.estimate

        if not estimate.has_estimate:
            return (
                f"No expected asking price: {estimate.n_included} comparable "
                f"listing(s) is too few to say anything. Confidence: {confidence}."
            )

        low = (estimate.asking_interval_low_cents or 0) / 100
        high = (estimate.asking_interval_high_cents or 0) / 100
        ask = (self.pricing.ask_cents or 0) / 100

        score = (
            f"{self.deal_score.score:.0f} / 100"
            if self.deal_score.score is not None
            else "score withheld"
        )
        return (
            f"{score}, {confidence} confidence. Comparable listings suggest an "
            f"expected asking range of ${low:,.0f} to ${high:,.0f}. This asks ${ask:,.0f}."
        )


def build_evaluation(
    *,
    pricing: PricingAssessment,
    negotiation: NegotiationAssessment,
    title: TitleReading,
    completeness: CompletenessReading,
    vehicle_risk: VehicleRiskAssessment,
    scam: ScamAssessment,
    alternatives: AlternativesResult,
    deal_score: DealScore,
    known_issues: KnownIssuesReading | None = None,
    seller_rating_average: float | None = None,
    seller_rating_count: int | None = None,
) -> Evaluation:
    """Assemble the finished evaluation. Pure composition; nothing is computed
    here that the dimension modules did not already decide."""
    return Evaluation(
        deal_score=deal_score,
        pricing=pricing,
        title=title,
        completeness=completeness,
        vehicle_risk=vehicle_risk,
        scam=scam,
        negotiation=negotiation,
        alternatives=alternatives,
        known_issues=known_issues or KnownIssuesReading(),
        seller_rating_average=seller_rating_average,
        seller_rating_count=seller_rating_count,
    )
