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
    TrimMatch,
    grade_trim,
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


class TestEngineDisplacementSurvivesNormalisation:
    """The regression that made 2.0T and 3.0T the same trim.

    Flattening every non-alphanumeric split "2.0t" into "2" and "0t", and the
    bare "2" was then dropped as a number -- so every Audi and Subaru
    displacement trim collapsed onto the single token "0t", which was the 15th
    most common token across the stored trim strings.
    """

    def test_different_displacements_are_different_trims(self):
        assert not trims_agree(trim_tokens("2.0T Premium Plus"), trim_tokens("3.0T Premium Plus"))

    def test_the_displacement_survives_as_one_token(self):
        assert trim_tokens("2.0T Premium Plus Sport Utility 4D") == frozenset(
            {"2.0t", "premium", "plus"}
        )

    def test_the_collapsed_token_is_gone(self):
        assert "0t" not in trim_tokens("2.0T Premium")

    def test_bare_integers_are_still_dropped(self):
        # Body-style leftovers, bed lengths and stock numbers, not trim levels.
        assert trim_tokens("Sport 4D") == frozenset({"sport"})


class TestListingNoiseIsNotTrim:
    """Trim is the leftover remainder of a title split, so it carries whatever
    the seller wrote. Every string below is a real stored value."""

    def test_mileage_claims_are_stripped(self):
        lt = trim_tokens("LT")
        assert trims_agree(trim_tokens("LT \U0001f918 74173 Miles"), lt)
        assert trims_agree(trim_tokens("Lt - 66k Miles"), lt)

    def test_emoji_is_stripped(self):
        assert trims_agree(trim_tokens("Sport \U0001f525"), trim_tokens("Sport"))

    def test_dealer_stock_numbers_are_stripped(self):
        assert trims_agree(trim_tokens("GLI Autobahn - 515266A"), trim_tokens("GLI Autobahn"))

    def test_an_option_package_is_not_a_different_trim(self):
        # "EX-L w/Honda Sensing" is an EX-L. Treating the package as part of the
        # trim level splits one trim into two.
        assert trims_agree(
            trim_tokens("EX-L w/Honda Sensing Sport Utility 4D"), trim_tokens("EX-L")
        )

    def test_location_bleed_is_stripped(self):
        assert trims_agree(
            trim_tokens("EX-L 4D Passenger Van FWD in Chesterfield MO 142150 Miles"),
            trim_tokens("EX-L"),
        )

    def test_body_style_differences_do_not_split_a_trim(self):
        assert trims_agree(trim_tokens("EX-L Sedan 4D"), trim_tokens("EX-L Minivan 4D"))
        assert trims_agree(trim_tokens("1500 LT Pickup 4D 5 3/4 ft"), trim_tokens("LT"))

    def test_drivetrain_does_not_split_a_trim(self):
        # Drivetrain is parsed separately (`parse_drivetrain`) and recorded as
        # its own signal, so leaving it in the trim comparison would count one
        # signal twice and report a false mismatch on most listings.
        assert trims_agree(trim_tokens("Grand Touring AWD"), trim_tokens("Grand Touring"))
        assert trims_agree(trim_tokens("Sport 4x4"), trim_tokens("Sport"))

    def test_quattro_is_kept_because_it_is_branding_not_drivetrain(self):
        assert "quattro" in trim_tokens("2.0 TFSI quattro Premium")

    def test_pure_noise_normalises_to_nothing(self):
        # Which `filter_comps` reads as "not comparable" rather than as a match.
        assert trim_tokens("Sport Utility 4D") == frozenset()
        assert trim_tokens("Sedan 4D") == frozenset()


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
        # No candidate states a seller type -- every observation captured before
        # the payload keys were fixed. "We could not check" must not read as
        # "we checked and found none".
        result = filter_comps(TARGET, [comp()])
        assert result.dealer_filtering is DealerSignal.UNAVAILABLE


class TestDealerExclusion:
    """Spec 4.3's dealer exclusion, once `vehicle_seller_type` is captured."""

    def test_a_dealer_listing_is_excluded(self):
        dealer = comp(source_listing_id="d", seller_type="DEALER", mileage=110_000)
        result = filter_comps(TARGET, [dealer])
        assert result.included == []
        assert result.excluded[0].exclusion is Exclusion.DEALER_LISTING

    def test_a_private_seller_is_kept(self):
        private = comp(source_listing_id="p", seller_type="PRIVATE_SELLER", mileage=110_000)
        result = filter_comps(TARGET, [private])
        assert len(result.included) == 1

    def test_filtering_is_reported_applied_once_any_candidate_states_a_type(self):
        result = filter_comps(
            TARGET, [comp(source_listing_id="p", seller_type="PRIVATE_SELLER")]
        )
        assert result.dealer_filtering is DealerSignal.APPLIED

    def test_an_unstated_seller_type_never_excludes(self):
        # Three-valued on purpose: absent is not "not a dealer", and it is also
        # not grounds to drop the comp. Every pre-fix row is in this state.
        result = filter_comps(TARGET, [comp(source_listing_id="u", seller_type=None)])
        assert len(result.included) == 1
        assert result.dealer_filtering is DealerSignal.UNAVAILABLE

    def test_the_classification_is_case_and_space_insensitive(self):
        result = filter_comps(TARGET, [comp(source_listing_id="d", seller_type=" dealer ")])
        assert result.excluded[0].exclusion is Exclusion.DEALER_LISTING


class TestGradedTrimMatching:
    """`trim_match` says WHICH part of a trim differs; `trim_matches` cannot."""

    def test_identical_trims_are_exact(self):
        assert grade_trim("Touring Sport Utility 4D", "Touring Sport Utility 4D") is TrimMatch.EXACT

    def test_body_style_written_by_only_one_side_is_still_exact(self):
        # A comp card that omits the body style is not evidence of a different
        # body. Demoting these would put most cards in TRIM_ONLY for saying
        # nothing at all.
        assert grade_trim("Touring", "Touring Sport Utility 4D") is TrimMatch.EXACT

    def test_same_trim_level_different_body_is_trim_only(self):
        assert grade_trim("EX-L Hatchback 4D", "EX-L Sedan 4D") is TrimMatch.TRIM_ONLY

    def test_an_engine_designator_alone_does_not_break_the_match(self):
        # The case `trims_agree` gets wrong: 28 such pairs on one model in
        # captured data, reported as different trims on a displacement prefix.
        assert grade_trim("Premium Sport Utility 4D", "2.0i Premium Sport Utility 4D") is (
            TrimMatch.EXACT
        )
        assert not trims_agree(
            trim_tokens("Premium Sport Utility 4D"),
            trim_tokens("2.0i Premium Sport Utility 4D"),
        )

    def test_a_real_trim_difference_still_differs(self):
        assert grade_trim("Touring", "Grand Touring") is TrimMatch.DIFFERS
        assert grade_trim("DX Sedan 4D", "LX Sedan 4D") is TrimMatch.DIFFERS
        assert grade_trim("EX Sedan 4D", "EX-L Sedan 4D") is TrimMatch.DIFFERS

    def test_word_order_does_not_cause_a_false_mismatch(self):
        # trim_level is stored as an ordered join for readability, but two
        # sellers typing the same trim in a different order must not read as
        # different vehicles -- that would make this signal LESS tolerant than
        # `trim_tokens`, which already ignores order for the boolean.
        assert grade_trim("S Carbon Edition Sport Utility 4D", "Carbon Edition S SUV 4D") is (
            TrimMatch.EXACT
        )

    def test_word_order_tolerance_does_not_hide_a_missing_word(self):
        # A same-BAG-of-words check must still catch a genuinely different
        # (shorter or longer) trim, not just a reordered one.
        assert grade_trim("Grand Touring", "Touring") is TrimMatch.DIFFERS

    @pytest.mark.parametrize(
        ("target_trim", "comp_trim"),
        [(None, "Touring"), ("Touring", None), (None, None), ("Sedan 4D", "Touring")],
    )
    def test_unknown_when_either_side_states_no_trim_level(self, target_trim, comp_trim):
        # Same guard as `trims_agree`: assuming an unstated trim means "base"
        # collapsed the agreement ratio on nearly every evaluation.
        assert grade_trim(target_trim, comp_trim) is TrimMatch.UNKNOWN

    def test_the_boolean_is_left_untouched_by_the_graded_signal(self):
        # `backtest.py`'s strata and the confidence model read `trim_matches`,
        # and `params.py` forbids moving a calibrated threshold without a
        # calibration run. The graded value is additional, never a replacement.
        result = filter_comps(
            TARGET, [comp(source_listing_id="c", trim_text="Touring", mileage=110_000)]
        )
        decision = result.included[0]
        assert decision.trim_matches is True
        assert decision.trim_match is TrimMatch.EXACT

    def test_counts_are_reportable(self):
        result = filter_comps(
            TARGET,
            [
                comp(source_listing_id="a", trim_text="Touring", mileage=110_000),
                comp(source_listing_id="b", trim_text="Grand Touring", mileage=95_000),
            ],
        )
        counts = result.trim_match_counts()
        assert counts.get(TrimMatch.EXACT.value) == 1
        assert counts.get(TrimMatch.DIFFERS.value) == 1


class TestIdentityExclusion:
    def test_target_is_not_its_own_comp_under_a_different_listing_id(self):
        # Real defect: capture 2's target (2014 CX-9, $5,500, 183,745 mi,
        # Jackson MO) came back as two of its own comps under different listing
        # ids. The extension's id-based filter could not see it. Left in, the
        # residual is pinned toward zero by the car itself.
        target = comp(
            source_listing_id="1479107233432192",
            year=2014,
            model="CX-9",
            mileage=183_745,
            price_cents=550_000,
            location_text="Jackson, MO",
        )
        twin = comp(
            source_listing_id="1036449108716104",
            year=2014,
            model="CX-9",
            mileage=183_000,
            price_cents=550_000,
            location_text="Jackson, MO",
        )
        result = filter_comps(target, [twin])
        assert result.included == []
        assert result.excluded[0].exclusion is Exclusion.SAME_VEHICLE_AS_TARGET

    def test_duplicate_comps_are_counted_once(self):
        # Real defect: capture 1 listed the same Arnold MO CX-5 twice, once as
        # "gt" and once as "grand touring awd -".
        a = comp(source_listing_id="a", trim_text="gt", price_cents=1_249_000, mileage=134_000)
        b = comp(
            source_listing_id="b",
            trim_text="grand touring awd -",
            price_cents=1_249_000,
            mileage=134_000,
        )
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
        # empty the comp set. An unstated trim on either side (target or comp)
        # is not evidence of anything, so it stays an honest "not comparable"
        # rather than being counted as a confirmed mismatch.
        result = filter_comps(TARGET, [comp(source_listing_id="x", trim_text=None)])
        assert result.included[0].trim_matches is None

    def test_trim_mismatch_never_excludes(self):
        result = filter_comps(TARGET, [comp(source_listing_id="x", trim_text="Grand Touring")])
        assert len(result.included) == 1
        assert result.included[0].trim_matches is False

    def test_target_with_no_trim_is_not_comparable_either(self):
        # Regression test: this used to assume the target was "base" when its
        # trim was unstated, which meant a comp with a real trim ("SE") read
        # as a confirmed mismatch even though nothing about the target's
        # actual trim was known. That fired "most comparable listings look
        # like a different trim" on nearly every evaluation whose target
        # didn't name a trim -- disproportionately base-trim cars, since those
        # are exactly the listings least likely to name one. An unstated
        # target trim is now as uncomparable as an unstated comp trim: both
        # sides must state a real trim before `trims_agree` runs at all.
        target = comp(source_listing_id="target", trim_text=None, mileage=137_000, price_cents=1_050_000)
        result = filter_comps(target, [comp(source_listing_id="x", trim_text="SE")])
        assert result.included[0].trim_matches is None
        assert result.trim_coverage == 0.0

    def test_trim_coverage_and_agreement_are_reported(self):
        comps = [
            comp(source_listing_id="a", trim_text="Touring", mileage=100_000),
            comp(source_listing_id="b", trim_text="Grand Touring", mileage=90_000),
            comp(source_listing_id="c", trim_text=None, mileage=80_000),
        ]
        result = filter_comps(TARGET, comps)
        # Two of three comps have a comparable trim; "c" stays uncounted --
        # its unstated trim is not turned into a confirmed mismatch against
        # the target's stated "Touring".
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


class TestFinancingLanguage:
    """Spec 9's ground-truth pass: a captured Maserati comp priced its `price_cents`
    off a "$4,000" figure that was actually a down payment, not an ask. The real
    example carried the marker in `trim_text`, not `title` -- '!!DOWN PAYMENT!!'
    was the whole of what the extractor recovered as trim.
    """

    @pytest.mark.parametrize(
        "trim_text",
        [
            "!!DOWN PAYMENT!!",
            "$800 down with soso credit!",
            "3 BASE $3000 DOWN PAYMENT",
            "$299/mo financing available",
            "no credit check, bad credit ok",
        ],
    )
    def test_financing_language_in_trim_text_is_excluded(self, trim_text):
        result = filter_comps(
            TARGET, [comp(source_listing_id="f", mileage=95_000, trim_text=trim_text)]
        )
        assert result.excluded[0].exclusion is Exclusion.NOT_AN_ASKING_PRICE

    def test_financing_language_in_title_is_excluded(self):
        result = filter_comps(
            TARGET,
            [comp(source_listing_id="f", mileage=95_000, title="2014 Maserati $500 down!")],
        )
        assert result.excluded[0].exclusion is Exclusion.NOT_AN_ASKING_PRICE

    @pytest.mark.parametrize(
        "trim_text",
        ["Grand Touring", "S Q4 Sedan 4D", "Touring 4D, moving must sell", None],
    )
    def test_ordinary_trim_text_survives(self, trim_text):
        result = filter_comps(
            TARGET, [comp(source_listing_id="v", mileage=95_000, trim_text=trim_text)]
        )
        assert len(result.included) == 1


class TestProgressiveYearWidening:
    """Spec 4.3: "fall back progressively (widen radius, then year range) and
    report low confidence explicitly"."""

    def _spread(self, base_year: int, n: int, offsets: list[int]) -> list[CompCandidate]:
        return [
            comp(
                source_listing_id=f"y{i}",
                year=base_year + off,
                mileage=90_000 + i * 7_000,
                price_cents=1_200_000,
            )
            for i, off in enumerate(offsets)
        ]

    def test_a_thick_set_never_widens(self):
        from app.pricing.model import assess_listing

        comps = self._spread(2016, 10, [0, 1, -1, 2, -2, 0, 1, -1, 2, -2])
        result = assess_listing(TARGET, comps)
        assert result.comp_set.year_window == 2
        assert not result.comp_set.year_window_widened

    def test_a_thin_set_widens_until_the_floor_is_met(self):
        from app.pricing.model import assess_listing

        # Four inside +/-2, four more at +/-3.
        comps = self._spread(2016, 8, [0, 1, -1, 2, 3, -3, 3, -3])
        result = assess_listing(TARGET, comps)
        assert result.comp_set.year_window_widened
        assert len(result.comp_set.included) >= 8

    def test_it_stops_at_the_smallest_adequate_window(self):
        from app.pricing.model import assess_listing

        # Enough at +/-3, so +/-4 must not be reached: every step trades comp
        # quality for comp count.
        comps = self._spread(2016, 9, [0, 1, -1, 2, -2, 3, -3, 3, -3])
        result = assess_listing(TARGET, comps)
        assert result.comp_set.year_window == 3

    def test_widening_lowers_confidence(self):
        # The "report low confidence explicitly" half of the instruction.
        from app.pricing.confidence import Limiter
        from app.pricing.model import assess_listing

        comps = self._spread(2016, 8, [0, 1, -1, 2, 3, -3, 3, -3])
        result = assess_listing(TARGET, comps)
        assert Limiter.WIDENED_YEAR_WINDOW in result.confidence.limiters

    def test_an_unwidened_set_is_not_penalised(self):
        from app.pricing.confidence import Limiter
        from app.pricing.model import assess_listing

        comps = self._spread(2016, 10, [0, 1, -1, 2, -2, 0, 1, -1, 2, -2])
        result = assess_listing(TARGET, comps)
        assert Limiter.WIDENED_YEAR_WINDOW not in result.confidence.limiters

    def test_the_widest_result_is_kept_when_no_window_reaches_the_floor(self):
        # A genuinely rare car. More points still make the fit steadier: six
        # comps support a mileage slope where four cannot.
        from app.pricing.model import assess_listing

        comps = self._spread(2016, 5, [0, 3, -3, 4, -4])
        result = assess_listing(TARGET, comps)
        assert result.comp_set.year_window == 4
        assert len(result.comp_set.included) == 5

    def test_the_ladder_never_narrows_below_the_caller_default(self):
        from app.pricing.model import assess_listing

        comps = self._spread(2016, 3, [0, 1, -1])
        result = assess_listing(TARGET, comps, year_window=4)
        assert result.comp_set.year_window >= 4


class TestPreferredFitPoints:
    """`CompSet.preferred_fit_points` -- spec 4.3's comp-similarity principle
    applied to which points a fit uses, not just which comps are kept."""

    def _comp_set(self, matching: int, differing: int, unknown: int = 0):
        # Mileage spread by 20k (crosses the 10k dedup bucket every time) and
        # price varied per comp, so none of these collide as the same vehicle.
        comps = (
            [
                comp(
                    source_listing_id=f"m{i}",
                    trim_text="Touring",
                    mileage=40_000 + i * 20_000,
                    price_cents=1_100_000 - i * 3_000,
                )
                for i in range(matching)
            ]
            + [
                comp(
                    source_listing_id=f"d{i}",
                    trim_text="Sport",
                    mileage=41_000 + i * 20_000,
                    price_cents=1_150_000 - i * 3_000,
                )
                for i in range(differing)
            ]
            + [
                comp(
                    source_listing_id=f"u{i}",
                    trim_text=None,
                    mileage=42_000 + i * 20_000,
                    price_cents=1_050_000 - i * 3_000,
                )
                for i in range(unknown)
            ]
        )
        return filter_comps(TARGET, comps)

    def test_restricts_when_enough_trim_matched_comps_exist(self):
        cs = self._comp_set(matching=6, differing=4)
        points, restricted = cs.preferred_fit_points(min_points=6)
        assert restricted
        assert len(points) == 6
        assert all(d.trim_matches is True for d in points)

    def test_falls_back_to_the_full_set_when_trim_matched_comps_are_too_few(self):
        cs = self._comp_set(matching=3, differing=7)
        points, restricted = cs.preferred_fit_points(min_points=6)
        assert not restricted
        assert points == cs.fit_points

    def test_trim_unknown_comps_are_never_in_the_restricted_subset(self):
        # Unknown is not a match: spec 4.3 costs confidence on an unclear trim
        # rather than assuming it agrees.
        cs = self._comp_set(matching=6, differing=0, unknown=4)
        points, restricted = cs.preferred_fit_points(min_points=6)
        assert restricted
        assert len(points) == 6
