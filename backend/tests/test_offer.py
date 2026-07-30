"""The offer plan and the drafted message (spec 7.5, plus one addition).

WHAT THESE TESTS ARE PROTECTING
-------------------------------
The section this replaced published a figure on roughly 1 evaluation in 20, and
when it did publish one it could be the ask itself with no explanation. Both
failures were invisible: nothing asserted that a plan comes out at all, so a
threshold change upstream in `pricing` emptied the negotiation brief without
breaking a test.

So the first class here is about AVAILABILITY -- the plan exists whenever there is
an ask -- and the rest are about the figures being defensible: ordered, credible,
never above the ask, and never claiming comp evidence they do not have.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from app.negotiation import (
    OfferBasis,
    OfferStance,
    assess_negotiation,
    draft_opening_message,
    params,
    plan_offer,
    vehicle_phrase,
)

NOW = datetime(2026, 7, 29, 12, 0, tzinfo=UTC)


def negotiation(*, days_ago: float | None = 10, description: str | None = None, residual=None):
    posted = None if days_ago is None else NOW - timedelta(days=days_ago)
    return assess_negotiation(
        posted_at=posted,
        observed_at=NOW,
        description=description,
        price_residual=residual,
    )


class TestLeverageFraction:
    """The single knob the offer discounts scale by."""

    def test_a_fresh_firm_listing_earns_nothing(self):
        # The old `extra_discount` handed this listing 1.8% off, because it
        # divided by 100 from a base of 30 rather than measuring from the base.
        n = negotiation(days_ago=0.2, description="Firm on price, no lowballers.")
        assert n.leverage_fraction == 0.0

    def test_no_posted_date_earns_nothing(self):
        assert negotiation(days_ago=None).leverage_fraction == 0.0

    def test_a_very_stale_motivated_listing_earns_most_of_it(self):
        n = negotiation(days_ago=90, description="Moving, must sell, OBO, motivated seller.")
        assert n.leverage_fraction > 0.5

    def test_it_stays_in_range(self):
        for days in (0.1, 1, 13, 20, 31, 76, 400):
            n = negotiation(days_ago=days, description="motivated, must sell, moving, OBO")
            assert 0.0 <= n.leverage_fraction <= 1.0


class TestThePlanIsAlwaysAvailable:
    """The defect that made the section useless: no figure on ~95% of listings.

    `pricing.params.MAX_INTERVAL_WIDTH_FOR_ANCHORS` withholds the expected-price
    anchors on roughly 19 evaluations in 20 (docs/scoring-audit.md finding #5), and
    the old brief had nothing to say on every one of them.
    """

    def test_an_ask_alone_is_enough(self):
        plan = plan_offer(
            ask_cents=1_490_000,
            expected_asking_cents=None,
            walk_away_cents=None,
            negotiation=negotiation(days_ago=40),
        )
        assert plan.has_figures
        assert plan.basis is OfferBasis.ASK
        assert plan.reasoning

    def test_it_says_the_figures_are_not_from_comparable_prices(self):
        # The weaker claim has to be labelled as the weaker claim, or an
        # ask-anchored figure reads as a market price.
        plan = plan_offer(
            ask_cents=1_490_000,
            expected_asking_cents=None,
            walk_away_cents=None,
            negotiation=negotiation(days_ago=40),
        )
        assert plan.caveat is not None
        assert "not from comparable prices" in plan.caveat

    def test_no_walk_away_figure_without_a_value_estimate(self):
        # "Walk away above X" is a claim about worth. An ask-anchored plan has no
        # estimate of worth underneath it, so it declines to make one.
        plan = plan_offer(
            ask_cents=1_490_000,
            expected_asking_cents=None,
            walk_away_cents=None,
            negotiation=negotiation(days_ago=40),
        )
        assert plan.walk_away_cents is None

    def test_withheld_only_when_there_is_no_ask(self):
        plan = plan_offer(
            ask_cents=None,
            expected_asking_cents=1_405_000,
            walk_away_cents=1_460_000,
            negotiation=negotiation(),
        )
        assert plan.stance is OfferStance.WITHHELD
        assert plan.basis is OfferBasis.NONE
        assert not plan.has_figures
        assert plan.withheld_reason


class TestFiguresAreOrderedAndCredible:
    @pytest.mark.parametrize("days", [None, 0.2, 5, 20, 35, 90])
    @pytest.mark.parametrize("expected", [None, 1_405_000, 900_000, 1_800_000])
    def test_opening_never_exceeds_target_and_neither_exceeds_the_ask(self, days, expected):
        ask = 1_490_000
        plan = plan_offer(
            ask_cents=ask,
            expected_asking_cents=expected,
            walk_away_cents=1_460_000 if expected else None,
            negotiation=negotiation(days_ago=days),
        )
        assert plan.opening_cents is not None and plan.target_cents is not None
        assert plan.opening_cents <= plan.target_cents <= ask

    @pytest.mark.parametrize("days", [None, 0.2, 20, 90])
    @pytest.mark.parametrize("expected", [None, 1_405_000])
    def test_no_negotiable_figure_is_an_insult(self, days, expected):
        # The concept spec 5.1 has no equivalent of. An offer further under the
        # ask than this does not read as aggressive, it goes unanswered.
        #
        # `OfferStance.STRETCH` is the deliberate exception and has its own test:
        # there, going unanswered is the recommendation.
        ask = 1_490_000
        floor = round(ask * (1 - params.MAX_CREDIBLE_BELOW_ASK))
        plan = plan_offer(
            ask_cents=ask,
            expected_asking_cents=expected,
            walk_away_cents=None,
            negotiation=negotiation(days_ago=days, description="moving, must sell, OBO"),
        )
        assert plan.stance is not OfferStance.STRETCH
        assert plan.opening_cents is not None
        # One rounding increment of slack: figures are rounded down to something a
        # person would say out loud (`_round_down`).
        assert plan.opening_cents >= floor - 10_000

    def test_figures_are_rounded_to_something_a_person_would_say(self):
        # $13,110.20 reads as a number a machine produced, which is the opposite
        # of what a buyer quoting it wants to sound like.
        plan = plan_offer(
            ask_cents=1_490_000,
            expected_asking_cents=None,
            walk_away_cents=None,
            negotiation=negotiation(days_ago=47, description="moving"),
        )
        assert plan.opening_cents % 10_000 == 0
        assert plan.target_cents % 10_000 == 0

    def test_the_ask_itself_is_never_rounded(self):
        # Restating a seller's $12,455 as $12,400 misquotes them.
        plan = plan_offer(
            ask_cents=1_245_500,
            expected_asking_cents=1_670_000,
            walk_away_cents=None,
            negotiation=negotiation(days_ago=0.2),
        )
        assert plan.target_cents == 1_245_500

    def test_more_leverage_opens_lower(self):
        stale = plan_offer(
            ask_cents=1_490_000,
            expected_asking_cents=None,
            walk_away_cents=None,
            negotiation=negotiation(days_ago=90, description="moving, must sell"),
        )
        fresh = plan_offer(
            ask_cents=1_490_000,
            expected_asking_cents=None,
            walk_away_cents=None,
            negotiation=negotiation(days_ago=0.2),
        )
        assert stale.opening_cents < fresh.opening_cents

    def test_the_opening_leaves_room_to_be_met(self):
        # Opening at your own target means settling above it, because a seller who
        # splits the difference splits it upward.
        plan = plan_offer(
            ask_cents=1_490_000,
            expected_asking_cents=1_405_000,
            walk_away_cents=1_460_000,
            negotiation=negotiation(days_ago=20),
        )
        assert plan.opening_cents < plan.target_cents


class TestCompAnchoredStances:
    def test_a_normal_gap_is_a_negotiation(self):
        plan = plan_offer(
            ask_cents=1_490_000,
            expected_asking_cents=1_405_000,
            walk_away_cents=1_460_000,
            negotiation=negotiation(days_ago=20),
        )
        assert plan.stance is OfferStance.NEGOTIATE
        assert plan.basis is OfferBasis.COMPS
        assert plan.walk_away_cents == 1_460_000

    def test_the_target_slides_between_expected_and_the_pricing_anchor(self):
        # No leverage lands on the expected asking price; maximum leverage lands
        # where the pricing gauge's own "strong offer" sits. That coherence is
        # what stops the two sections quoting different numbers.
        expected = 1_405_000
        none_yet = plan_offer(
            ask_cents=1_600_000,
            expected_asking_cents=expected,
            walk_away_cents=None,
            negotiation=negotiation(days_ago=None),
        )
        # Rounded down to a sayable figure, so within one increment of `expected`.
        assert expected - 10_000 <= none_yet.target_cents <= expected

        loaded = plan_offer(
            ask_cents=1_600_000,
            expected_asking_cents=expected,
            walk_away_cents=None,
            negotiation=negotiation(days_ago=120, description="moving, must sell, OBO, motivated"),
        )
        strong_offer = round(expected * (1 - params.MAX_LEVERAGE_DISCOUNT))
        assert strong_offer - 10_000 <= loaded.target_cents < none_yet.target_cents

    def test_an_ask_below_the_defensible_price_is_not_a_negotiation(self):
        # The old brief printed "Suggested offer $12,450" on a car asking $12,450
        # and explained nothing. The finding here is that there is nothing to
        # argue down, and it is said in words.
        plan = plan_offer(
            ask_cents=1_245_000,
            expected_asking_cents=1_670_000,
            walk_away_cents=1_736_000,
            negotiation=negotiation(days_ago=0.2),
        )
        assert plan.stance is OfferStance.PAY_NEAR_ASKING
        assert plan.opening_cents == 1_245_000
        assert plan.target_cents == 1_245_000
        assert any("little here to argue" in line for line in plan.reasoning)
        # `walk_away_cents` came in at 1_736_000 -- above the $12,450 ask. Nobody
        # buying on Marketplace ends up paying more than the posted price, so the
        # ceiling is capped at the ask rather than passed through as-is.
        assert plan.walk_away_cents == 1_245_000

    def test_walk_away_is_never_above_the_ask(self):
        # `pricing.curve.negotiation_anchors` derives walk_away_above_cents from
        # the EXPECTED price with no view of this listing's own ask, so on a
        # deeply underpriced listing the raw figure lands above what the seller
        # is asking. "Walk away above $17,360" on a $12,450 listing is not
        # something a buyer can act on -- there is no bidding war on Marketplace
        # pushing the price past the post.
        plan = plan_offer(
            ask_cents=1_245_000,
            expected_asking_cents=1_670_000,
            walk_away_cents=1_736_000,
            negotiation=negotiation(days_ago=20),
        )
        assert plan.walk_away_cents is not None
        assert plan.walk_away_cents <= 1_245_000

    def test_a_stale_underpriced_listing_can_still_be_trimmed(self):
        plan = plan_offer(
            ask_cents=1_245_000,
            expected_asking_cents=1_670_000,
            walk_away_cents=None,
            negotiation=negotiation(days_ago=90, description="moving, must sell"),
        )
        assert plan.stance is OfferStance.PAY_NEAR_ASKING
        assert plan.opening_cents < 1_245_000

    def test_an_unreachable_gap_says_so_instead_of_lowballing(self):
        # Expected price 30% under the ask. A credible offer cannot reach it, and
        # the finding is the size of the gap.
        plan = plan_offer(
            ask_cents=2_000_000,
            expected_asking_cents=1_400_000,
            walk_away_cents=1_456_000,
            negotiation=negotiation(days_ago=20),
        )
        assert plan.stance is OfferStance.STRETCH
        assert any("expect to walk" in line for line in plan.reasoning)

    def test_the_credibility_floor_never_recommends_paying_over_market(self):
        """The bug that made the first version of this actively harmful.

        Clamping the TARGET up to the credibility floor turned an ask of $20,000
        against a $14,000 market price into "offer $17,000" -- a figure a seller
        accepts on the spot while the buyer overpays by three thousand dollars. An
        offer that goes unanswered costs nothing; that one costs real money.

        The floor may raise an opening toward the target. It may never raise the
        target.
        """
        expected = 1_400_000
        plan = plan_offer(
            ask_cents=2_000_000,
            expected_asking_cents=expected,
            walk_away_cents=1_456_000,
            negotiation=negotiation(days_ago=20),
        )
        floor = round(2_000_000 * (1 - params.MAX_CREDIBLE_BELOW_ASK))
        assert plan.target_cents <= expected
        assert plan.target_cents < floor
        assert plan.opening_cents <= plan.target_cents


class TestThereIsExactlyOneCaveat:
    """The hedging used to be said three times, in the middle of the section.

    An ask-anchored plan explained its basis in `reasoning` and the overlay
    restated the same point as its own note; a missing posted date was explained
    in `reasoning` and again beside the time-on-market graphic. All of it is now
    one field, which is also the only place the text exists.
    """

    def test_reasoning_carries_no_hedging(self):
        plan = plan_offer(
            ask_cents=1_490_000,
            expected_asking_cents=None,
            walk_away_cents=None,
            negotiation=negotiation(days_ago=None),
        )
        joined = " ".join(plan.reasoning)
        assert "not from comparable prices" not in joined
        assert "posted date" not in joined

    def test_one_caveat_covers_both_the_basis_and_a_missing_date(self):
        plan = plan_offer(
            ask_cents=1_490_000,
            expected_asking_cents=None,
            walk_away_cents=None,
            negotiation=negotiation(days_ago=None),
        )
        assert plan.caveat is not None
        assert "not from comparable prices" in plan.caveat
        assert "no posted date" in plan.caveat

    def test_a_comp_anchored_plan_with_a_date_has_nothing_to_qualify(self):
        # Spec 4.5's asking-vs-sale-price point is a standing notice on the whole
        # evaluation. Repeating it here would be one more block of hedging.
        plan = plan_offer(
            ask_cents=1_490_000,
            expected_asking_cents=1_405_000,
            walk_away_cents=1_460_000,
            negotiation=negotiation(days_ago=20),
        )
        assert plan.caveat is None

    def test_a_missing_date_is_qualified_even_on_a_comp_anchored_plan(self):
        plan = plan_offer(
            ask_cents=1_490_000,
            expected_asking_cents=1_405_000,
            walk_away_cents=1_460_000,
            negotiation=negotiation(days_ago=None),
        )
        assert plan.caveat is not None
        assert "no posted date" in plan.caveat
        assert "not from comparable prices" not in plan.caveat

    def test_the_reasoning_still_reads_as_a_sentence_without_a_date(self):
        # The because-clause is dropped rather than filled with the explanation,
        # which is what produced "..., because Marketplace did not expose a posted
        # date, so this assumes ordinary movement..." as an offer's reasoning.
        plan = plan_offer(
            ask_cents=1_490_000,
            expected_asking_cents=None,
            walk_away_cents=None,
            negotiation=negotiation(days_ago=None),
        )
        assert plan.reasoning[0].endswith(".")
        assert ", because" not in plan.reasoning[0]


class TestItNeverBorrowsPrecisionItDoesNotHave:
    def test_the_overpriced_read_contributes_a_direction_not_a_figure(self):
        without = plan_offer(
            ask_cents=1_490_000,
            expected_asking_cents=None,
            walk_away_cents=None,
            negotiation=negotiation(days_ago=20),
            overpriced=False,
        )
        with_read = plan_offer(
            ask_cents=1_490_000,
            expected_asking_cents=None,
            walk_away_cents=None,
            negotiation=negotiation(days_ago=20),
            overpriced=True,
        )
        assert with_read.opening_cents == without.opening_cents
        assert with_read.target_cents == without.target_cents
        assert len(with_read.reasoning) == len(without.reasoning) + 1

    def test_a_rigid_seller_is_reported_once_and_not_double_counted(self):
        plan = plan_offer(
            ask_cents=1_490_000,
            expected_asking_cents=None,
            walk_away_cents=None,
            negotiation=negotiation(days_ago=20, description="Firm on price. No lowballers."),
        )
        assert sum("small end" in line for line in plan.reasoning) == 1

    def test_a_contradictory_description_is_not_called_rigid(self):
        # "Firm on price" plus "must sell this week" is ambiguous, not rigid, and
        # `strength.py` already reports the contradiction itself.
        plan = plan_offer(
            ask_cents=1_490_000,
            expected_asking_cents=None,
            walk_away_cents=None,
            negotiation=negotiation(days_ago=20, description="Firm on price. Must sell, moving."),
        )
        assert not any("small end" in line for line in plan.reasoning)


class TestTheDraftedMessage:
    def _draft(self, plan, n, **over):
        kwargs = {
            "vehicle": "2016 Mazda CX-5",
            "plan": plan,
            "negotiation": n,
            "ask_cents": 1_490_000,
        }
        kwargs.update(over)
        return draft_opening_message(**kwargs)

    def test_it_carries_the_opening_figure(self):
        n = negotiation(days_ago=38, description="moving")
        plan = plan_offer(
            ask_cents=1_490_000,
            expected_asking_cents=1_405_000,
            walk_away_cents=1_460_000,
            negotiation=n,
        )
        message = self._draft(
            plan, n, expected_low_cents=1_380_000, expected_high_cents=1_430_000
        )
        assert message is not None
        assert f"${round(plan.opening_cents / 100):,}" in message
        assert "2016 Mazda CX-5" in message
        assert "$13,800 to $14,300" in message
        assert "38 days" in message

    def test_it_never_quotes_a_range_the_brief_withheld(self):
        # An ask-anchored plan has no publishable range. Quoting one would put a
        # number in the buyer's mouth that this tool declined to publish.
        n = negotiation(days_ago=40)
        plan = plan_offer(
            ask_cents=1_490_000,
            expected_asking_cents=None,
            walk_away_cents=None,
            negotiation=n,
        )
        message = self._draft(plan, n, expected_low_cents=1_380_000, expected_high_cents=1_430_000)
        assert message is not None
        assert "13,800" not in message

    def test_it_does_not_offer_below_an_ask_it_calls_fair(self):
        n = negotiation(days_ago=0.2)
        plan = plan_offer(
            ask_cents=1_245_000,
            expected_asking_cents=1_670_000,
            walk_away_cents=None,
            negotiation=n,
        )
        message = self._draft(plan, n, ask_cents=1_245_000)
        assert message is not None
        assert "asking price looks fair" in message

    def test_it_does_not_tell_a_seller_they_are_underpriced(self):
        """The buyer's leverage is not disclosed when it points the other way.

        "Similar ones are asking $16,700 and your $12,450 looks fair" is true, and
        putting it in a message this tool wrote FOR THE BUYER hands the seller the
        argument for raising their price.
        """
        n = negotiation(days_ago=0.2)
        plan = plan_offer(
            ask_cents=1_245_000,
            expected_asking_cents=1_670_000,
            walk_away_cents=None,
            negotiation=n,
        )
        message = self._draft(
            plan,
            n,
            ask_cents=1_245_000,
            expected_low_cents=1_640_000,
            expected_high_cents=1_700_000,
        )
        assert message is not None
        assert "16,400" not in message and "17,000" not in message

    def test_a_stretch_offer_names_the_gap_rather_than_hiding_it(self):
        # The same figure reads as a lowball without the acknowledgement and as a
        # position with it.
        n = negotiation(days_ago=35, description="moving")
        plan = plan_offer(
            ask_cents=2_000_000,
            expected_asking_cents=1_400_000,
            walk_away_cents=1_456_000,
            negotiation=n,
        )
        message = self._draft(
            plan,
            n,
            ask_cents=2_000_000,
            expected_low_cents=1_350_000,
            expected_high_cents=1_450_000,
        )
        assert message is not None
        assert "well under what you're asking" in message

    def test_no_figure_means_no_message(self):
        plan = plan_offer(
            ask_cents=None,
            expected_asking_cents=None,
            walk_away_cents=None,
            negotiation=negotiation(),
        )
        assert self._draft(plan, negotiation()) is None

    def test_it_makes_no_claim_about_the_vehicle_itself(self):
        # Rule 1 in `message.py`: the draft may restate the offer, the range and
        # the days listed. Nothing else -- the buyer has not seen the car.
        n = negotiation(days_ago=40, description="moving, must sell")
        plan = plan_offer(
            ask_cents=1_490_000,
            expected_asking_cents=None,
            walk_away_cents=None,
            negotiation=n,
        )
        message = self._draft(plan, n)
        assert message is not None
        for word in ("condition", "clean", "mileage", "recall", "salvage", "problem"):
            assert word not in message.lower()

    def test_the_trim_is_left_out_of_the_vehicle_phrase(self):
        # A seller who never stated a trim reads it as being told about their own
        # car, and it may have come from a VIN decode they never mentioned.
        assert vehicle_phrase(2016, "Mazda", "CX-5") == "2016 Mazda CX-5"

    def test_an_unidentified_vehicle_still_reads_as_english(self):
        assert vehicle_phrase(None, None, None) == "car"
