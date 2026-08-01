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

MINIMUM OF THREE, 2026-08-01
-----------------------------
Product decision: `alternatives` should read as "here are the best options
nearby," not "here are the ones that happened to clear a threshold" -- and an
empty or one-item list looked identical to "we checked and there is nothing
to show," which was often false. This applied hardest to `target_is_best`:
the target being the best-priced vehicle in the set is real information, but
the previous behaviour paired it with an EMPTY alternatives list, which reads
as "nothing else exists" rather than "nothing else beats this, here is what
else is out there."

So when fewer than `MIN_ALTERNATIVES` same-trim comps clear
EQUALISH_TOLERANCE, the remaining slots are filled from the same-trim comps
that missed it, best (least-worse) residual first. Two things this does NOT
relax:

- `TOO_CHEAP_TO_RECOMMEND` stays a hard floor. The fill pool is drawn from
  comps that already cleared EQUALISH_TOLERANCE-or-worse on the EXPENSIVE
  side; a comp already routed to `withheld` for being implausibly cheap is
  never eligible, no matter how short the list is. Filling the list is not
  worth reopening the adverse-selection door spec 2 exists to keep shut.
- Nothing is fabricated. A same-trim pool with fewer than `MIN_ALTERNATIVES`
  comps in total is shown short. "Best possible" means best of what exists,
  not padded to a round number.

A filled-in comp is, by construction, not better priced than the target --
if it were, it would already be in `eligible`. `describe()` marks it
accordingly instead of letting it read as "comparable value," and `message()`
distinguishes "these are better priced" from "this is the best one, here are
some others for comparison" rather than reusing the old phrasing for both.
"""

from __future__ import annotations

from dataclasses import dataclass

from ..pricing.comps import CompCandidate, CompDecision, TrimMatch
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
        # near-tie, so it reads as a tie instead. Below -EQUALISH_TOLERANCE the
        # comp only appears at all because MIN_ALTERNATIVES needed filling
        # (2026-08-01) -- it is worse than the target, and saying so beats
        # letting it pass as "comparable."
        if self.advantage >= params.MIN_RESIDUAL_ADVANTAGE:
            line += f"  [better value by {self.advantage:.0%} of expected price]"
        elif self.advantage >= -params.EQUALISH_TOLERANCE:
            line += "  [comparable value for what it is]"
        else:
            line += (
                "  [priced higher than expected for what it is -- "
                "shown for comparison, not a better deal]"
            )
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
    #: equalish against the target's own residual, filled toward
    #: `params.MIN_ALTERNATIVES` with the least-worse remaining same-trim comps
    #: when fewer than that clear the tolerance band outright (2026-08-01, see
    #: "MINIMUM OF THREE" in the module docstring). Check each entry's own
    #: `advantage` rather than assuming everything here is a better deal.
    alternatives: tuple[Alternative, ...]
    #: True when the target is the best-priced vehicle in its own comp set,
    #: across ALL trims -- this is a market-wide fact and stays unrestricted
    #: even though `alternatives` itself is trim-scoped. Spec 6.5 originally
    #: had this suppress `alternatives` outright; as of 2026-08-01 it instead
    #: only changes `message()`'s wording, since `alternatives` now fills for
    #: comparison even when nothing beat the target.
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
            # A filled-in comp (2026-08-01, MIN_ALTERNATIVES) is worse than the
            # target's own residual by construction -- it only appears because
            # nothing better cleared EQUALISH_TOLERANCE. Counting it as
            # "better priced" would be the exact overclaim `describe()` avoids
            # per-comp; the summary line needs the same honesty.
            better_or_tied = sum(
                1 for a in self.alternatives if a.advantage >= -params.EQUALISH_TOLERANCE
            )
            filled = n - better_or_tied
            if self.target_is_best:
                # target_is_best means NOTHING anywhere beat this listing, so
                # every entry here is a tie or a fill -- never phrase this as
                # "these are better priced."
                base = (
                    f"This is the best-priced listing in this comp set. Shown for "
                    f"comparison: {n} other same-trim listing{'s' if n != 1 else ''} nearby."
                )
            elif filled:
                base = (
                    f"{better_or_tied} of {n} comparable listings here "
                    f"{'is' if better_or_tied == 1 else 'are'} better priced for what "
                    f"{'it is' if better_or_tied == 1 else 'they are'}; the rest are shown "
                    f"for comparison, not as better deals."
                )
            else:
                base = (
                    f"{n} comparable listing{'s' if n != 1 else ''} in this search "
                    f"{'are' if n != 1 else 'is'} better priced for what "
                    f"{'they are' if n != 1 else 'it is'}."
                )
            if not self.trim_known:
                base += " This listing's own trim wasn't stated, so these aren't trim-matched."
            return base
        if self.target_is_best:
            # `alternatives` is empty here only when the same-trim pool had
            # nothing at all to fill from (see MINIMUM OF THREE in the module
            # docstring) -- a thin pool is reported short, not padded.
            if self.different_trim:
                n = len(self.different_trim)
                return (
                    "This is the best-priced listing among same-trim comps, though "
                    f"{n} different-trim listing{'s' if n != 1 else ''} "
                    f"{'are' if n != 1 else 'is'} priced lower -- see Different trim below."
                )
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
) -> AlternativesResult:
    """Find comps worth looking at instead of the target (spec 6.5).

    NO "ALREADY WELL PRICED" GATE, 2026-07-30 (later same day)
    ------------------------------------------------------------
    A prior version hid `alternatives` outright whenever the target's own
    residual was at or better than the median of its comps, on the theory
    that a buyer looking at an already-good deal did not need the distraction.
    Reported bug against a captured 2010 370Z: `target_is_best` was FALSE --
    genuinely better-priced comps existed -- and the panel printed "This
    listing is priced better than at least half of its comparable listings,
    so alternatives are not worth the distraction" instead of naming them.
    That reads as "there might be something better, and this tool is
    choosing not to tell you," which is worse than either showing the
    comps or saying nothing. Spec 6.5's own suppression case was narrower --
    `target_is_best` (the target beats EVERY comp, not just half of them) --
    and as of 2026-08-01 (see "MINIMUM OF THREE" in the module docstring)
    even that no longer suppresses `alternatives` outright: it still decides
    the wording in `message()`, but the list itself fills toward
    MIN_ALTERNATIVES for comparison rather than going empty.
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

    # MINIMUM OF THREE, 2026-08-01 (see module docstring): a same-trim pool
    # that cleared EQUALISH_TOLERANCE for fewer than MIN_ALTERNATIVES comps --
    # including the target_is_best case, where it can clear zero -- used to
    # report a short or empty `alternatives`. Fill the remainder from the
    # same-trim comps that missed the tolerance band, best (least-worse)
    # residual first. `eligible` already contains every same-trim comp that
    # cleared the tolerance -- including the ones just split into `withheld`
    # for being too cheap -- so this pool can never contain a withheld comp;
    # the adverse-selection floor is untouched regardless of how short the
    # list runs.
    if len(plausible) < params.MIN_ALTERNATIVES:
        eligible_ids = {c.source_listing_id for c, _ in eligible}
        leftover = sorted(
            ((c, r) for c, r in same_trim if c.source_listing_id not in eligible_ids),
            key=lambda pair: pair[1],
        )
        needed = params.MIN_ALTERNATIVES - len(plausible)
        plausible = plausible + leftover[:needed]

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
