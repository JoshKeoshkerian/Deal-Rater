"""Composite deal score (spec 5.2, build step 8).

Spec 5.2: "A single 0 to 100 score is still worth producing as a headline,
because users want one number and it drives engagement. But it is a SUMMARY of
the separated dimensions in section 6, NOT A REPLACEMENT for them, and the UI
should always show the breakdown alongside it."

So this module produces a number and, inseparably, the components that made it.
`DealScore.components` is not optional detail -- it is the thing that keeps the
headline honest, and every renderer is expected to show it.

THE WEIGHTS ARE HYPOTHESES
--------------------------
Spec 5.2 states its own weights and then says: "These are hypotheses. Section 9
exists to correct them." Section 9 has not run. There is no ground truth set, so
nothing below has been fitted to anything, and `DealScore.beta` is hardcoded
True. Spec 9 closes on the same point: "Until step 1 is done, present output as a
beta signal, not an authoritative rating."

TWO PLACES THIS DEPARTS FROM A NAIVE WEIGHTED SUM
-------------------------------------------------
1. A SCAM WARNING SUPPRESSES THE SCORE RATHER THAN DEDUCTING FROM IT.

   Spec 5.2 gives seller and scam risk a weight of 8. Spec 6.3 says the opposite
   about how it should surface: "a distinct, prominent warning rather than a
   numerical deduction buried in a composite... Four together is a strong signal".

   Both hold, at different strengths. Individual signals contribute their 8
   points. But once four fire together -- the threshold spec 6.3 calls strong --
   deducting 8 from 100 and printing "84/100" would be actively misleading, and
   is exactly the burial 6.3 forbids. At that point the score is withheld and
   the warning stands alone.

2. A MISSING DIMENSION IS NOT A ZERO.

   Most listings have no VIN, so vehicle risk is often unknown. Scoring unknown
   as zero would punish a listing for what the tool could not look up. Absent
   components are dropped and the remaining weights renormalised, with
   `coverage` reporting how much of the intended weight was actually available.
"""

from __future__ import annotations

from dataclasses import dataclass

from ..flags import CompletenessReading, ScamAssessment, TitleReading, TitleRisk
from ..flags.completeness import TitleRisk as _TitleRisk
from ..nhtsa import VehicleRiskAssessment
from ..pricing.curve import PricingRating

#: Spec 5.2's starting weights. UNCALIBRATED.
#:
#: Spec 5.2 originally listed "Time on market: 20" here too. Removed: spec 6.4
#: opens by insisting negotiation strength is "genuinely orthogonal to deal
#: quality... surface this inside the brief rather than as a third headline
#: number", which this composite directly contradicted. Concretely,
#: `negotiation/strength.py` scores a listing under a day old at 0 and a very
#: stale one at 100 on this axis -- so a fresh, excellent, correctly-priced
#: listing lost up to 20 of 100 points for no reason related to deal quality.
#: Time on market still does real work; it just belongs to spec 6.4's
#: negotiation section (`NegotiationAssessment`), which already computed it
#: independently of this composite and needed no change.
#:
#: `vehicle_risk` raised from 12 to 20 (pre-rescale), taken from
#: `information_completeness` (15 -> 7) rather than from `price_residual` (the
#: required dimension, see `REQUIRED_COMPONENTS`) or `seller_and_scam_risk`
#: (which already has its own suppression path for real severity via
#: `scam.warn`, so its weight carries less of the load). Completeness was the
#: thinnest signal of the four.
#:
#: Rescaled from an 80-point total to a 100-point one (same ratios, so
#: scoring behaviour is unchanged -- `compute_deal_score` renormalises by
#: whatever weight is actually covered, not by a fixed total) so each number
#: here can be shown verbatim as a percent next to its dimension in the UI.
WEIGHTS: dict[str, float] = {
    "price_residual": 56.0,
    "information_completeness": 9.0,
    "vehicle_risk": 25.0,
    "seller_and_scam_risk": 10.0,
}

#: Below this share of total weight, a headline number is not worth printing:
#: it would be a confident-looking summary of one or two dimensions.
MIN_COVERAGE = 0.5

#: Dimensions without which no score is published, whatever the coverage.
#:
#: Price residual is not merely the heaviest component (56 of 100) -- it is the
#: question. Spec 5.1: "Lead with expected value." Renormalising around its
#: absence produced a real absurdity on captured data: capture 3 has two usable
#: comps and therefore no expected asking price, yet scored 91/100 on the
#: strength of completeness, time on market and a clean title. A deal score for
#: a listing whose price could not be assessed is not a deal score.
REQUIRED_COMPONENTS = ("price_residual",)


@dataclass(frozen=True)
class ScoreComponent:
    """One dimension's contribution, kept visible alongside the total."""

    name: str
    weight: float
    #: 0-100 on this dimension, or None when it could not be assessed.
    value: float | None
    #: Why it could not be assessed.
    unavailable_reason: str | None = None

    @property
    def available(self) -> bool:
        return self.value is not None

    @property
    def label(self) -> str:
        return self.name.replace("_", " ")


@dataclass(frozen=True)
class DealScore:
    """Spec 5.2's headline, and the breakdown that keeps it honest."""

    #: 0-100, or None when suppressed or too thinly covered.
    score: float | None
    components: tuple[ScoreComponent, ...] = ()
    #: Share of the intended weight that was actually assessable.
    coverage: float = 0.0
    suppressed_reason: str | None = None
    #: Always True until spec 9's calibration pass runs. Spec 9: "present output
    #: as a beta signal, not an authoritative rating."
    beta: bool = True

    @property
    def available(self) -> list[ScoreComponent]:
        return [c for c in self.components if c.available]

    @property
    def missing(self) -> list[ScoreComponent]:
        return [c for c in self.components if not c.available]

    def contribution(self, component: ScoreComponent) -> float | None:
        """This component's share of the final score, after renormalisation."""
        if component.value is None or self.coverage <= 0:
            return None
        total = sum(c.weight for c in self.available)
        return (component.weight / total) * component.value if total else None


def _vehicle_risk_score(
    title: TitleReading,
    risk: VehicleRiskAssessment,
) -> tuple[float | None, str | None]:
    """0-100 where higher is safer. UNCALIBRATED.

    Title branding dominates: it is a stated legal fact about the car, whereas
    recall and complaint counts describe the MODEL and say nothing about this
    particular vehicle's history (see `nhtsa/assessment.py`).
    """
    if title.risk is _TitleRisk.DISQUALIFYING:
        return 0.0, None
    if title.risk is TitleRisk.BRANDED:
        return 25.0, None

    if risk.recall_count is None and risk.complaint_count is None:
        if title.risk is TitleRisk.CLEAN:
            # A stated clean title is real information even with no NHTSA data.
            return 70.0, None
        return None, "no title status stated and no NHTSA data for this vehicle"

    score = 85.0 if title.risk is TitleRisk.CLEAN else 65.0

    # Recall campaigns are model-level, so they move the number modestly. A
    # heavily recalled model is worth knowing about; it is not a verdict on the
    # car in front of you.
    if risk.recall_count:
        score -= min(20.0, risk.recall_count * 2.0)
    return max(0.0, min(100.0, score)), None


def _scam_score(scam: ScamAssessment) -> tuple[float | None, str | None]:
    """0-100 where higher is cleaner, for signals BELOW the warning threshold."""
    if not scam.evaluable:
        return None, "none of the scam signals could be checked for this listing"
    # Each firing signal costs a fixed share. Above the threshold the score is
    # suppressed entirely rather than deducted from -- see the module docstring.
    return max(0.0, 100.0 - len(scam.fired) * 25.0), None


def compute_deal_score(
    *,
    rating: PricingRating | None,
    completeness: CompletenessReading,
    title: TitleReading,
    vehicle_risk: VehicleRiskAssessment,
    scam: ScamAssessment,
) -> DealScore:
    """Summarise the separated dimensions into spec 5.2's headline number.

    Negotiation strength (spec 6.4) is deliberately not an input -- see the
    note on `WEIGHTS`. It is reported alongside this score, not folded into it.
    """
    vehicle_value, vehicle_reason = _vehicle_risk_score(title, vehicle_risk)
    scam_value, scam_reason = _scam_score(scam)

    components = (
        ScoreComponent(
            "price_residual",
            WEIGHTS["price_residual"],
            rating.rating if rating else None,
            None if rating else "no expected asking price to compare against",
        ),
        ScoreComponent(
            "information_completeness",
            WEIGHTS["information_completeness"],
            completeness.score,
        ),
        ScoreComponent("vehicle_risk", WEIGHTS["vehicle_risk"], vehicle_value, vehicle_reason),
        ScoreComponent(
            "seller_and_scam_risk", WEIGHTS["seller_and_scam_risk"], scam_value, scam_reason
        ),
    )

    total_weight = sum(WEIGHTS.values())
    available = [c for c in components if c.available]
    covered = sum(c.weight for c in available)
    coverage = covered / total_weight if total_weight else 0.0

    # Spec 6.3: four signals together is "a strong signal and should produce a
    # distinct, prominent warning rather than a numerical deduction buried in a
    # composite". Printing "84/100" beside a fraud warning would be that burial.
    if scam.warn:
        return DealScore(
            score=None,
            components=components,
            coverage=coverage,
            suppressed_reason=(
                "Several scam patterns fired together on this listing. A single score "
                "would bury that; read the warning instead."
            ),
        )

    missing_required = [
        c for c in components if c.name in REQUIRED_COMPONENTS and not c.available
    ]
    if missing_required:
        names = ", ".join(c.label for c in missing_required)
        return DealScore(
            score=None,
            components=components,
            coverage=coverage,
            suppressed_reason=(
                f"No score without {names}. A deal score for a listing whose price "
                "could not be assessed would be measuring everything except the deal."
            ),
        )

    if coverage < MIN_COVERAGE:
        return DealScore(
            score=None,
            components=components,
            coverage=coverage,
            suppressed_reason=(
                "Too little about this listing could be assessed to fairly summarise "
                "it in one number."
            ),
        )

    score = sum(c.weight * (c.value or 0.0) for c in available) / covered
    return DealScore(
        score=max(0.0, min(100.0, score)),
        components=components,
        coverage=coverage,
    )


def ablate_component(score: DealScore, drop: str) -> float | None:
    """Spec 9.2: the composite as if `drop` were also unavailable.

    A counterfactual on the ALREADY-COMPUTED components -- it reuses the same
    renormalisation `compute_deal_score` applies to a component that genuinely
    could not be assessed, rather than re-running the pipeline with a dimension
    switched off. It does not reproduce `compute_deal_score`'s suppression rules
    (the scam warning, the required-component check, the coverage floor): those
    decide whether a number should ship to a user, which is a different question
    from how much one dimension moves it. Callers should only compare this
    against `score.score` when that was not None to begin with.

    None when dropping `drop` would leave nothing to average, or when nothing
    was available to drop from in the first place.
    """
    available = [c for c in score.components if c.available and c.name != drop]
    if not available:
        return None
    total_weight = sum(c.weight for c in available)
    return max(0.0, min(100.0, sum(c.weight * c.value for c in available) / total_weight))
