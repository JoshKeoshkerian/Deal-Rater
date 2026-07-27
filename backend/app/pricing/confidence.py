"""Confidence in the expected-asking-price estimate.

CONFIDENCE IS A SEPARATE OUTPUT AND IS NEVER FOLDED INTO THE PRICE.

Spec 6.4 calls confidence "a qualifier rather than a peer metric". Spec 2
forbids collapsing distinct readings into one number. So nothing in this module
returns a modified price, a modified interval, or a modified rating: it takes
the finished estimate and reports separately how much of it to believe.

Spec 2 also assigns one specific job here: "an unexplained extreme discount
should reduce confidence rather than inflate the score." That is implemented as
`ADVERSE_SELECTION` below. It is the reason the discount penalty is not in
`curve.py` -- putting it there would express suspicion as a price, which is the
conflation the spec rules out.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

from . import params
from .comps import CompSet, DealerSignal
from .regression import AskingPriceEstimate, EstimatorKind


class Confidence(StrEnum):
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"
    NONE = "none"


class Limiter(StrEnum):
    """A specific, named reason confidence is not higher.

    Enumerated rather than free text so the distribution can be counted across
    captures. If one limiter dominates, that is a roadmap item, not a tuning
    problem -- and on current data that limiter is COMP_COUNT.
    """

    NO_ESTIMATE = "no_estimate"
    COMP_COUNT = "comp_count"
    NO_MILEAGE_ADJUSTMENT = "no_mileage_adjustment"
    WIDE_INTERVAL = "wide_interval"
    TRIM_UNKNOWN = "trim_unknown"
    TRIM_DISAGREEMENT = "trim_disagreement"
    MILEAGE_EXTRAPOLATION = "mileage_extrapolation"
    ADVERSE_SELECTION = "adverse_selection"
    WRONG_MARKET = "wrong_market"
    DEALER_FILTERING_UNAVAILABLE = "dealer_filtering_unavailable"
    NO_RECENCY_WEIGHTING = "no_recency_weighting"
    WEAK_MILEAGE_FIT = "weak_mileage_fit"
    OUTLIER_SENSITIVE = "outlier_sensitive"


#: Human-readable text per limiter, shown by the CLI and later the overlay.
LIMITER_TEXT: dict[Limiter, str] = {
    Limiter.NO_ESTIMATE: "Not enough comparable listings to estimate an expected asking price.",
    Limiter.COMP_COUNT: "Fewer comparable listings than the model wants.",
    Limiter.NO_MILEAGE_ADJUSTMENT: (
        "No mileage adjustment was possible; this is a median of comparable asks."
    ),
    Limiter.WIDE_INTERVAL: "Comparable asks are spread widely, so the expected range is broad.",
    Limiter.TRIM_UNKNOWN: (
        "Trim could not be determined for most comparable listings, so they may not be "
        "the same specification."
    ),
    Limiter.TRIM_DISAGREEMENT: (
        "Most comparable listings appear to be a different trim from this vehicle."
    ),
    Limiter.MILEAGE_EXTRAPOLATION: (
        "This vehicle's mileage sits outside the range the comparable listings cover, "
        "so its expected asking price is extrapolated."
    ),
    Limiter.ADVERSE_SELECTION: (
        "The asking price is far below comparable listings with no stated reason. "
        "Unexplained discounts this deep are more often a problem than a bargain."
    ),
    Limiter.WRONG_MARKET: (
        "Comparable listings were not confined to this vehicle's area, so they may "
        "describe a different market."
    ),
    Limiter.DEALER_FILTERING_UNAVAILABLE: (
        "Dealer listings could not be filtered out of the comparison set, so retail "
        "pricing may be inflating the expected asking price."
    ),
    Limiter.NO_RECENCY_WEIGHTING: (
        "Comparable listings carry no posted date, so a long-stale ask counts as much "
        "as a fresh one."
    ),
    Limiter.WEAK_MILEAGE_FIT: "Mileage explains little of the spread in comparable asks.",
    Limiter.OUTLIER_SENSITIVE: (
        "The expected asking price rests heavily on one or two comparable listings; "
        "a fit that discounts outliers gives a materially different answer."
    ),
}


@dataclass(frozen=True)
class ConfidenceAssessment:
    level: Confidence
    limiters: tuple[Limiter, ...]

    def explain(self) -> list[str]:
        return [LIMITER_TEXT[limiter] for limiter in self.limiters]


def assess_confidence(
    comp_set: CompSet,
    estimate: AskingPriceEstimate,
    ask_cents: int | None,
) -> ConfidenceAssessment:
    """Report how much to believe the estimate, without touching the estimate."""
    if not estimate.has_estimate:
        return ConfidenceAssessment(Confidence.NONE, (Limiter.NO_ESTIMATE,))

    limiters: list[Limiter] = []

    # --- structural gaps that apply to every evaluation at step 3 -----------
    # Both are permanent until the data exists, and both genuinely bias the
    # expected asking price upward (spec 1: dealer listings carry reconditioning
    # markup, so an unfiltered comp set makes any listing look like a bargain).
    if comp_set.dealer_filtering is DealerSignal.UNAVAILABLE:
        limiters.append(Limiter.DEALER_FILTERING_UNAVAILABLE)
    limiters.append(Limiter.NO_RECENCY_WEIGHTING)

    # --- comp set thickness -------------------------------------------------
    n = estimate.n_included
    if n < params.MIN_COMPS_FOR_REGRESSION:
        limiters.append(Limiter.COMP_COUNT)

    if estimate.kind is EstimatorKind.COMP_MEDIAN:
        limiters.append(Limiter.NO_MILEAGE_ADJUSTMENT)

    # --- comp set cleanliness (spec 4.3) ------------------------------------
    if comp_set.trim_coverage < params.MIN_TRIM_COVERAGE:
        limiters.append(Limiter.TRIM_UNKNOWN)
    elif comp_set.trim_agreement < 0.5:
        limiters.append(Limiter.TRIM_DISAGREEMENT)

    if comp_set.location_scoped is False:
        limiters.append(Limiter.WRONG_MARKET)

    # --- fit quality --------------------------------------------------------
    if estimate.kind is EstimatorKind.MILEAGE_REGRESSION:
        if estimate.r_squared is not None and estimate.r_squared < 0.25:
            limiters.append(Limiter.WEAK_MILEAGE_FIT)

        sensitivity = estimate.outlier_sensitivity
        if sensitivity is not None and sensitivity > params.MAX_ROBUST_DISAGREEMENT:
            limiters.append(Limiter.OUTLIER_SENSITIVE)

        mileages = [
            d.candidate.mileage for d in comp_set.fit_points if d.candidate.mileage is not None
        ]
        target_mileage = comp_set.target.mileage
        if mileages and target_mileage is not None:
            if target_mileage < min(mileages) or target_mileage > max(mileages):
                limiters.append(Limiter.MILEAGE_EXTRAPOLATION)

    if (
        estimate.expected_asking_cents
        and estimate.asking_interval_low_cents is not None
        and estimate.asking_interval_high_cents is not None
    ):
        width = estimate.asking_interval_high_cents - estimate.asking_interval_low_cents
        if width / estimate.expected_asking_cents > 0.35:
            limiters.append(Limiter.WIDE_INTERVAL)

    # --- adverse selection (spec 2) -----------------------------------------
    # The explicit instruction: an unexplained extreme discount reduces
    # confidence. It does NOT reduce the price rating -- see curve.py.
    residual = estimate.residual_fraction(ask_cents)
    if residual is not None and residual <= params.ADVERSE_SELECTION_RESIDUAL:
        limiters.append(Limiter.ADVERSE_SELECTION)

    # --- roll up ------------------------------------------------------------
    # Some limiters are disqualifying on their own rather than merely additive:
    # a comp set drawn from the wrong metro is not weak evidence, it is evidence
    # about a different question.
    disqualifying = {Limiter.WRONG_MARKET, Limiter.TRIM_DISAGREEMENT}
    if any(limiter in disqualifying for limiter in limiters):
        level = Confidence.LOW
    elif estimate.kind is EstimatorKind.COMP_MEDIAN or n < params.MIN_COMPS_FOR_REGRESSION:
        level = Confidence.LOW
    elif n >= params.COMPS_FOR_HIGH_CONFIDENCE and len(limiters) <= 2:
        # <= 2 because the two structural gaps above are always present, so this
        # means "nothing wrong beyond what is wrong with every evaluation".
        level = Confidence.HIGH
    else:
        level = Confidence.MEDIUM

    return ConfidenceAssessment(level, tuple(limiters))
