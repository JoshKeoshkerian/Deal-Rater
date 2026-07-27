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


def _lerp(x: float, x0: float, x1: float, y0: float, y1: float) -> float:
    """Linear interpolation between two breakpoints, clamped to the segment."""
    if x1 == x0:
        return y0
    t = (x - x0) / (x1 - x0)
    t = max(0.0, min(1.0, t))
    return y0 + t * (y1 - y0)


def rate_price_residual(residual: float) -> PricingRating:
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
    """
    p = params

    if residual <= p.IMPLAUSIBLE_DISCOUNT:
        # Past the far end the rating does not keep falling. Something is wrong
        # with the listing, and how wrong is a risk question this dimension is
        # not equipped to answer.
        return PricingRating(
            rating=p.IMPLAUSIBLE_DISCOUNT_RATING,
            residual_fraction=residual,
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
            residual_fraction=residual,
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
            residual_fraction=residual,
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
            residual_fraction=residual,
            band="fair",
            label="Asking about what comparable listings ask.",
            implausible_discount=False,
            calibrated=is_calibrated(),
        )

    return PricingRating(
        rating=_lerp(
            residual,
            p.OVERPRICED_KNEE,
            p.OVERPRICED_FLOOR,
            p.FAIR_PRICE_RATING,
            p.OVERPRICED_FLOOR_RATING,
        ),
        residual_fraction=residual,
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
