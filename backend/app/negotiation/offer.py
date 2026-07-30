"""The offer plan: what to open at, what to expect to pay, when to walk (spec 7.5).

Spec 7.5 asks the negotiation section for "strength, leverage points, suggested
offer with reasoning". This module is the third of those, and it replaces a
single figure with three, for two reasons the single figure could not survive.

WHY THREE FIGURES AND NOT ONE
-----------------------------
One number cannot answer the question a buyer actually has. "Suggested offer
$13,200" does not say whether that is the opening move or the target, and a buyer
who opens at their own target has already lost the difference: a seller who
splits it lands ABOVE what the evidence supports. So the plan names the opening
offer, the price to expect to settle at, and the ceiling to walk away above,
which is the smallest set that describes a negotiation rather than a price.

WHY TWO ANCHORING BASES
-----------------------
This is the substantive departure from spec 5.1, which derives every actionable
figure from the expected asking price.

`pricing.curve.should_publish_anchors` is right to refuse a specific dollar
figure when the comp interval is too wide to support one -- a number a buyer says
out loud to a stranger should not be invented. But that threshold withholds the
anchors on roughly 95% of real evaluations (docs/scoring-audit.md finding #5), so
a brief built only on them is empty almost always, which is what the negotiation
section had become: a leverage word, a day count, and nothing to do.

The resolution is in spec 6.4's own opening claim -- negotiation strength is
"genuinely orthogonal to deal quality". If that is true, then a figure derived
from time on market and seller wording owes the comp set nothing. It is a
different and weaker claim than a market price:

    OfferBasis.COMPS   "comparable listings support about $X"
    OfferBasis.ASK     "sellers in this position usually take about $X off"

Both are honest; they are not interchangeable, and which one is being made is
recorded on the plan rather than left for the reader to infer. The ask-anchored
plan also declines to invent a walk-away figure, because "walk away above" is a
statement about value and there is no value estimate underneath it.

WHAT IT REFUSES TO DO
---------------------
Name a figure more than `MAX_CREDIBLE_BELOW_ASK` under the ask. An offer that far
down does not read as aggressive, it reads as an insult, and it ends the
conversation this brief exists to start. When the market price is further below
the ask than that, `OfferStance.STRETCH` says so in words instead of printing a
number that will not be answered.

NOTHING HERE MOVES A PRICE, A RATING OR A CONFIDENCE LEVEL. It reads the pricing
dimension's published output and stops, the same one-way flow `strength.py`
documents.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

from . import params
from .strength import NegotiationAssessment


class OfferBasis(StrEnum):
    """What the figures are derived from, and therefore what they claim."""

    #: The expected asking price from the comp set. The stronger claim.
    COMPS = "comps"
    #: This listing's own ask, discounted by leverage evidence alone. Says what
    #: sellers in this position usually take, not what the vehicle is worth.
    ASK = "ask"
    #: Nothing to anchor to, so no figures at all.
    NONE = "none"


class OfferStance(StrEnum):
    """The shape of the negotiation, which decides how the figures read."""

    #: There is room between the ask and a defensible price. Open, then settle.
    NEGOTIATE = "negotiate"
    #: The ask is already at or below what the evidence supports. The risk here
    #: is losing the car, not overpaying.
    PAY_NEAR_ASKING = "pay_near_asking"
    #: The gap between the ask and a defensible price is wider than a
    #: private-party seller usually moves.
    STRETCH = "stretch"
    #: No asking price to work from.
    WITHHELD = "withheld"


@dataclass(frozen=True)
class OfferPlan:
    """Spec 7.5's "suggested offer with reasoning", as figures plus the why."""

    stance: OfferStance
    basis: OfferBasis
    #: What to open at -- the one figure the buyer says out loud first.
    opening_cents: int | None
    #: What to expect to settle at. Never below `opening_cents`.
    target_cents: int | None
    #: The ceiling. None on an ask-anchored plan: "walk away above" is a claim
    #: about value, and an ask-anchored plan has no value estimate under it.
    walk_away_cents: int | None
    #: Why these numbers, strongest reason first (spec 7.5). ACTIONABLE ONLY --
    #: each sentence explains a figure. What the figures are *not* goes in
    #: `caveat`, which is a different kind of statement and belongs somewhere
    #: else on screen.
    reasoning: tuple[str, ...]
    #: The single caveat covering everything the figures do not claim: the
    #: anchoring basis, and a missing posted date. One field rather than several
    #: sentences scattered through `reasoning`, because a caveat repeated in two
    #: registers reads as two caveats -- which is exactly what happened when this
    #: text lived both here and in the overlay. None when there is nothing to
    #: qualify.
    caveat: str | None = None
    #: Present only on `OfferStance.WITHHELD`, and then it is the whole answer.
    withheld_reason: str | None = None

    @property
    def has_figures(self) -> bool:
        return self.opening_cents is not None


def _money(cents: int) -> str:
    return f"${round(cents / 100):,}"


def _lerp(low: float, high: float, fraction: float) -> float:
    return low + (high - low) * fraction


def _round_down(cents: int) -> int:
    """Round a derived figure down to something a person would actually say.

    Arithmetic produces $13,110.20 and nobody opens a negotiation at $13,110: a
    figure that precise reads as a number generated by a machine, which is exactly
    what a buyer quoting it does not want to sound like. Rounded DOWN rather than
    to nearest, so the rounding never pushes an offer above what the evidence
    supports.

    The ask itself is never passed through this. Restating a seller's $12,450 as
    $12,400 would misquote them.
    """
    increment = 10_000 if cents >= 1_000_000 else (5_000 if cents >= 100_000 else 2_500)
    return (cents // increment) * increment


def _withheld(reason: str) -> OfferPlan:
    return OfferPlan(
        stance=OfferStance.WITHHELD,
        basis=OfferBasis.NONE,
        opening_cents=None,
        target_cents=None,
        walk_away_cents=None,
        reasoning=(),
        withheld_reason=reason,
    )


def _caveat(basis: OfferBasis, negotiation: NegotiationAssessment) -> str | None:
    """Everything the figures do not claim, as ONE statement.

    Assembled here rather than left as sentences inside `reasoning`, and owned by
    this module rather than restated by the overlay, because it was previously
    both: the ask-anchored qualification appeared in `reasoning` AND as its own
    note in the panel, and a missing posted date was explained once in `reasoning`
    and again beside the time-on-market graphic. Four blocks of hedging in the
    middle of a section whose job is to hand over three numbers.

    None for a comp-anchored plan with a known posted date -- there is nothing to
    qualify, and the asking-price-versus-sale-price point (spec 4.5) is already a
    standing notice on the whole evaluation. Repeating it here would be a fifth.
    """
    dated = negotiation.days_listed is not None

    no_date = (
        "Marketplace exposed no posted date for this listing, so the figures assume "
        "ordinary movement for a private-party sale rather than any particular urgency -- "
        "that is an unknown, not a fresh listing."
    )

    if basis is not OfferBasis.ASK:
        return None if dated else no_date

    # Composed as one statement rather than two concatenated ones. Bolting the
    # no-date sentence onto the end produced a caveat that said the figures came
    # from "how long this has been listed" AND that there was no posted date, in
    # consecutive sentences.
    source = (
        "how long this has been listed and how the seller writes"
        if dated
        else "ordinary private-party movement and how the seller writes"
    )
    thin_comps = (
        "there were too few comparable listings for this vehicle, spread too widely, to "
        "name a fair price"
    )
    if not dated:
        thin_comps += ", and Marketplace exposed no posted date, so there is no "
        thin_comps += "time-on-market evidence either"

    return (
        f"These figures come from {source}, not from comparable prices: {thin_comps}. They "
        "say what sellers in this position usually take rather than what the car is worth, "
        "which is also why no walk-away figure is shown."
    )


def _leverage_clause(negotiation: NegotiationAssessment) -> str | None:
    """The half-sentence that says which evidence moved the figures.

    Written from the same facts `leverage_points` reports, but as a clause rather
    than a bullet: the reasoning has to explain a NUMBER, and "listed 47 days" on
    its own line does not connect to the figure above it.

    None when there is no posted date. The reasoning then states the figures
    without a because-clause, and `_caveat` explains the absence once.
    """
    days = negotiation.days_listed
    if days is None:
        return None
    if days >= params.VERY_STALE_LISTING_DAYS:
        return f"it has been listed {days} days without selling"
    if days >= params.STALE_LISTING_DAYS:
        return f"it has been listed {days} days at this price"
    if days * 24 < params.FRESH_LISTING_HOURS:
        return "it was listed within the last day, so the seller has no reason to move yet"
    return f"it has been listed {days} days"


def _rigidity_note(negotiation: NegotiationAssessment) -> list[str]:
    """One sentence when the seller has said not to negotiate.

    Only when the phrasing is one-directional. A description saying both "firm on
    price" and "must sell this week" is genuinely ambiguous rather than rigid, and
    `strength.py` already reports the contradiction as its own leverage point.
    """
    language = negotiation.language
    if negotiation.seller.is_dealer or not language.rigid or language.motivated:
        return []
    return [
        f"The seller wrote \"{language.rigid[0]}\", so expect the small end of any "
        "movement -- the figures above are already held back for it."
    ]


def _comp_anchored(
    *,
    ask_cents: int,
    expected_asking_cents: int,
    walk_away_cents: int | None,
    negotiation: NegotiationAssessment,
) -> OfferPlan:
    """The plan when the comp set can name a market price.

    `target_cents` slides from the expected asking price (no leverage) down to
    `MAX_LEVERAGE_DISCOUNT` below it (maximum leverage), which is deliberately
    where the pricing gauge's own "strong offer" figure sits. So the two sections
    agree by construction: the gauge shows the best case, and this shows how much
    of it this particular listing's leverage actually reaches.

    `walk_away_cents` is capped at the ask. `pricing.curve.negotiation_anchors`
    computes it as a fixed markup over the EXPECTED price, with no view of this
    listing's own ask -- a defensible benchmark there (spec 5.1's gauge shows what
    a fair ceiling looks like in general) but not here: on an underpriced listing
    the uncapped figure lands above the asking price, and "walk away above
    $17,360" on a $12,450 listing is not advice anyone selling on Marketplace can
    act on -- there is no bidding war pushing the price past what the seller
    posted. The most a buyer is ever asked to pay is the ask itself.
    """
    fraction = negotiation.leverage_fraction
    discount = params.MAX_LEVERAGE_DISCOUNT * fraction
    target = _round_down(round(expected_asking_cents * (1.0 - discount)))
    floor = _round_down(round(ask_cents * (1.0 - params.MAX_CREDIBLE_BELOW_ASK)))
    clause = _leverage_clause(negotiation)
    if walk_away_cents is not None:
        walk_away_cents = min(walk_away_cents, ask_cents)

    if ask_cents <= target:
        # The ask is already at or under the defensible price. Offering below it
        # is still legitimate if the listing has sat -- but with no leverage
        # evidence the honest answer is that there is nothing to argue with, and
        # the opening becomes the ask itself rather than a token deduction
        # invented to have something to put in the box.
        opening = ask_cents if discount == 0 else _round_down(round(ask_cents * (1.0 - discount)))
        reasoning = [
            f"At {_money(ask_cents)} this is already asking at or below the "
            f"{_money(expected_asking_cents)} comparable listings support, so there is "
            "little here to argue down."
        ]
        if opening < ask_cents:
            reasoning.append(
                f"Because {clause}, {_money(opening)} is still worth opening at -- but "
                "the number to watch on this listing is the walk-away, not the discount."
            )
        else:
            reasoning.append(
                "The figure to watch on this listing is the walk-away, not the discount. "
                "A car priced under the comps goes quickly, so a slow negotiation is the "
                "way to lose it."
            )
        return OfferPlan(
            stance=OfferStance.PAY_NEAR_ASKING,
            basis=OfferBasis.COMPS,
            opening_cents=opening,
            target_cents=ask_cents,
            walk_away_cents=walk_away_cents,
            reasoning=tuple([*reasoning, *_rigidity_note(negotiation)]),
            caveat=_caveat(OfferBasis.COMPS, negotiation),
        )

    # The credibility floor may only raise an OPENING toward the target. It must
    # never raise the target itself, which is the version of this that was written
    # first and was actively harmful: with an ask of $20,000 against a market price
    # of $13,900 it produced "offer $17,000", a figure a seller accepts on the spot
    # while the buyer overpays by three thousand dollars. Going unanswered is an
    # acceptable outcome; overpaying is not. So when the floor sits above the
    # target, the target holds and the STANCE carries the finding instead.
    opening = min(target, max(_round_down(round(target * (1.0 - params.OPENING_GAP))), floor))

    if floor > target:
        gap = ask_cents - target
        return OfferPlan(
            stance=OfferStance.STRETCH,
            basis=OfferBasis.COMPS,
            opening_cents=target,
            target_cents=target,
            walk_away_cents=walk_away_cents,
            reasoning=tuple(
                [
                    f"This ask is about {_money(gap)} above the {_money(target)} comparable "
                    "listings support -- a bigger cut than private sellers usually make.",
                    f"{_money(target)} is still the right number to offer, and it is far "
                    f"enough under the {_money(ask_cents)} ask that it may get no reply at "
                    "all. That is the better outcome here: the alternative is paying "
                    "thousands over what the comps support. Lead with the comparable "
                    "prices, and expect to walk.",
                    *_rigidity_note(negotiation),
                ]
            ),
            caveat=_caveat(OfferBasis.COMPS, negotiation),
        )

    reasoning = [
        f"Comparable listings support about {_money(target)}, so that is the number to "
        f"hold out for rather than the {_money(ask_cents)} on the post.",
        f"Open at {_money(opening)} so there is room to be met in the middle -- opening "
        "at your own target means settling above it.",
    ]
    if fraction > 0:
        reasoning.insert(
            1, f"That figure allows for the fact that {clause}."
        )
    if opening == floor:
        reasoning.append(
            f"Nothing below {_money(floor)}: more than "
            f"{round(params.MAX_CREDIBLE_BELOW_ASK * 100)}% under the ask usually goes "
            "unanswered."
        )
    return OfferPlan(
        stance=OfferStance.NEGOTIATE,
        basis=OfferBasis.COMPS,
        opening_cents=opening,
        target_cents=target,
        walk_away_cents=walk_away_cents,
        reasoning=tuple([*reasoning, *_rigidity_note(negotiation)]),
        caveat=_caveat(OfferBasis.COMPS, negotiation),
    )


def _ask_anchored(
    *,
    ask_cents: int,
    negotiation: NegotiationAssessment,
    overpriced: bool,
) -> OfferPlan:
    """The plan when the comp set cannot name a market price -- the common case.

    Both figures are a share off the ASK, interpolated between ordinary
    private-party movement and the most a strong position justifies. This makes
    no claim about what the vehicle is worth, and `OfferBasis.ASK` is how the UI
    knows to say so.
    """
    fraction = negotiation.leverage_fraction
    opening = _round_down(
        round(
            ask_cents
            * (
                1.0
                - _lerp(
                    params.ASK_ANCHORED_OPENING_MIN, params.ASK_ANCHORED_OPENING_MAX, fraction
                )
            )
        )
    )
    target = _round_down(
        round(
            ask_cents
            * (
                1.0
                - _lerp(
                    params.ASK_ANCHORED_TARGET_MIN, params.ASK_ANCHORED_TARGET_MAX, fraction
                )
            )
        )
    )

    clause = _leverage_clause(negotiation)
    opener = f"Open at {_money(opening)} and expect to settle nearer {_money(target)}"
    reasoning = [f"{opener}, because {clause}." if clause else f"{opener}."]

    if overpriced:
        # Directional only. The comp set could not support a figure, so it does
        # not get to contribute one here either -- but the DIRECTION it points
        # survives the imprecision, and it is exactly spec 6.4's price x time
        # interaction showing up in the brief.
        reasoning.append(
            "Comparable listings do put this ask on the high side, so the seller may have "
            "more room than the time on market alone suggests."
        )
    return OfferPlan(
        stance=OfferStance.NEGOTIATE,
        basis=OfferBasis.ASK,
        opening_cents=opening,
        target_cents=target,
        walk_away_cents=None,
        reasoning=tuple([*reasoning, *_rigidity_note(negotiation)]),
        caveat=_caveat(OfferBasis.ASK, negotiation),
    )


def plan_offer(
    *,
    ask_cents: int | None,
    expected_asking_cents: int | None,
    walk_away_cents: int | None,
    negotiation: NegotiationAssessment,
    overpriced: bool = False,
) -> OfferPlan:
    """Build the offer plan for one listing.

    `expected_asking_cents` must be passed as None unless the pricing dimension
    PUBLISHED its anchors (`pricing.curve.should_publish_anchors`). That check is
    the caller's, not this module's: it is a statement about whether the comp set
    supports a dollar figure, which pricing owns and this module only consumes.

    `overpriced` is the pricing rating's direction, used for one directional
    sentence on an ask-anchored plan. Never a figure -- a comp set too wide to
    name a price does not get to contribute one by the back door.
    """
    if ask_cents is None or ask_cents <= 0:
        return _withheld(
            "This listing has no asking price, so there is no figure to open below."
        )

    if expected_asking_cents is not None and expected_asking_cents > 0:
        return _comp_anchored(
            ask_cents=ask_cents,
            expected_asking_cents=expected_asking_cents,
            walk_away_cents=walk_away_cents,
            negotiation=negotiation,
        )

    return _ask_anchored(ask_cents=ask_cents, negotiation=negotiation, overpriced=overpriced)
