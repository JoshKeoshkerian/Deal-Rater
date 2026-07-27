"""Better alternatives nearby (spec 6.5, build step 7).

Spec 6.5 calls this "the highest-value addition to this spec, and nearly free.
The comp set is already loaded in memory at evaluation time." That is exactly
right: nothing here fetches anything. Every candidate is a comp that step 3
already filtered, fitted and kept, which is why spec 4.3 requires retaining the
full comp set in the evaluation response.

    "There are four comparable Camrys within 40 miles priced below expected
    value. [links]"

WHAT "BETTER" MEANS HERE
------------------------
Not "cheaper". A cheaper car with 60,000 more miles is not a better buy, it is
a different one, and recommending it on price alone would be the naive mistake
this whole model exists to avoid.

Better means a LOWER RESIDUAL AGAINST THE SAME FITTED LINE. The regression
already predicts what each vehicle should be advertised at given its mileage, so
comparing residuals compares like with like: a comp asking 18% under its own
expected price beats a target asking 4% under, whatever the two sticker prices
happen to be.

That reuses the fit rather than inventing a second notion of value, which keeps
the alternatives consistent with the headline number the user was just shown.

WHAT IS DELIBERATELY EXCLUDED
-----------------------------
Comps priced so far below the line that spec 2's adverse selection is the more
likely explanation. Sorting purely by residual would put those first, so the
single cheapest listing in the set -- disproportionately the worst car in it --
would become the product's top recommendation to a first-time buyer. That is the
exact failure spec 2 describes, arrived at from the opposite direction.
"""

from __future__ import annotations

from dataclasses import dataclass

from ..pricing.comps import CompCandidate, CompDecision
from ..pricing.regression import AskingPriceEstimate
from . import params


@dataclass(frozen=True)
class Alternative:
    """One comp worth looking at instead of the target."""

    candidate: CompCandidate
    #: The comp's own residual against the fitted line. Negative is cheaper
    #: than expected for its mileage.
    residual: float
    #: How much better its residual is than the target's, in percentage points.
    advantage: float
    #: Set when the comp is cheaper mainly because it has covered more ground.
    mileage_tradeoff: bool
    #: Cheaper in absolute dollars than the target. Often but not always true:
    #: a lower-mileage car can be better value at a higher price.
    cheaper_outright: bool

    @property
    def url(self) -> str | None:
        return self.candidate.listing_url

    def describe(self) -> str:
        """One line a buyer can act on.

        Leads with the concrete comparison, not the residual. An earlier version
        printed each comp's own residual and produced lines like "better priced
        ... (42% over expected)", which reads as a contradiction: it is better
        than a target that is 52% over, but nobody parses it that way. What
        matters to the reader is how this listing compares to the one they are
        looking at, so that is what is said.
        """
        c = self.candidate
        vehicle = " ".join(str(p) for p in (c.year, c.make, c.model) if p)
        price = f"${(c.price_cents or 0) / 100:,.0f}"
        miles = f"{c.mileage:,} mi" if c.mileage else "mileage unknown"
        line = f"{vehicle} - {price}, {miles}, {c.location_text or 'location unknown'}"
        line += f"  [better value by {self.advantage:.0%} of expected price]"
        if self.mileage_tradeoff:
            line += "  (higher mileage - a trade-off, not a straight win)"
        return line


@dataclass(frozen=True)
class AlternativesResult:
    alternatives: tuple[Alternative, ...]
    #: True when the target is the best-priced vehicle in its own comp set.
    #: Spec 6.5: "Suppress when the target is already the best available, and
    #: say so, since that is also useful."
    target_is_best: bool
    #: Why nothing is shown, when nothing is shown.
    suppressed_reason: str | None = None
    #: Comps that were better-priced but too cheap to responsibly recommend.
    withheld_as_implausible: int = 0

    @property
    def has_alternatives(self) -> bool:
        return bool(self.alternatives)

    def message(self) -> str:
        if self.alternatives:
            n = len(self.alternatives)
            return (
                f"{n} comparable listing{'s' if n != 1 else ''} in this search "
                f"{'are' if n != 1 else 'is'} better priced for what "
                f"{'they are' if n != 1 else 'it is'}."
            )
        if self.target_is_best:
            return "Nothing in this comp set is better priced. This is the best of them."
        return self.suppressed_reason or "No better-priced alternatives found."


def find_alternatives(
    target: CompCandidate,
    comps: list[CompDecision],
    estimate: AskingPriceEstimate,
    target_rating: float | None,
) -> AlternativesResult:
    """Find comps worth looking at instead of the target (spec 6.5).

    `target_rating` is the pricing rating from step 3's curve. It gates display
    per spec 6.5 -- alternatives are for when the target is average or worse --
    but never gates the underlying comparison, so `target_is_best` stays truthful
    even when nothing is displayed.
    """
    # Each vehicle is priced at ITS OWN mileage. Using the target's expected
    # price as the denominator for every comp was the first implementation, and
    # it silently reduced to ranking by sticker price -- a high-mileage car
    # scored well purely for being cheap, which is precisely the naive
    # comparison this module claims not to make.
    target_residual = estimate.residual_against_own_expectation(
        target.price_cents, target.mileage
    )

    if not estimate.has_estimate or target_residual is None:
        return AlternativesResult(
            alternatives=(),
            target_is_best=False,
            suppressed_reason=(
                "No expected asking price for this vehicle, so there is nothing to "
                "rank alternatives against."
            ),
        )

    # Score every included comp on the same line the target was scored against.
    scored: list[tuple[CompCandidate, float]] = []
    for decision in comps:
        candidate = decision.candidate
        residual = estimate.residual_against_own_expectation(
            candidate.price_cents, candidate.mileage
        )
        if residual is None:
            continue
        scored.append((candidate, residual))

    # A line dominated by one comp cannot rank the others. Suppressing here is
    # not caution for its own sake: naming a specific car to a first-time buyer
    # is a stronger claim than showing a range, and it deserves a firmer fit.
    sensitivity = estimate.outlier_sensitivity
    if sensitivity is not None and sensitivity > params.MAX_OUTLIER_SENSITIVITY_TO_RECOMMEND:
        return AlternativesResult(
            alternatives=(),
            target_is_best=False,
            suppressed_reason=(
                f"The comp set is too dominated by one or two listings ({sensitivity:.0%} "
                "outlier sensitivity) to rank alternatives honestly."
            ),
        )

    if not scored:
        return AlternativesResult(
            alternatives=(),
            target_is_best=False,
            suppressed_reason="No comparable listings carried enough detail to rank.",
        )

    better = [(c, r) for c, r in scored if target_residual - r >= params.MIN_RESIDUAL_ADVANTAGE]
    target_is_best = not better

    # Spec 2, applied in reverse: sorting by residual alone would promote the
    # single cheapest car in the set, which is disproportionately the worst one.
    plausible = [(c, r) for c, r in better if r > params.TOO_CHEAP_TO_RECOMMEND]
    withheld = len(better) - len(plausible)

    if target_rating is not None and target_rating > params.SHOW_WHEN_RATING_AT_OR_BELOW:
        # Spec 6.5 gates on the target being average or worse. The comparison
        # above still ran, so `target_is_best` remains meaningful.
        return AlternativesResult(
            alternatives=(),
            target_is_best=target_is_best,
            suppressed_reason=(
                "This listing is already well priced against its comps, so alternatives "
                "are not worth the distraction."
            ),
            withheld_as_implausible=withheld,
        )

    plausible.sort(key=lambda pair: pair[1])

    alternatives: list[Alternative] = []
    for candidate, residual in plausible[: params.MAX_ALTERNATIVES]:
        extra_miles = (
            (candidate.mileage or 0) - (target.mileage or 0)
            if candidate.mileage is not None and target.mileage is not None
            else 0
        )
        alternatives.append(
            Alternative(
                candidate=candidate,
                residual=residual,
                advantage=target_residual - residual,
                mileage_tradeoff=extra_miles >= params.MILEAGE_TRADEOFF_THRESHOLD,
                cheaper_outright=(candidate.price_cents or 0) < (target.price_cents or 0),
            )
        )

    return AlternativesResult(
        alternatives=tuple(alternatives),
        target_is_best=target_is_best,
        withheld_as_implausible=withheld,
    )
