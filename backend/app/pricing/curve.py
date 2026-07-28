"""Rise-plateau-decline mapping from price residual to a PRICING rating.

Spec 2 is the whole of this module:

    "In private-party used cars the cheapest listings are disproportionately the
    worst cars... This is textbook adverse selection. The relationship between
    discount and quality is not linear. Roughly 10 to 15 percent under
    comparable listings is likely a genuine deal. Forty-five percent under is
    more likely to signal a problem. The pricing curve should rise, plateau,
    then fall as the discount becomes implausible, and an unexplained extreme
    discount should reduce confidence rather than inflate the score."

Two things follow, and both are structural rather than stylistic:

1. THERE IS NO LINEAR "CHEAPER IS BETTER" TERM ANYWHERE HERE. The curve turns
   over. A 60%-under listing scores below a 15%-under listing.

2. THE CONFIDENCE PENALTY FOR AN EXTREME DISCOUNT DOES NOT LIVE IN THIS FILE.
   It lives in `confidence.py`, because spec 2 says an implausible discount
   should reduce CONFIDENCE, and folding that into the rating would collapse two
   readings the spec requires be kept apart.

CALIBRATION STATUS: NONE.

Spec 15 lists "where the discount curve plateaus and declines" as an open
question. Spec 9.4 assigns it to the calibration pass against the ground truth
set. That set does not exist in this repo, so every breakpoint below is a
placeholder taken from the illustrative numbers in spec 2's prose. The shape is
what the spec specifies; the coordinates are a guess. `is_calibrated` returns
False and the CLI prints that alongside every rating.
"""

from __future__ import annotations

from dataclasses import dataclass

from . import params


def is_calibrated() -> bool:
    """Whether the breakpoints have been fitted to a ground truth set.

    Hardcoded False, and it should stay False until spec 9's calibration pass
    has actually run and the numbers in `params` have been replaced with fitted
    ones. Flipping this by hand would make the output claim an authority it does
    not have -- the specific failure spec 9 exists to prevent.
    """
    return False


@dataclass(frozen=True)
class PricingRating:
    """The pricing dimension only (spec 6.1).

    NOT a composite deal score. Spec 5.2's 0-100 headline is a weighted summary
    across four separated dimensions and belongs to build step 8; three of those
    dimensions do not exist yet. This is one input to that, in isolation.
    """

    #: 0-100 on the pricing dimension alone.
    rating: float
    #: Signed residual against the expected ASKING price. Negative is cheaper.
    #: The RAW gap, unadjusted -- what the listing actually asks relative to
    #: expected, which is the fact a user is shown.
    residual_fraction: float
    #: Which segment of the curve produced the rating.
    band: str
    #: Plain-language reading, for the CLI and later the overlay.
    label: str
    #: True once the residual is deep enough that adverse selection is the more
    #: likely explanation. Read by `confidence.py`; deliberately not applied to
    #: `rating` here.
    implausible_discount: bool
    calibrated: bool = False
    #: The residual actually scored, after subtracting what the comp set cannot
    #: resolve. Equal to `residual_fraction` when the interval is tight or no
    #: margin was supplied. See `resolvable_residual`.
    scored_residual_fraction: float = 0.0
    #: How much of the gap was written off as indistinguishable from noise --
    #: uncertainty in the expected asking price, as a fraction of it.
    uncertainty_margin: float = 0.0
    #: True when the margin is the REASON this reads as fair: the raw gap was
    #: large enough to have earned a verdict, and was absorbed.
    #:
    #: Deliberately not "scored residual is zero". A listing asking exactly the
    #: expected price against a tight comp set also scores zero, and that is a
    #: finding ("priced about right") rather than an admission of ignorance.
    #: Conflating the two would put "comparable listings disagree too much to
    #: say" on the most confidently-priced listings in the set.
    within_noise: bool = False


def resolvable_residual(residual: float, uncertainty_margin: float) -> float:
    """The part of a price gap the comp set can actually tell apart from noise.

    THE PROBLEM THIS SOLVES. The curve below reads a point residual and returns
    a confident verdict, with no reference to how uncertain that residual is.
    On captured data 51 of 111 evaluations -- 46% -- rendered a verdict their
    own prediction interval could not support. The clearest case: a Tucson
    asking $8,000 against an interval of $3,521 to $8,597 was rated 5/100,
    "asking above comparable listings", when its ask sits INSIDE the range the
    model itself says comparable listings occupy. The model cannot
    simultaneously claim it cannot pin the price down within $5,000 and that
    this particular price is definitively too high.

    THE RULE. Soft-thresholding: subtract the margin from the magnitude of the
    residual and keep the sign, flooring at zero.

        residual +32%, margin 42%  ->   0%   (indistinguishable from expected)
        residual +32%, margin  5%  -> +27%   (a real gap, slightly discounted)
        residual -60%, margin 20%  -> -40%   (still deeply, meaningfully under)

    Only the part of the gap that exceeds the noise floor is scored, so a tight
    comp set keeps essentially all of its signal while a noisy one has to earn
    a verdict by a wider margin. It degrades continuously rather than at a
    cliff: there is no threshold where one dollar of ask flips a listing from
    "fair" to "overpriced".

    WHICH MARGIN, AND WHY NOT THE PUBLISHED INTERVAL. The caller passes
    uncertainty in the EXPECTED asking price (the confidence interval on the
    fitted mean), NOT the published prediction interval. They differ by 3.4x on
    captured data -- 8.8% against 29.8% at the median -- and using the wider one
    was tried first and is wrong. The prediction interval is wide partly because
    sellers of identical cars genuinely price them differently, and that spread
    is the very thing a deal rating exists to locate a listing within. Writing
    it off as noise rated 86% of captured listings "fair" and turned the product
    into a machine for having no opinion. The right question is not "would
    another listing plausibly ask this?" but "do we know the centre of this
    market well enough to say this ask is above or below it?"

    WHAT THIS IS NOT. Not a confidence adjustment -- confidence remains a
    separate output (`confidence.py`) and is not folded into the price or the
    rating. This changes what the RESIDUAL means, not what the curve does with
    it: the breakpoints below still read in market terms ("15% under"), and a
    residual that survives the margin is still a residual.

    Spec 9.5 is the principle, applied to the verdict rather than the interval:
    "an interval that is systematically too narrow is worse than no interval,
    because it manufactures false confidence." A verdict the interval cannot
    support manufactures the same false confidence, in the number users
    actually read.

    THE FLOOR HAS ITS OWN SIDE EFFECT: A SINGLE POINT, NOT A NARROW RANGE.
    Flooring to exactly zero is correct in what it forbids (a confident
    verdict past the noise floor) but ALSO merges every residual smaller than
    its own margin into one identical output. On captured data this made 59
    of 170 rated listings -- 35% -- share the exact same pricing sub-score,
    regardless of whether the raw ask was 1.7% over expected or 10% under it.
    That is not a discontinuity (the function is continuous); it is a flat
    region, and a flat region is a real loss of resolution for over a third
    of the listings this model ever prices.

    THE FIX, AND WHY IT IS NARROWER THAN IT LOOKS. Only the exactly-zero case
    is touched -- once `magnitude` is positive the function is untouched,
    because that path already carries real, distinguishable information and
    was never part of the problem. When `magnitude` is exactly zero (the raw
    gap did not exceed the margin), a small sign-preserving perturbation is
    added instead of returning literal zero:

        ratio = |residual| / margin                      # in (0, 1)
        bump  = NOISE_FLOOR_TIEBREAKER_SCALE * 4 * ratio * (1 - ratio)

    `4*ratio*(1-ratio)` is zero at both ends of (0, 1) and peaks at 1 when
    ratio=0.5 -- chosen so the perturbation vanishes continuously right at the
    boundary where the "real signal" branch above also goes to zero (no cliff
    at the transition), while still giving two different raw residuals with
    the same margin two different, ordered-ish outputs instead of an identical
    one. `NOISE_FLOOR_TIEBREAKER_SCALE` is chosen small enough
    (`params.py`) that the bump can never push a rating out of the "fair"
    band on its own, whatever the ratio -- see `rate_price_residual`'s
    `absorbed` computation, which still reads the ORIGINAL magnitude-is-zero
    condition directly rather than this perturbed value, so "was this
    genuinely erased by the noise floor" is unaffected by the tie-breaker.

    THE HONEST LIMIT OF THIS FIX. A function that is exactly zero at both
    ratio=0 and ratio=1 and continuous between them cannot also be strictly
    monotonic there (monotonic + equal boundary values forces it to be
    constant) -- so this bump is a bounded hump, not a monotonic ramp, and two
    raw residuals placed symmetrically around ratio=0.5 for the same margin
    can still tie. That trade was made deliberately: the alternative (a
    monotonic ramp) would have to give up either continuity at the boundary
    or the "cannot render a confident verdict past the noise floor" property
    the whole function exists for, and this audit's measured problem was mass
    collision across the WHOLE erased zone, not rare, near-symmetric pairs
    within it.
    """
    if uncertainty_margin <= 0:
        return residual
    magnitude = max(0.0, abs(residual) - uncertainty_margin)
    if magnitude > 0.0 or residual == 0.0:
        return magnitude if residual >= 0 else -magnitude
    ratio = abs(residual) / uncertainty_margin
    bump = params.NOISE_FLOOR_TIEBREAKER_SCALE * 4.0 * ratio * (1.0 - ratio)
    return bump if residual > 0 else -bump


def _lerp(x: float, x0: float, x1: float, y0: float, y1: float) -> float:
    """Linear interpolation between two breakpoints, clamped to the segment."""
    if x1 == x0:
        return y0
    t = (x - x0) / (x1 - x0)
    t = max(0.0, min(1.0, t))
    return y0 + t * (y1 - y0)


def rate_price_residual(residual: float, uncertainty_margin: float = 0.0) -> PricingRating:
    """Map a signed price residual onto the rise-plateau-decline curve.

    The curve, left (deep discount) to right (overpriced):

        IMPLAUSIBLE_DISCOUNT ......... decline floor, adverse selection
              |  rises as the discount becomes less extreme
        PLATEAU_END .................. top of the plateau
              |  flat: a genuine deal, and more discount does not mean better
        PLATEAU_START ................ top of the plateau
              |  falls toward a fair price
        OVERPRICED_KNEE .............. fairly priced
              |  falls as the ask exceeds comps
        OVERPRICED_FLOOR ............. floor

    `uncertainty_margin` is how precisely the EXPECTED asking price is known,
    as a fraction of it (`AskingPriceEstimate.expected_uncertainty_fraction`) --
    not the published prediction interval. The curve is applied to the part of
    the residual that survives it, so a comp set that cannot locate the market's
    centre does not get to render a confident verdict about one price within it.
    See `resolvable_residual` for why this margin and not the wider one.

    The default of zero rates the raw residual, which is what a caller with no
    uncertainty figure (a unit test, or an estimator that produced none) should
    get.
    """
    p = params
    raw = residual
    residual = resolvable_residual(residual, uncertainty_margin)

    # Whether the margin is what made this fair, as opposed to the price
    # genuinely sitting at the middle of a well-established market. Only true
    # when the raw gap was big enough to have earned a non-fair verdict on its
    # own. See `PricingRating.within_noise`.
    #
    # Computed from `raw` and `uncertainty_margin` directly -- NOT from
    # `residual == 0.0` -- because `resolvable_residual` no longer returns a
    # literal zero for every fully-erased gap (see its docstring): a small
    # tie-breaking bump now stands in for zero so two different raw residuals
    # do not collapse to an identical rating. "Was this fully erased by the
    # noise floor" is still exactly the original condition, independent of
    # whatever nonzero bump the tie-breaker produced from it.
    fully_absorbed = uncertainty_margin > 0 and abs(raw) <= uncertainty_margin
    absorbed = fully_absorbed and not (p.PLATEAU_START <= raw <= p.OVERPRICED_KNEE)

    if residual <= p.IMPLAUSIBLE_DISCOUNT:
        # Past the far end the rating does not keep falling. Something is wrong
        # with the listing, and how wrong is a risk question this dimension is
        # not equipped to answer.
        return PricingRating(
            rating=p.IMPLAUSIBLE_DISCOUNT_RATING,
            residual_fraction=raw,
            scored_residual_fraction=residual,
            uncertainty_margin=uncertainty_margin,
            band="implausible_discount",
            label=(
                "Priced far below comparable asks, with no explanation in the listing. "
                "An unexplained discount this deep more often signals a problem than a bargain."
            ),
            implausible_discount=True,
            calibrated=is_calibrated(),
        )

    if residual < p.PLATEAU_END:
        # THE DECLINE. This is the segment that makes the curve non-monotonic:
        # a bigger discount scores LOWER here, not higher.
        return PricingRating(
            rating=_lerp(
                residual,
                p.IMPLAUSIBLE_DISCOUNT,
                p.PLATEAU_END,
                p.IMPLAUSIBLE_DISCOUNT_RATING,
                p.PLATEAU_RATING,
            ),
            residual_fraction=raw,
            scored_residual_fraction=residual,
            uncertainty_margin=uncertainty_margin,
            band="declining",
            label=(
                "Well below comparable asks. Attractive, but deep enough that the reason "
                "for the discount is worth establishing before anything else."
            ),
            implausible_discount=residual <= p.ADVERSE_SELECTION_RESIDUAL,
            calibrated=is_calibrated(),
        )

    if residual <= p.PLATEAU_START:
        # THE PLATEAU. Flat on purpose: within this band, more discount is not
        # more deal, and pretending otherwise is the linear model spec 2 rejects.
        return PricingRating(
            rating=p.PLATEAU_RATING,
            residual_fraction=raw,
            scored_residual_fraction=residual,
            uncertainty_margin=uncertainty_margin,
            band="plateau",
            label="Below comparable asks by a margin that typically reflects a genuine deal.",
            implausible_discount=False,
            calibrated=is_calibrated(),
        )

    if residual <= p.OVERPRICED_KNEE:
        return PricingRating(
            rating=_lerp(
                residual,
                p.PLATEAU_START,
                p.OVERPRICED_KNEE,
                p.PLATEAU_RATING,
                p.FAIR_PRICE_RATING,
            ),
            residual_fraction=raw,
            scored_residual_fraction=residual,
            uncertainty_margin=uncertainty_margin,
            band="fair",
            # A residual absorbed by the margin is a different statement from
            # one that genuinely landed near zero, and saying "asking about
            # what comparable listings ask" would overstate what the comp set
            # established. The distinction is the point of the whole
            # adjustment, so it has to survive into the sentence a user reads.
            label=(
                "Comparable listings do not pin this vehicle's price down closely "
                "enough to call this ask high or low."
                if absorbed
                else "Asking about what comparable listings ask."
            ),
            implausible_discount=False,
            calibrated=is_calibrated(),
            within_noise=absorbed,
        )

    return PricingRating(
        rating=_lerp(
            residual,
            p.OVERPRICED_KNEE,
            p.OVERPRICED_FLOOR,
            p.FAIR_PRICE_RATING,
            p.OVERPRICED_FLOOR_RATING,
        ),
        residual_fraction=raw,
        scored_residual_fraction=residual,
        uncertainty_margin=uncertainty_margin,
        band="overpriced",
        label="Asking above comparable listings.",
        implausible_discount=False,
        calibrated=is_calibrated(),
    )


def negotiation_anchors(
    expected_asking_cents: int,
    interval_low_cents: int,
    interval_high_cents: int,
) -> dict[str, int]:
    """The lower two of spec 5.1's four numbers: strong offer, walk away above.

    Both anchor to the POINT ESTIMATE, not to the interval. Anchoring to the
    interval was tried and is wrong: on a thin comp set the interval is properly
    very wide, and taking its lower bound as the "strong offer" produced
    $3,944 against an expected ask of $7,942 -- not an aggressive offer but an
    insulting one, generated by arithmetic rather than judgement.

    The offsets reproduce the relationship in spec 5.1's own worked example
    (expected ~$14,050, strong offer $13,200, walk away $14,600). UNCALIBRATED.

    A wide interval is still expressed, but through suppression rather than
    through the numbers: `should_publish_anchors` withholds these entirely when
    the comp set cannot support a specific dollar figure. A number a buyer will
    say out loud to a stranger should not be published at all if the evidence
    does not support it.
    """
    return {
        "strong_offer_cents": int(expected_asking_cents * (1.0 - params.STRONG_OFFER_BELOW)),
        "walk_away_above_cents": int(expected_asking_cents * (1.0 + params.WALK_AWAY_ABOVE)),
    }


def should_publish_anchors(
    expected_asking_cents: int | None,
    interval_low_cents: int | None,
    interval_high_cents: int | None,
) -> bool:
    """Whether the comp set supports naming a specific offer figure.

    Spec 5.1 wants the interval width to "honestly communicate comp quality".
    Once that width exceeds the offsets the anchors are built from, the anchors
    stop carrying information: any figure inside such a range is equally
    defensible, so quoting one implies a precision the comps do not have.
    """
    if expected_asking_cents is None or interval_low_cents is None or interval_high_cents is None:
        return False
    width_fraction = (interval_high_cents - interval_low_cents) / expected_asking_cents
    return width_fraction <= params.MAX_INTERVAL_WIDTH_FOR_ANCHORS
