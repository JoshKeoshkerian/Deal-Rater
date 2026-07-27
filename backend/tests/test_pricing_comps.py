"""Comp filtering (spec 4.3) -- the hardest accuracy problem in the project.

Several of these tests encode defects found in real captured data rather than
hypotheticals, and are named to say so. They are regression tests for bugs that
silently produced wrong expected prices.
"""

from __future__ import annotations

import pytest

from app.pricing.comps import (
    CompCandidate,
    DealerSignal,
    DrivetrainSignal,
    Exclusion,
    filter_comps,
    normalize_key,
    parse_drivetrain,
    parse_transmission,
    trim_tokens,
    trims_agree,
)


def comp(**kw) -> CompCandidate:
    base = dict(
        listing_id=1,
        source_listing_id="1",
        year=2016,
        make="Mazda",
        model="CX-5",
        trim_text="Touring",
        price_cents=1_100_000,
        mileage=120_000,
        location_text="St Louis, MO",
    )
    base.update(kw)
    return CompCandidate(**base)  # type: ignore[arg-type]


# Distinct from the default comp in both mileage bucket and price, so that
# tests exercising other rules are not silently caught by the same-vehicle
# check first. Cases that need a collision construct it explicitly.
TARGET = comp(
    source_listing_id="target",
    listing_id=999,
    mileage=137_000,
    price_cents=1_050_000,
)


class TestNormalisation:
    @pytest.mark.parametrize("raw", ["CX-5", "Cx-5", "CX5", "cx 5"])
    def test_model_spelling_variants_collapse(self, raw):
        # All four spellings appear in captured data for one vehicle.
        assert normalize_key(raw) == "cx5"

    def test_distinct_models_stay_distinct(self):
        assert normalize_key("CX-5") != normalize_key("CX-9")

    def test_body_style_noise_is_not_trim(self):
        # "Touring" and "Touring Sport Utility 4D" are the same trim written two
        # ways, and captured data writes the same car both ways.
        assert trim_tokens("Touring Sport Utility 4D") == trim_tokens("Touring")

    def test_different_trims_do_not_collapse(self):
        assert trim_tokens("Grand Touring") != trim_tokens("Sport")

    def test_sport_survives_when_it_is_the_trim_not_the_body(self):
        # "Sport" is body-style noise in "Touring Sport Utility 4D" and a real
        # trim level in "Sport SUV 4D". Both spellings occur in captured data
        # for the CX-5, so a bare stopword list erases the second one's trim.
        assert trim_tokens("Sport SUV 4D") == frozenset({"sport"})
        assert trim_tokens("Sport 4dr SUV") == frozenset({"sport"})
        assert trim_tokens("Touring Sport Utility 4D") == frozenset({"touring"})

    def test_grand_touring_is_not_touring(self):
        # The difference is thousands of dollars -- exactly the "large price
        # variance" spec 4.3 says trim drives.
        assert not trims_agree(trim_tokens("Touring"), trim_tokens("Grand Touring"))

    def test_same_trim_written_two_ways_agrees(self):
        assert trims_agree(
            trim_tokens("Grand Touring Sport Utility 4D"), trim_tokens("Grand Touring")
        )


class TestInertHooks:
    """Drivetrain and transmission are parsed but never filter at step 3."""

    def test_drivetrain_parses_when_present(self):
        assert parse_drivetrain("Grand Touring AWD") is DrivetrainSignal.AWD
        assert parse_drivetrain("Sport 4x4") is DrivetrainSignal.FOUR_WD

    def test_drivetrain_is_unknown_far_more_often_than_not(self):
        assert parse_drivetrain("Sport SUV 4D") is DrivetrainSignal.UNKNOWN
        assert parse_drivetrain(None) is DrivetrainSignal.UNKNOWN

    def test_transmission_is_absent_from_real_comp_text(self):
        # 0% of captured comps carry a transmission. The real source is VIN
        # decode, which spec 13 sequences at step 6 -- after this one.
        for text in ["Touring Sport Utility 4D", "Grand Touring AWD", "Sport SUV 4D"]:
            assert parse_transmission(text) is None

    def test_drivetrain_never_excludes_a_comp(self):
        # The user asked for a hard drivetrain filter; the spec (4.3) asks for a
        # confidence penalty instead, because the field is 7% populated.
        awd = comp(source_listing_id="a", trim_text="Touring AWD", mileage=110_000)
        fwd = comp(source_listing_id="b", trim_text="Touring FWD", mileage=95_000)
        result = filter_comps(TARGET, [awd, fwd])
        assert len(result.included) == 2

    def test_dealer_filtering_is_reported_unavailable_not_clean(self):
        result = filter_comps(TARGET, [comp()])
        assert result.dealer_filtering is DealerSignal.UNAVAILABLE


class TestIdentityExclusion:
    def test_target_is_not_its_own_comp_under_a_different_listing_id(self):
        # Real defect: capture 2's target (2014 CX-9, $5,500, 183,745 mi,
        # Jackson MO) came back as two of its own comps under different listing
        # ids. The extension's id-based filter could not see it. Left in, the
        # residual is pinned toward zero by the car itself.
        target = comp(source_listing_id="1479107233432192", year=2014, model="CX-9",
                      mileage=183_745, price_cents=550_000, location_text="Jackson, MO")
        twin = comp(source_listing_id="1036449108716104", year=2014, model="CX-9",
                    mileage=183_000, price_cents=550_000, location_text="Jackson, MO")
        result = filter_comps(target, [twin])
        assert result.included == []
        assert result.excluded[0].exclusion is Exclusion.SAME_VEHICLE_AS_TARGET

    def test_duplicate_comps_are_counted_once(self):
        # Real defect: capture 1 listed the same Arnold MO CX-5 twice, once as
        # "gt" and once as "grand touring awd -".
        a = comp(source_listing_id="a", trim_text="gt", price_cents=1_249_000, mileage=134_000)
        b = comp(source_listing_id="b", trim_text="grand touring awd -",
                 price_cents=1_249_000, mileage=134_000)
        result = filter_comps(TARGET, [a, b])
        assert len(result.included) == 1
        assert result.excluded[0].exclusion is Exclusion.DUPLICATE_OF_ANOTHER_COMP

    def test_relisting_key_is_preferred_over_the_local_key(self):
        a = comp(source_listing_id="a", relisting_key="shared")
        b = comp(source_listing_id="b", relisting_key="shared", mileage=90_000)
        result = filter_comps(TARGET, [a, b])
        assert len(result.included) == 1


class TestVehicleMatching:
    def test_a_different_model_is_not_a_comp(self):
        # The comp search returns them anyway: a CX-9 target came back with
        # CX-5, CX-3 and Mazda6 cards.
        result = filter_comps(TARGET, [comp(model="CX-9")])
        assert result.excluded[0].exclusion is Exclusion.DIFFERENT_MODEL

    def test_a_different_make_is_not_a_comp(self):
        result = filter_comps(TARGET, [comp(make="Toyota", model="CX-5")])
        assert result.excluded[0].exclusion is Exclusion.DIFFERENT_MAKE

    def test_spelling_variants_of_the_same_model_are_comps(self):
        result = filter_comps(TARGET, [comp(source_listing_id="x", model="CX5")])
        assert len(result.included) == 1

    @pytest.mark.parametrize("year,included", [(2014, True), (2018, True), (2013, False)])
    def test_year_window(self, year, included):
        result = filter_comps(TARGET, [comp(source_listing_id="x", year=year)])
        assert bool(result.included) is included

    def test_missing_model_excludes_because_it_cannot_be_verified(self):
        result = filter_comps(TARGET, [comp(model=None)])
        assert result.excluded[0].exclusion is Exclusion.MODEL_UNKNOWN

    def test_missing_year_excludes(self):
        result = filter_comps(TARGET, [comp(year=None)])
        assert result.excluded[0].exclusion is Exclusion.YEAR_UNKNOWN


class TestPriceSanity:
    def test_junk_prices_are_dropped(self):
        # Captured data has a $25 "Protege speed" and a $180 row with no make.
        result = filter_comps(TARGET, [comp(source_listing_id="x", price_cents=2_500)])
        assert result.excluded[0].exclusion is Exclusion.PRICE_IMPLAUSIBLE

    def test_a_price_far_below_the_set_median_is_dropped(self):
        # Mileages and prices are spaced so these read as five distinct cars,
        # rather than being deduped against each other or against the target.
        good = [
            comp(source_listing_id=str(i), price_cents=1_200_000, mileage=90_000 + i * 11_000)
            for i in range(5)
        ]
        junk = comp(source_listing_id="junk", price_cents=60_000, mileage=101_000)
        result = filter_comps(TARGET, [*good, junk])
        assert len(result.included) == 5
        assert junk.source_listing_id in {
            d.candidate.source_listing_id for d in result.excluded
        }

    def test_missing_price_excludes_it_is_the_dependent_variable(self):
        result = filter_comps(TARGET, [comp(price_cents=None)])
        assert result.excluded[0].exclusion is Exclusion.PRICE_MISSING


class TestMissingFieldPolicy:
    def test_no_mileage_is_included_but_kept_out_of_the_fit(self):
        # Documented choice: a comp without mileage cannot sit on the x axis,
        # but it is still evidence the market is thick, so it is not discarded.
        result = filter_comps(TARGET, [comp(source_listing_id="x", mileage=None)])
        decision = result.included[0]
        assert decision.included is True
        assert decision.mileage_unknown is True
        assert decision.usable_in_fit is False
        assert result.fit_points == []

    def test_no_trim_is_included_and_flagged_unknown(self):
        # 21% of captured comps have no trim string. Excluding on trim would
        # empty the comp set.
        result = filter_comps(TARGET, [comp(source_listing_id="x", trim_text=None)])
        assert result.included[0].trim_matches is None

    def test_trim_mismatch_never_excludes(self):
        result = filter_comps(TARGET, [comp(source_listing_id="x", trim_text="Grand Touring")])
        assert len(result.included) == 1
        assert result.included[0].trim_matches is False

    def test_trim_coverage_and_agreement_are_reported(self):
        comps = [
            comp(source_listing_id="a", trim_text="Touring", mileage=100_000),
            comp(source_listing_id="b", trim_text="Grand Touring", mileage=90_000),
            comp(source_listing_id="c", trim_text=None, mileage=80_000),
        ]
        result = filter_comps(TARGET, comps)
        # Two of three comps have a comparable trim...
        assert result.trim_coverage == pytest.approx(2 / 3)
        # ...and only one of those two is the target's "Touring". "Grand
        # Touring" is a different and materially more expensive trim.
        assert result.trim_agreement == pytest.approx(0.5)

    def test_implausible_mileage_is_dropped(self):
        result = filter_comps(TARGET, [comp(source_listing_id="x", mileage=9_000_000)])
        assert result.excluded[0].exclusion is Exclusion.MILEAGE_IMPLAUSIBLE


class TestExplainability:
    def test_every_candidate_gets_a_decision(self):
        candidates = [comp(source_listing_id=str(i), year=2010 + i) for i in range(8)]
        result = filter_comps(TARGET, candidates)
        assert len(result.decisions) == len(candidates)

    def test_every_exclusion_carries_a_reason(self):
        candidates = [comp(source_listing_id="a", model="CX-9"), comp(source_listing_id="b")]
        result = filter_comps(TARGET, candidates)
        for decision in result.excluded:
            assert decision.exclusion is not None
            assert decision.reason()

    def test_exclusion_counts_are_aggregated(self):
        candidates = [
            comp(source_listing_id="a", model="CX-9"),
            comp(source_listing_id="b", model="CX-3"),
            comp(source_listing_id="c", year=2001),
        ]
        counts = filter_comps(TARGET, candidates).exclusion_counts()
        assert counts["different_model"] == 2
        assert counts["year_out_of_window"] == 1


class TestNonVehicleListings:
    """A Marketplace vehicle search returns parts, and they parse as cars."""

    @pytest.mark.parametrize(
        "title",
        [
            "double din dash kit 2002 Mazda protege speed or Mazda protege",
            '9" Android Touchscreen Car Radio for Mazda CX-5 (2013-2016) - Brand New',
            "Set of 4 wheels and tires for Mazda CX-5",
            "2016 Mazda CX-5 parts only, no title",
            "Rear bumper for 2016 Mazda CX-5",
        ],
    )
    def test_parts_and_accessories_are_excluded(self, title):
        result = filter_comps(
            TARGET, [comp(source_listing_id="p", mileage=95_000, title=title)]
        )
        assert result.excluded[0].exclusion is Exclusion.NOT_A_VEHICLE

    @pytest.mark.parametrize(
        "title",
        [
            "2016 Mazda CX-5 · Grand Touring Sport Utility 4D",
            "2016 Mazda CX-5 Touring 🤘 174160 Miles",
            "2013 Mazda CX5 - GREAT CAR, GREAT FUEL SAVINGS",
            "2016 Mazda CX-5 great for a family, new tires fitted last year",
        ],
    )
    def test_real_vehicle_listings_survive(self, title):
        # Excluding a real car costs as much as letting a part through, given
        # how thin the comp set already is.
        result = filter_comps(
            TARGET, [comp(source_listing_id="v", mileage=95_000, title=title)]
        )
        assert len(result.included) == 1

    def test_a_priced_up_part_would_otherwise_pass_every_check(self):
        # The point of the rule: the price floor only caught the $25 version.
        part = comp(
            source_listing_id="p",
            mileage=95_000,
            price_cents=30_000_0,  # $300, comfortably above the floor
            title="double din dash kit 2002 Mazda protege",
        )
        assert filter_comps(TARGET, [part]).included == []

    def test_a_missing_title_does_not_exclude(self):
        # Comps captured before the title was retained must not all vanish.
        result = filter_comps(
            TARGET, [comp(source_listing_id="v", mileage=95_000, title=None)]
        )
        assert len(result.included) == 1

    def test_a_trailing_part_noun_is_left_to_the_price_filter(self):
        # KNOWN GAP, deliberately not closed at the title level. "2016 Mazda
        # CX-5 rear bumper cover" (a part) and "2016 Mazda CX-5, new bumper"
        # (a car) are not separable from the title alone, and guessing would
        # start dropping real comps from an already thin set.
        #
        # In practice the relative price floor catches it: a bumper priced at a
        # small fraction of the comp median is filtered as implausible. That is
        # a weaker guarantee than the title rule, and it is the reason this is
        # recorded as a gap rather than a pass.
        others = [
            comp(source_listing_id=str(i), mileage=90_000 + i * 11_000, price_cents=1_200_000)
            for i in range(5)
        ]
        bumper = comp(
            source_listing_id="b",
            mileage=95_000,
            price_cents=15_000,
            title="2016 Mazda CX-5 rear bumper cover",
        )
        result = filter_comps(TARGET, [*others, bumper])
        assert bumper.source_listing_id in {
            d.candidate.source_listing_id for d in result.excluded
        }
