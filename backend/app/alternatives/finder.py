"""Alternatives nearby (spec 6.5, build step 7).

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

WHAT IS SHOWN SEPARATELY RATHER THAN RECOMMENDED
------------------------------------------------
Comps priced so far below the line that spec 2's adverse selection is the more
likely explanation. Sorting purely by residual would put those first, so the
single cheapest listing in the set -- disproportionately the worst car in it --
would become the product's top recommendation to a first-time buyer. That is the
exact failure spec 2 describes, arrived at from the opposite direction.

They are not deleted. They are returned in `withheld` with the reason attached to
each one, because an earlier version reported only a COUNT ("3 cheaper listings
withheld") and that is the worst of both: it tells a buyer something exists,
declines to say what, and invites them to assume the tool is hiding a bargain.
Either the listing is worth naming with its caveat, or it is not worth
mentioning. Naming it with the caveat is more useful -- "this one is 38% under
expected, which is a reason to ask why, not a saving" is exactly the education
spec 6.3 says a first-time buyer needs.

TRIM-RESTRICTED, 2026-07-30
----------------------------
`alternatives` is now restricted to comps `pricing/comps.py`'s `grade_trim`
calls the SAME trim as the target (`TrimMatch.EXACT` or `TRIM_ONLY` -- the
latter agrees on trim level and differs only in body style, which is not the
difference this list is about). A cheaper EX-L is not a reason to walk away
from an Si; it is a different car, and naming it as an "alternative" without
saying so is exactly the naive price-only comparison this module's own
docstring above rejects.

The residual gate also loosened from "meaningfully better" to "better or not
meaningfully worse" (`EQUALISH_TOLERANCE` in `params.py`): a same-trim comp
priced within a couple of points of the target's own residual is practically a
tie, and dropping it silently made "no alternatives" and "no BETTER
alternatives" look the same when they are not.

Comps whose trim genuinely `DIFFERS` are not discarded, because a materially
cheaper different-trim car is real information for a buyer weighing trims
against each other -- they go in `different_trim` instead, kept separate and
never merged into `alternatives`. Deliberately not labelled "lower trim":
`grade_trim` has no notion of ordinal trim rank (is a Sport "lower" than an
Si? there is no table answering that here), only same/different, so claiming
"lower" would assert an ordering this module cannot verify. `TrimMatch.UNKNOWN`
comps -- either side stated no trim at all -- are excluded from both lists;
spec 4.3 already treats an unstated trim as a confidence cost, not grounds for
any trim comparison.

UNKNOWN-TARGET-TRIM ESCAPE HATCH, 2026-07-30 (later same day)
---------------------------------------------------------------
`grade_trim` returns `UNKNOWN` whenever EITHER side has no stated trim level,
which includes the target. A target with no stated trim (common: spec 4.3
puts it at 21% of comps, and the target is scraped the same way) therefore
graded every single comp `UNKNOWN` -- not because none of them shared its
trim, but because there was nothing on our side to compare against. The
restriction above then emptied `alternatives` AND `different_trim`
unconditionally, regardless of how badly the target was priced: a 2013 FR-S
asking $16,000 against same-mileage comps asking $12,000 reported "No
better-priced alternatives found," which is the trim restriction failing
exactly the case it was not trying to guard against.

So: when the TARGET's own trim is unknown, the same/different distinction
cannot be computed either way, and `alternatives` falls back to every scored
comp regardless of grade -- the pre-restriction behaviour -- rather than
emptying. This reopens the EX-L-beside-an-Si risk the restriction exists to
prevent, but the alternative is worse: refusing to compare at all hides real
pricing signal from exactly the buyer who most needs it, on the exact
listings (trim unstated) spec 4.3 already flags as lower-confidence. The
message says so, so the comparison is not presented as more certain than it
is.
"""

from __future__ import annotations

import statistics
from dataclasses import dataclass

from ..pricing.comps import CompCandidate, CompDecision, TrimMatch
from ..pricing.confidence import Confidence
from ..pricing.regression import AskingPriceEstimate
from ..services.vehicle_facts import decompose
from . import params

#: `grade_trim` outcomes that count as "the same trim" for `alternatives`.
#: TRIM_ONLY agrees on trim level and differs only in body style -- a real
#: difference in the vehicle, but not the EX-vs-Si difference this list is
#: restricted against. See the module docstring's "TRIM-RESTRICTED" note.
_SAME_TRIM = (TrimMatch.EXACT, TrimMatch.TRIM_ONLY)


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
        # Below MIN_RESIDUAL_ADVANTAGE the comp only cleared the EQUALISH_TOLERANCE
        # band, not a meaningful advantage -- "better value by 1%" overstates a
        # near-tie, so it reads as a tie instead.
        if self.advantage >= params.MIN_RESIDUAL_ADVANTAGE:
            line += f"  [better value by {self.advantage:.0%} of expected price]"
        else:
            line += "  [comparable value for what it is]"
        if self.mileage_tradeoff:
            line += "  (higher mileage - a trade-off, not a straight win)"
        return line


@dataclass(frozen=True)
class WithheldAlternative:
    """A comp that is better-priced on paper and not recommended anyway.

    Carries its own reason so a renderer never has to announce a withhold it
    cannot explain. See the module docstring.
    """

    candidate: CompCandidate
    #: The comp's own residual against the fitted line. Deeply negative.
    residual: float

    @property
    def url(self) -> str | None:
        return self.candidate.listing_url

    @property
    def reason(self) -> str:
        return (
            f"Advertised {abs(self.residual):.0%} below what comparable listings suggest, "
            "with nothing explaining why. A discount this deep is more often a problem "
            "with the car than a saving."
        )

    def describe(self) -> str:
        c = self.candidate
        vehicle = " ".join(str(p) for p in (c.year, c.make, c.model) if p)
        price = f"${(c.price_cents or 0) / 100:,.0f}"
        miles = f"{c.mileage:,} mi" if c.mileage else "mileage unknown"
        return f"{vehicle} - {price}, {miles}, {c.location_text or 'location unknown'}"


@dataclass(frozen=True)
class AlternativesResult:
    #: Same-trim comps only (`TrimMatch.EXACT` or `TRIM_ONLY`), better or
    #: equalish against the target's own residual. See "TRIM-RESTRICTED" in the
    #: module docstring.
    alternatives: tuple[Alternative, ...]
    #: True when the target is the best-priced vehicle in its own comp set,
    #: across ALL trims -- this is a market-wide fact and stays unrestricted
    #: even though `alternatives` itself is trim-scoped. Spec 6.5: "Suppress
    #: when the target is already the best available, and say so, since that
    #: is also useful."
    target_is_best: bool
    #: Why nothing is shown, when nothing is shown.
    suppressed_reason: str | None = None
    #: Comps that were better-priced but too cheap to responsibly recommend,
    #: each with the reason attached. Shown, not counted -- see the module
    #: docstring. Same-trim scoped, like `alternatives`.
    withheld: tuple[WithheldAlternative, ...] = ()
    #: Better-priced comps whose trim genuinely differs from the target's.
    #: Never merged into `alternatives` -- see "TRIM-RESTRICTED" above for why
    #: this is not called "lower trim".
    different_trim: tuple[Alternative, ...] = ()
    #: False when the TARGET itself stated no trim, in which case `alternatives`
    #: falls back to every scored comp regardless of grade -- see the module
    #: docstring's "UNKNOWN-TARGET-TRIM ESCAPE HATCH". `message()` caveats the
    #: count when this is False so the comparison is not read as trim-matched
    #: when it could not be.
    trim_known: bool = True

    @property
    def has_alternatives(self) -> bool:
        return bool(self.alternatives)

    @property
    def has_different_trim(self) -> bool:
        return bool(self.different_trim)

    @property
    def withheld_as_implausible(self) -> int:
        return len(self.withheld)

    def message(self) -> str:
        if self.alternatives:
            n = len(self.alternatives)
            base = (
                f"{n} comparable listing{'s' if n != 1 else ''} in this search "
                f"{'are' if n != 1 else 'is'} better priced for what "
                f"{'they are' if n != 1 else 'it is'}."
            )
            if not self.trim_known:
                base += " This listing's own trim wasn't stated, so these aren't trim-matched."
            return base
        if self.target_is_best:
            return "Nothing in this comp set is better priced. This is the best of them."
        if self.suppressed_reason:
            return self.suppressed_reason
        # `alternatives` is same-trim only, so it can be empty while a real
        # finding sits in `different_trim` -- without this branch that read as
        # "no better-priced alternatives found" alongside cheaper cars in the
        # very next dropdown, which is the section contradicting itself.
        if self.different_trim:
            n = len(self.different_trim)
            return (
                f"No same-trim alternatives, but {n} different-trim listing{'s' if n != 1 else ''} "
                f"{'are' if n != 1 else 'is'} better priced -- see Different trim below."
            )
        return "No better-priced alternatives found."


def find_alternatives(
    target: CompCandidate,
    comps: list[CompDecision],
    estimate: AskingPriceEstimate,
    confidence: Confidence | None = None,
) -> AlternativesResult:
    """Find comps worth looking at instead of the target (spec 6.5).

    `confidence` gates display alongside the target's standing in its own comp
    set -- see `_should_suppress`. Neither gates the underlying comparison, so
    `target_is_best` stays truthful even when nothing is displayed.
    """
    # Each vehicle is priced at ITS OWN mileage (and year, when the published
    # fit uses one). Using the target's expected price as the denominator for
    # every comp was the first implementation, and it silently reduced to
    # ranking by sticker price -- a high-mileage car scored well purely for
    # being cheap, which is precisely the naive comparison this module claims
    # not to make.
    target_residual = estimate.residual_against_own_expectation(
        target.price_cents, target.mileage, target.year
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

    # Score every included comp on the same line the target was scored against,
    # keeping its graded trim relationship alongside -- `CompDecision.trim_match`
    # is already computed by `pricing/comps.py` against this same target, so
    # there is nothing to recompute here.
    scored: list[tuple[CompCandidate, float, TrimMatch]] = []
    for decision in comps:
        candidate = decision.candidate
        residual = estimate.residual_against_own_expectation(
            candidate.price_cents, candidate.mileage, candidate.year
        )
        if residual is None:
            continue
        scored.append((candidate, residual, decision.trim_match))

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

    # `target_is_best` is a market-wide fact (spec 6.5), so it is decided over
    # every graded comp regardless of trim -- see the module docstring.
    better = [(c, r) for c, r, _ in scored if target_residual - r >= params.MIN_RESIDUAL_ADVANTAGE]
    target_is_best = not better

    # See "UNKNOWN-TARGET-TRIM ESCAPE HATCH" above: when the TARGET itself has
    # no stated trim, `grade_trim` graded every comp UNKNOWN, not because none
    # of them match -- there is nothing on our side to compare. Restricting to
    # `_SAME_TRIM` in that case empties `alternatives` regardless of price, so
    # it falls back to every scored comp instead.
    target_trim_known = decompose(target.trim_text).trim_level is not None
    same_trim = (
        [(c, r) for c, r, _ in scored]
        if not target_trim_known
        else [(c, r) for c, r, g in scored if g in _SAME_TRIM]
    )
    different_trim_scored = [(c, r) for c, r, g in scored if g is TrimMatch.DIFFERS]

    # `alternatives` (spec 6.5, trim-restricted): better than the target OR
    # close enough to be a practical tie -- see EQUALISH_TOLERANCE in params.py
    # and the "TRIM-RESTRICTED" note above. Genuinely worse same-trim comps
    # never reach this list.
    eligible = [(c, r) for c, r in same_trim if target_residual - r >= -params.EQUALISH_TOLERANCE]

    # Spec 2, applied in reverse: sorting by residual alone would promote the
    # single cheapest car in the set, which is disproportionately the worst one.
    plausible = [(c, r) for c, r in eligible if r > params.TOO_CHEAP_TO_RECOMMEND]
    withheld = tuple(
        WithheldAlternative(candidate=c, residual=r)
        for c, r in sorted(
            (pair for pair in eligible if pair[1] <= params.TOO_CHEAP_TO_RECOMMEND),
            key=lambda pair: pair[1],
        )
    )

    # Different-trim comps keep the stricter "meaningfully better" bar rather
    # than the equalish one -- a different trim priced about the same as the
    # target is not information worth a dropdown of its own, since it is not
    # cheaper for what it is AND it is not the same car.
    different_trim_better = [
        (c, r)
        for c, r in different_trim_scored
        if target_residual - r >= params.MIN_RESIDUAL_ADVANTAGE
        and r > params.TOO_CHEAP_TO_RECOMMEND
    ]

    suppressed = _should_suppress(target_residual, [r for _, r, _ in scored], confidence)
    if suppressed is not None:
        return AlternativesResult(
            alternatives=(),
            target_is_best=target_is_best,
            suppressed_reason=suppressed,
            withheld=withheld,
            trim_known=target_trim_known,
        )

    plausible.sort(key=lambda pair: pair[1])
    different_trim_better.sort(key=lambda pair: pair[1])

    def _build(candidate: CompCandidate, residual: float) -> Alternative:
        extra_miles = (
            (candidate.mileage or 0) - (target.mileage or 0)
            if candidate.mileage is not None and target.mileage is not None
            else 0
        )
        return Alternative(
            candidate=candidate,
            residual=residual,
            advantage=target_residual - residual,
            mileage_tradeoff=extra_miles >= params.MILEAGE_TRADEOFF_THRESHOLD,
            cheaper_outright=(candidate.price_cents or 0) < (target.price_cents or 0),
        )

    alternatives = tuple(_build(c, r) for c, r in plausible[: params.MAX_ALTERNATIVES])
    different_trim = tuple(
        _build(c, r) for c, r in different_trim_better[: params.MAX_DIFFERENT_TRIM_ALTERNATIVES]
    )

    return AlternativesResult(
        alternatives=alternatives,
        target_is_best=target_is_best,
        withheld=withheld,
        different_trim=different_trim,
        trim_known=target_trim_known,
    )


def _should_suppress(
    target_residual: float,
    comp_residuals: list[float],
    confidence: Confidence | None,
) -> str | None:
    """Whether to hide alternatives, and what to say instead. None to show them.

    WHY THIS IS NOT THE PRICING RATING ANY MORE
    -------------------------------------------
    The previous rule was `target_rating > 60`, and it contradicted the pricing
    dimension it was supposed to agree with. A captured listing asking at the
    87th percentile of its own expected range -- price residual its WORST
    sub-score -- still cleared 60 on the curve and so printed "already well
    priced against its comps" directly beneath a panel saying the opposite. One
    absolute threshold on a curve that plateaus cannot express "better than its
    comps"; that is a comparison, so it is now made by comparison.

    Three conditions, all required to suppress:

    1. THE TARGET IS AT OR BETTER THAN THE MEDIAN COMP. Lower residual is better
       (advertised further below what its own mileage predicts), so "at or above
       the median in price standing" is `residual <= median`. Half the comp set
       being worse-priced is what "already well priced against its comps" has to
       mean if it is to be said at all.

    2. CONFIDENCE IS NOT LOW. Suppressing on a fit the panel is simultaneously
       disowning asserts a ranking the same evaluation says it cannot make. When
       confidence is low the alternatives are shown, caveats and all, and the
       buyer decides.

    3. THE TARGET IS NOT ITSELF AN IMPLAUSIBLE DISCOUNT. Condition 1 is true by
       construction for a car advertised 40% under the line, and calling that
       "well priced" would be spec 2's adverse selection restated as praise.
    """
    if confidence is Confidence.LOW or confidence is Confidence.NONE:
        return None
    if not comp_residuals:
        return None
    if target_residual <= params.TOO_CHEAP_TO_RECOMMEND:
        return None
    if target_residual > statistics.median(comp_residuals):
        return None
    return (
        "This listing is priced better than at least half of its comparable "
        "listings, so alternatives are not worth the distraction."
    )
