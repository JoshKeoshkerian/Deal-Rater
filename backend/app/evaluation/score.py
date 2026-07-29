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

3. THE SELLER'S STAR RATING CAPS SELLER_AND_SCAM_RISK DIRECTLY, RATHER THAN
   JOINING THE SCAM-SIGNAL COMBINATION.

   A real case that motivated this: a listing with zero scam signals fired --
   clean description, plenty of photos, no red flags -- scored 100/100 on this
   dimension, on a seller whose OTHER reviews describe him lying about vehicle
   condition. None of spec 6.3's five evaluable signals are equipped to catch
   that; they read the LISTING, not the seller's track record. A documented
   pattern like that is real evidence the signal combination can miss entirely,
   so `_seller_rating_ceiling` acts on the score directly: the lower of the
   signal-based score and the rating-based ceiling wins. It deliberately does
   NOT feed `ScamAssessment`'s four-signals-fire-a-warning logic (that stays
   spec 6.3's combination of listing-text signals only) -- a bad rating alone
   caps this one dimension; it does not, on its own, trigger the "several scam
   patterns fired together" suppression of the whole composite.
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
#: `vehicle_risk` previously raised from 12 to 20 (pre-rescale), taken from
#: `information_completeness` (15 -> 7) rather than from `price_residual` (the
#: required dimension, see `REQUIRED_COMPONENTS`) or `seller_and_scam_risk`
#: (which already has its own suppression path for real severity via
#: `scam.warn`, so its weight carries less of the load). Completeness was the
#: thinnest signal of the four, and stayed thinnest through the rescales below.
#:
#: Reweighted 2026-07-29 (product decision): price_residual 56 -> 50,
#: information_completeness 9 -> 10, vehicle_risk unchanged at 25,
#: seller_and_scam_risk 10 -> 15. `information_completeness` also dropped its
#: photo-count check around the same time (`flags/completeness.py`) since
#: every listing has photos, so it was inflating every score for free rather
#: than distinguishing anything.
WEIGHTS: dict[str, float] = {
    "price_residual": 50.0,
    "information_completeness": 10.0,
    "vehicle_risk": 25.0,
    "seller_and_scam_risk": 15.0,
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

#: `_vehicle_risk_score`'s baselines and penalty, 0-100 where higher is safer.
#: UNCALIBRATED, same status as `WEIGHTS` above -- named here rather than left
#: as inline literals so a future calibration pass (spec 9) finds them the
#: same way it finds every other scoring constant in this codebase, instead
#: of only the ones that happen to live in a `params.py` (docs/scoring-audit.md
#: finding #7).
VEHICLE_RISK_BRANDED_TITLE = 25.0
#: Clean title stated, but no NHTSA recall/complaint data exists for this
#: year/make/model at all.
VEHICLE_RISK_CLEAN_TITLE_NO_NHTSA_DATA = 70.0
#: NHTSA data exists; baseline before the recall penalty, by title.
VEHICLE_RISK_CLEAN_TITLE_BASELINE = 85.0
VEHICLE_RISK_NON_CLEAN_TITLE_BASELINE = 65.0
#: Recall campaigns are model-level, not vehicle-specific (see
#: `nhtsa/assessment.py`), so they move the number modestly rather than
#: dominating it: capped total penalty, and a fixed cost per campaign.
VEHICLE_RISK_RECALL_PENALTY_CAP = 20.0
VEHICLE_RISK_RECALL_PENALTY_PER_CAMPAIGN = 2.0

#: `_scam_score`'s flat cost per fired signal, on the 0-100 scale BELOW the
#: warning threshold (`scam.warn` suppresses the composite entirely once
#: `SCAM_SIGNALS_FOR_WARNING` signals fire -- see the module docstring).
#: UNCALIBRATED.
SCAM_SUBTHRESHOLD_PENALTY_PER_SIGNAL = 25.0

#: Minimum reviews before a seller's star rating is trusted enough to cap
#: `seller_and_scam_risk` at all. Below this, one or two outlier reviews could
#: swing a rating that is not yet a reliable signal -- see
#: `_seller_rating_ceiling`. UNCALIBRATED.
SELLER_RATING_MIN_REVIEWS = 3


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
        return VEHICLE_RISK_BRANDED_TITLE, None

    if risk.recall_count is None and risk.complaint_count is None:
        if title.risk is TitleRisk.CLEAN:
            # A stated clean title is real information even with no NHTSA data.
            return VEHICLE_RISK_CLEAN_TITLE_NO_NHTSA_DATA, None
        return None, "no title status stated and no NHTSA data for this vehicle"

    score = (
        VEHICLE_RISK_CLEAN_TITLE_BASELINE
        if title.risk is TitleRisk.CLEAN
        else VEHICLE_RISK_NON_CLEAN_TITLE_BASELINE
    )

    # Recall campaigns are model-level, so they move the number modestly. A
    # heavily recalled model is worth knowing about; it is not a verdict on the
    # car in front of you.
    if risk.recall_count:
        penalty = risk.recall_count * VEHICLE_RISK_RECALL_PENALTY_PER_CAMPAIGN
        score -= min(VEHICLE_RISK_RECALL_PENALTY_CAP, penalty)
    return max(0.0, min(100.0, score)), None


def _seller_rating_ceiling(
    rating_average: float | None, rating_count: int | None
) -> float | None:
    """Cap on `seller_and_scam_risk` from the seller's own star rating.

    A DIRECT MODIFIER, not another entry in `ScamAssessment`'s signal
    combination -- see the module docstring's third departure. None when
    there is no rating yet, or too few reviews to trust it.

    UNCALIBRATED linear mapping: the ceiling is simply the rating expressed
    out of 100 (2.4/5 stars -> a ceiling of 48). No data justifies a steeper
    curve yet; a future calibration pass (spec 9) may find one is warranted,
    the way the pricing curve's rise-plateau-decline shape was.
    """
    if (
        rating_average is None
        or rating_count is None
        or rating_count < SELLER_RATING_MIN_REVIEWS
    ):
        return None
    return max(0.0, min(100.0, (rating_average / 5.0) * 100.0))


def _scam_score(
    scam: ScamAssessment,
    rating_average: float | None = None,
    rating_count: int | None = None,
) -> tuple[float | None, str | None]:
    """0-100 where higher is cleaner, for signals BELOW the warning threshold.

    Two independent sources feed this, and either is sufficient alone: the
    scam-signal combination (`scam.fired`, capped by `scam.warn` suppressing
    the whole composite above the threshold -- unaffected by anything here),
    and the seller's star rating, applied as a ceiling via
    `_seller_rating_ceiling`. When both are available the lower one wins,
    since neither source is allowed to paper over a problem the other found.
    """
    signal_score: float | None = None
    if scam.evaluable:
        # Each firing signal costs a fixed share. Above the threshold the
        # score is suppressed entirely rather than deducted from -- see the
        # module docstring.
        signal_score = max(0.0, 100.0 - len(scam.fired) * SCAM_SUBTHRESHOLD_PENALTY_PER_SIGNAL)

    ceiling = _seller_rating_ceiling(rating_average, rating_count)

    if signal_score is None and ceiling is None:
        return None, (
            "none of the scam signals could be checked, and no seller rating with "
            "enough reviews was found, for this listing"
        )
    if ceiling is None:
        return signal_score, None
    if signal_score is None:
        return ceiling, None
    return min(signal_score, ceiling), None


def compute_deal_score(
    *,
    rating: PricingRating | None,
    completeness: CompletenessReading,
    title: TitleReading,
    vehicle_risk: VehicleRiskAssessment,
    scam: ScamAssessment,
    seller_rating_average: float | None = None,
    seller_rating_count: int | None = None,
) -> DealScore:
    """Summarise the separated dimensions into spec 5.2's headline number.

    Negotiation strength (spec 6.4) is deliberately not an input -- see the
    note on `WEIGHTS`. It is reported alongside this score, not folded into it.

    `seller_rating_average`/`seller_rating_count` cap `seller_and_scam_risk`
    directly rather than joining `scam`'s signal combination -- see the module
    docstring's third departure and `_seller_rating_ceiling`.
    """
    vehicle_value, vehicle_reason = _vehicle_risk_score(title, vehicle_risk)
    scam_value, scam_reason = _scam_score(scam, seller_rating_average, seller_rating_count)

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
