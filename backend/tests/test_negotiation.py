"""Time on market, seller language and negotiation strength (spec 6.4, step 4).

The structural claims these tests protect:

  1. Negotiation strength is ORTHOGONAL to deal quality (spec 6.4). Nothing here
     may change a price, a rating or a confidence level.
  2. Seller phrases score in OPPOSITE directions (spec 6.4), never as one lump.
  3. The price x time INTERACTION is modelled explicitly, not as two independent
     scores (spec 6.4).
  4. Price-drop history stays out; it is phase three (spec 12).
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from app.negotiation import (
    Direction,
    Leverage,
    assess_negotiation,
    days_on_market,
    detect_seller_type,
    read_seller_language,
)
from app.negotiation.language import SIGNALS
from app.negotiation.seller_type import SellerType

NOW = datetime(2026, 7, 27, 12, 0, tzinfo=UTC)


def posted(days_ago: float) -> datetime:
    return NOW - timedelta(days=days_ago)


def assess(days_ago: float | None = 10, description=None, residual=None, stated_seller_type=None):
    return assess_negotiation(
        posted_at=None if days_ago is None else posted(days_ago),
        observed_at=NOW,
        description=description,
        price_residual=residual,
        stated_seller_type=stated_seller_type,
    )


class TestDaysOnMarket:
    def test_counts_whole_days(self):
        assert days_on_market(posted(30.5), NOW) == 30

    def test_missing_posted_date_is_unknowable(self):
        assert days_on_market(None, NOW) is None

    def test_a_future_posted_date_is_a_parse_error_not_a_fresh_listing(self):
        assert days_on_market(NOW + timedelta(days=3), NOW) is None


class TestTimeOnMarket:
    def test_a_listing_under_a_day_old_gives_weak_leverage(self):
        # Spec 6.4: "Under 24 hours means competing with everyone else who saw
        # it, so leverage is low regardless of price."
        a = assess(days_ago=0.5)
        assert a.leverage is Leverage.WEAK
        assert any("competing with everyone" in p for p in a.leverage_points)

    def test_thirty_days_is_the_documented_threshold(self):
        # Spec 6.4: "30+ at unchanged price indicates a motivated seller."
        assert assess(days_ago=29).strength < assess(days_ago=30).strength

    def test_leverage_rises_with_time(self):
        strengths = [assess(days_ago=d).strength for d in (1, 10, 20, 40, 100)]
        assert strengths == sorted(strengths)

    def test_a_very_stale_listing_is_strong(self):
        assert assess(days_ago=104).leverage is Leverage.STRONG

    def test_no_posted_date_reports_unknown_not_weak(self):
        # Absence of evidence is not evidence of a fresh listing.
        a = assess(days_ago=None)
        assert a.leverage is Leverage.UNKNOWN
        assert a.days_listed is None


class TestSellerLanguageDirection:
    """Spec 6.4: "scored in OPPOSITE directions"."""

    def test_the_spec_keyword_set_is_covered(self):
        # Every phrase spec 6.4 names explicitly.
        for phrase in [
            "firm on price",
            "no lowballers",
            "need gone today",
            "moving",
            "inherited",
            "bought a new car",
            "wife says sell",
            "OBO",
            "must sell by Friday",
        ]:
            reading = read_seller_language(f"Selling my car. {phrase}.")
            assert reading.motivated or reading.rigid, f"no signal for {phrase!r}"

    def test_rigid_and_motivated_are_kept_apart(self):
        reading = read_seller_language("Moving overseas, must sell. Firm on price, no lowballers.")
        assert reading.motivated and reading.rigid
        assert reading.is_contradictory

    def test_they_move_strength_in_opposite_directions(self):
        motivated = assess(description="Moving out of state, need it gone, OBO.")
        rigid = assess(description="Price is firm. No lowballers. Not negotiable.")
        assert motivated.strength > rigid.strength

    def test_every_signal_declares_a_direction(self):
        for signal in SIGNALS:
            assert signal.direction in (Direction.MOTIVATED, Direction.RIGID)
            assert 1 <= signal.weight <= 3

    def test_no_description_differs_from_an_unremarkable_one(self):
        assert read_seller_language(None).had_text is False
        assert read_seller_language("Clean car, runs great.").had_text is True


class TestPriceTimeInteraction:
    """Spec 6.4: "Model the interaction explicitly rather than scoring price and
    time independently. A car at market price sitting 45 days is a better
    opportunity than the price residual alone suggests"."""

    def test_stale_and_at_market_beats_stale_alone(self):
        alone = assess(days_ago=45, residual=None)
        interacting = assess(days_ago=45, residual=0.0)
        assert interacting.strength > alone.strength
        assert any("passed" in p for p in interacting.leverage_points)

    def test_the_bonus_does_not_apply_to_an_underpriced_stale_car(self):
        # A cheap car sitting a while may simply not have been seen yet; an
        # at-market one sitting a while has been seen and declined.
        cheap = assess(days_ago=45, residual=-0.25)
        assert not any("passed" in p for p in cheap.leverage_points)

    def test_the_bonus_does_not_apply_to_a_fresh_overpriced_car(self):
        fresh = assess(days_ago=3, residual=0.20)
        assert not any("passed" in p for p in fresh.leverage_points)

    def test_the_interaction_is_not_reproducible_by_adding_the_parts(self):
        # If it were, spec 6.4's instruction would be satisfied by independent
        # scoring, which it explicitly is not.
        base = assess(days_ago=45, residual=None).strength
        overpriced_fresh = assess(days_ago=1, residual=0.2).strength
        both = assess(days_ago=45, residual=0.2).strength
        assert both > base and both > overpriced_fresh


class TestSeparationFromDealQuality:
    def test_negotiation_does_not_read_or_change_the_price(self):
        # Spec 6.4: "a slightly overpriced car that has sat 58 days is a weak
        # deal and a strong negotiation."
        overpriced_stale = assess(days_ago=58, residual=0.10)
        assert overpriced_stale.leverage is Leverage.STRONG

    def test_a_bargain_listed_today_is_a_great_deal_and_a_weak_negotiation(self):
        bargain_fresh = assess(days_ago=0.2, residual=-0.15)
        assert bargain_fresh.leverage is Leverage.WEAK

    def test_it_is_not_a_headline_metric(self):
        # Spec 6.4: "Surface this inside the brief rather than as a third
        # headline number."
        assert assess().headline_safe is False


class TestDealerDetection:
    def test_captured_dealer_boilerplate_is_caught(self):
        # Verbatim from captured targets. Five of six are dealers.
        for text in [
            "Dealership: DriveNation. Financing Available. Trade-Ins Welcome.",
            "go see it on our site! We only sell clean title vehicles and back "
            "them with a warranty",
            "SPECIAL OFFER FREE 3 MONTHS/3,000 MILES LIMITED WARRANTY, visit us",
            "Priced to Move! Finance special available. Reach out for details!",
        ]:
            assert detect_seller_type(text).is_dealer, text[:40]

    def test_a_real_private_listing_is_not_flagged(self):
        # Capture 3, the one genuine private seller in the captured set.
        text = (
            "Car has very low miles for its age and has its problems to like rust. "
            "But all around car is very reliable clean title dose need a fuel "
            "pressure solenoid but runs fine with out it"
        )
        assert not detect_seller_type(text).is_dealer

    def test_one_supporting_marker_is_not_enough(self):
        # A private seller can mention remaining factory warranty.
        assert not detect_seller_type("Still has factory warranty until 2027.").is_dealer

    def test_no_description_is_unknown_not_private(self):
        assert detect_seller_type(None).seller_type is SellerType.UNKNOWN

    def test_dealer_phrasing_is_not_scored_as_motivation(self):
        # "Priced to Move!" is copy, not urgency. Scoring it as leverage would
        # read a sales pitch as a negotiating advantage.
        dealer = assess(days_ago=10, description="Priced to Move! Finance special available.")
        private = assess(days_ago=10, description="Priced to move, moving out of state, OBO")
        assert dealer.seller.is_dealer
        assert private.strength > dealer.strength

    def test_time_on_market_still_counts_for_a_dealer(self):
        # Inventory ageing is a real signal even when the phrasing is not.
        stale = assess(days_ago=60, description="Dealership. Financing available.")
        fresh = assess(days_ago=2, description="Dealership. Financing available.")
        assert stale.strength > fresh.strength


class TestStatedSellerTypeOverridesText:
    """Facebook's own `vehicle_seller_type` is decisive over description
    boilerplate (2026-07-30 fix). Before this, a dealer with a plain
    description -- no "financing", no "dealership" -- was scored as a private
    seller everywhere downstream of `is_dealer`, even when Facebook's own
    field on the same listing already said DEALER."""

    def test_a_bare_description_dealer_is_still_caught_when_facebook_says_so(self):
        # The exact failure this fixes: no boilerplate at all in the text.
        reading = detect_seller_type("Clean car, low miles, call or text.", stated="DEALER")
        assert reading.is_dealer
        assert reading.seller_type is SellerType.DEALER

    def test_the_stated_reason_is_recorded_as_a_marker(self):
        reading = detect_seller_type("Clean car, low miles.", stated="DEALER")
        assert "Facebook lists this listing as a dealer" in reading.markers

    def test_stated_private_seller_overrides_boilerplate_sounding_text(self):
        # A private seller mentioning a warranty or financing should not be
        # relabeled a dealer when Facebook's own field says otherwise.
        reading = detect_seller_type(
            "Still has factory warranty, financing may be available through my bank.",
            stated="PRIVATE_SELLER",
        )
        assert not reading.is_dealer

    def test_unstated_falls_back_to_the_text_heuristic(self):
        with_text = detect_seller_type("Dealership: DriveNation. Financing Available.", stated=None)
        assert with_text.is_dealer
        without_markers = detect_seller_type("Clean car, low miles.", stated=None)
        assert not without_markers.is_dealer

    def test_unrecognised_stated_value_falls_back_to_text(self):
        reading = detect_seller_type("Dealership: DriveNation.", stated="")
        assert reading.is_dealer

    def test_flows_through_assess_negotiation(self):
        # End to end: the field that decides the red-flags bullet and the
        # offer's dealer gating (`negotiation.seller.is_dealer`) must reflect
        # Facebook's field, not just the description.
        result = assess(description="Great car, priced fair.", stated_seller_type="DEALER")
        assert result.seller.is_dealer


class TestPhaseThreeStaysOut:
    def test_price_drop_history_is_not_implemented(self):
        # Spec 6.4 calls it "the strongest version of this signal" and spec 12
        # assigns it to phase three. `price_changed` is NULL on every captured
        # observation, so an implementation would silently never fire.
        import inspect

        from app.negotiation import strength

        source = inspect.getsource(strength)
        assert "price_changed" not in source
        assert "price_drop" not in source

    def test_assess_takes_no_price_history_argument(self):
        import inspect

        sig = inspect.signature(assess_negotiation)
        assert set(sig.parameters) == {
            "posted_at",
            "observed_at",
            "description",
            "price_residual",
            "stated_seller_type",
        }


@pytest.mark.parametrize("days,expected", [(0.2, Leverage.WEAK), (45, Leverage.MODERATE)])
def test_leverage_bands(days, expected):
    assert assess(days_ago=days).leverage is expected
