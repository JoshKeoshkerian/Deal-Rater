"""The opening message, drafted (beyond the spec -- see below).

NOT IN THE SPEC, AND ARGUABLY THE MOST USEFUL THING IN THE BRIEF
---------------------------------------------------------------
Spec 7.5 stops at "suggested offer with reasoning", which leaves the target user
-- spec 1's "first-time or infrequent private-party buyer" -- holding a number
and no idea what to say. The expertise gap spec 6.6 identifies for mechanical
faults exists just as sharply here: an experienced buyer knows to lead with the
comparable prices and to name a viewing before naming a figure, and a first-time
buyer does not. A number nobody sends is worth nothing.

It is also nearly free, which is the same argument spec 6.5 makes for better
alternatives: every fact in the draft is already computed, so this is templating,
not analysis.

DELIBERATELY DETERMINISTIC, NOT AN LLM CALL
-------------------------------------------
Spec 11 rejects "read this listing like an expert buyer" because an LLM asked to
produce it yields "unfalsifiable output that cannot be debugged or validated
against section 9". A drafted message would fail the same test if a model wrote
it: there would be no way to say whether any given sentence was right. Templated
from figures the brief already stands behind, every clause traces to a fact, the
whole thing is testable, and spec 10's per-evaluation cost does not move.

TWO RULES
---------
1. NO CLAIM THE BRIEF HAS NOT ALREADY MADE. The draft may restate the offer, the
   expected range, and the days listed. It may not characterise the vehicle,
   invent a reason for the offer, or mention a fault -- the buyer has not
   inspected it, and a message that misrepresents what they know starts the
   relationship badly and can be quoted back at them.

2. IT IS A DRAFT, IN THE BUYER'S VOICE. Short, plain, and polite: the goal is a
   reply, and a message that reads as generated gets none. Anything it commits
   the buyer to (coming to see the car) is a normal buyer commitment they can
   edit out.
"""

from __future__ import annotations

from .offer import OfferBasis, OfferPlan, OfferStance
from .params import STALE_LISTING_DAYS
from .strength import NegotiationAssessment


def _money(cents: int) -> str:
    return f"${round(cents / 100):,}"


def vehicle_phrase(year: int | None, make: str | None, model: str | None) -> str:
    """How the buyer would refer to the car in a message.

    Trim is deliberately left out even when known: a seller who did not state one
    reads "2016 Mazda CX-5 Touring" as being told about their own car, and the
    trim may have come from a VIN decode they never mentioned.
    """
    parts = [str(year) if year else None, make, model]
    named = " ".join(part for part in parts if part)
    return named or "car"


def _range_clause(low_cents: int | None, high_cents: int | None) -> str | None:
    """The comparable-price sentence, or nothing.

    Only emitted for a comp-anchored plan, where the interval was tight enough for
    pricing to stand behind a figure. Quoting a range the brief itself withheld
    would put a number in the buyer's mouth that this tool declined to publish.
    """
    if low_cents is None or high_cents is None:
        return None
    return (
        f"I've been looking at similar ones nearby and most are asking "
        f"{_money(low_cents)} to {_money(high_cents)}"
    )


def draft_opening_message(
    *,
    vehicle: str,
    plan: OfferPlan,
    negotiation: NegotiationAssessment,
    expected_low_cents: int | None = None,
    expected_high_cents: int | None = None,
    ask_cents: int | None = None,
) -> str | None:
    """The message to send, or None when there is no figure to send.

    Withheld rather than softened when the plan has no numbers: a message that
    opens a negotiation without an offer in it wastes the one reply a buyer gets
    for free.
    """
    if not plan.has_figures or plan.opening_cents is None:
        return None

    opening = plan.opening_cents
    lines: list[str] = [f"Hi -- is the {vehicle} still available?"]

    body: list[str] = []

    # The comparable-price sentence does the persuading, so it goes before the
    # figure: an offer with a reason in front of it is a negotiation, and the same
    # offer on its own is a lowball.
    #
    # NOT ON A LISTING THAT IS ALREADY UNDERPRICED. "Similar ones are asking
    # $16,700 and your $12,450 looks fair" is a true sentence that hands the seller
    # the argument for raising their price, in a message this tool wrote for the
    # buyer. The range is the buyer's leverage, and leverage is not disclosed when
    # it points the other way.
    if plan.basis is OfferBasis.COMPS and plan.stance is not OfferStance.PAY_NEAR_ASKING:
        clause = _range_clause(expected_low_cents, expected_high_cents)
        if clause:
            body.append(f"{clause}.")

    days = negotiation.days_listed
    if days is not None and days >= STALE_LISTING_DAYS:
        body.append(f"I noticed it's been up for {days} days.")

    pays_the_ask = (
        plan.stance is OfferStance.PAY_NEAR_ASKING
        and ask_cents is not None
        and opening >= ask_cents
    )
    if pays_the_ask:
        body.append(
            f"Your asking price looks fair to me -- I can do {_money(opening)} and I'm "
            "ready to move on it."
        )
    elif plan.stance is OfferStance.STRETCH:
        # The offer is a long way under the ask, and pretending otherwise makes it
        # read as a lowball. Naming the gap first is what turns the same figure
        # into a position the seller can answer, or decline, on the merits.
        body.append(
            f"I know that's well under what you're asking, but {_money(opening)} is where "
            "the comparable ones I'm finding are -- happy to send you the listings."
        )
    else:
        body.append(f"I could do {_money(opening)} if that works for you.")

    body.append("I can come take a look this week if you're free.")

    lines.append(" ".join(body))
    lines.append("Thanks!")
    return "\n\n".join(lines)
