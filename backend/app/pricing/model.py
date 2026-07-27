"""Step 3 orchestration: comp set -> expected ASKING price -> rating + confidence.

This is the only module that knows the order the pieces run in. Each piece below
it (`comps`, `regression`, `curve`, `confidence`) is independently testable and
has no knowledge of the others beyond its immediate input type.

SCOPE. Build step 3 only (spec 13.3): "Mileage-adjusted regression, prediction
interval, comp filtering, minimum-comp fallback." Deliberately absent, because
they are later steps and stubbing them here would invite them being wired up
before they are real:

  time on market / negotiation strength   step 4 (spec 6.4)
  flags, seller language, scam patterns   step 5 (spec 6.3)
  VIN decode and recalls                  step 6 (spec 4.2, 6.2)
  better alternatives                     step 7 (spec 6.5)
  composite 0-100 deal score              step 8 (spec 5.2)

`PricingAssessment.price_rating` is the PRICING DIMENSION ONLY. It is not the
composite score and must not be presented as one.
"""

from __future__ import annotations

from dataclasses import dataclass

from . import params
from .comps import CompCandidate, CompSet, filter_comps
from .confidence import ConfidenceAssessment, assess_confidence
from .curve import (
    PricingRating,
    negotiation_anchors,
    rate_price_residual,
    should_publish_anchors,
)
from .regression import AskingPriceEstimate, estimate_expected_asking_price


@dataclass(frozen=True)
class PricingAssessment:
    """Everything step 3 produces for one target listing."""

    target: CompCandidate
    comp_set: CompSet
    estimate: AskingPriceEstimate
    confidence: ConfidenceAssessment
    #: None when there was no estimate, or the target has no asking price.
    rating: PricingRating | None
    #: Spec 5.1's four numbers, in cents. Empty when there is no estimate.
    anchors: dict[str, int]

    @property
    def ask_cents(self) -> int | None:
        return self.target.price_cents

    @property
    def residual_fraction(self) -> float | None:
        return self.estimate.residual_fraction(self.ask_cents)


def assess_listing(
    target: CompCandidate,
    candidates: list[CompCandidate],
    *,
    year_window: int = params.YEAR_WINDOW,
    coverage: float = params.INTERVAL_COVERAGE,
    location_scoped: bool | None = None,
) -> PricingAssessment:
    """Run the full step-3 pipeline for one target listing.

    The four stages are kept in this order on purpose: filtering decides what
    counts as evidence, the fit turns evidence into an expected asking price,
    the curve turns the target's distance from that into a pricing reading, and
    confidence reports separately how much of it to believe.
    """
    comp_set = filter_comps(
        target, candidates, year_window=year_window, location_scoped=location_scoped
    )
    estimate = estimate_expected_asking_price(comp_set, coverage=coverage)
    confidence = assess_confidence(comp_set, estimate, target.price_cents)

    rating: PricingRating | None = None
    anchors: dict[str, int] = {}

    residual = estimate.residual_fraction(target.price_cents)
    if residual is not None:
        rating = rate_price_residual(residual)

    # Anchors are withheld, not softened, when the comp set cannot support a
    # specific dollar figure. A buyer repeats these numbers to a stranger, so a
    # wrong one costs them real money and a vague one costs them nothing.
    if should_publish_anchors(
        estimate.expected_asking_cents,
        estimate.asking_interval_low_cents,
        estimate.asking_interval_high_cents,
    ):
        assert estimate.expected_asking_cents is not None
        assert estimate.asking_interval_low_cents is not None
        assert estimate.asking_interval_high_cents is not None
        anchors = negotiation_anchors(
            estimate.expected_asking_cents,
            estimate.asking_interval_low_cents,
            estimate.asking_interval_high_cents,
        )

    return PricingAssessment(
        target=target,
        comp_set=comp_set,
        estimate=estimate,
        confidence=confidence,
        rating=rating,
        anchors=anchors,
    )
