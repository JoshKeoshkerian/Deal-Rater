"""Rise-plateau-decline curve and confidence (spec 2).

The two things spec 2 requires structurally, and which these tests exist to
prevent regressing:

  1. The curve is NOT monotonic. A bigger discount does not mean a better deal
     past a point, because the cheapest listings are disproportionately the
     worst cars.
  2. The adverse-selection penalty lands on CONFIDENCE, not on the rating.
     Collapsing them would conflate "cheap" with "risky", which spec 2 forbids.
"""

from __future__ import annotations

import pytest

from app.pricing import params
from app.pricing.comps import CompCandidate, filter_comps
from app.pricing.confidence import Confidence, Limiter, assess_confidence
from app.pricing.curve import (
    is_calibrated,
    negotiation_anchors,
    rate_price_residual,
    resolvable_residual,
    should_publish_anchors,
    suggested_offer_cents,
)
from app.pricing.model import assess_listing
from app.pricing.regression import estimate_expected_asking_price


class TestCurveShape:
    def test_the_curve_is_not_monotonic_in_discount(self):
        # THE central claim of spec 2. A linear "cheaper is better" score would
        # make this test fail, which is the point of having it.
        modest = rate_price_residual(-0.15).rating
        extreme = rate_price_residual(-0.60).rating
        assert extreme < modest

    def test_a_genuine_discount_beats_a_fair_price(self):
        assert rate_price_residual(-0.12).rating > rate_price_residual(0.0).rating

    def test_a_fair_price_beats_an_overpriced_one(self):
        assert rate_price_residual(0.0).rating > rate_price_residual(0.25).rating

    def test_the_plateau_is_flat(self):
        # Within the plateau, more discount is not more deal.
        a = rate_price_residual(params.PLATEAU_START).rating
        b = rate_price_residual(params.PLATEAU_END).rating
        mid = rate_price_residual((params.PLATEAU_START + params.PLATEAU_END) / 2).rating
        assert a == b == mid

    def test_the_decline_segment_falls_as_the_discount_deepens(self):
        assert (
            rate_price_residual(-0.25).rating
            > rate_price_residual(-0.35).rating
            > rate_price_residual(-0.44).rating
        )

    def test_the_rating_bottoms_out_rather_than_falling_forever(self):
        # How wrong an implausibly cheap listing is becomes a RISK question,
        # which the pricing dimension is not equipped to answer.
        assert rate_price_residual(-0.60).rating == rate_price_residual(-0.95).rating

    @pytest.mark.parametrize(
        "residual,band",
        [
            (-0.70, "implausible_discount"),
            (-0.30, "declining"),
            (-0.15, "plateau"),
            (0.0, "fair"),
            (0.20, "overpriced"),
        ],
    )
    def test_bands(self, residual, band):
        assert rate_price_residual(residual).band == band

    def test_ratings_stay_in_range(self):
        for i in range(-100, 101):
            assert 0.0 <= rate_price_residual(i / 100).rating <= 100.0

    def test_the_curve_reports_itself_uncalibrated(self):
        # Spec 15 lists the breakpoints as an open question and spec 9.4 assigns
        # them to a calibration pass that has not run.
        assert is_calibrated() is False
        assert rate_price_residual(-0.12).calibrated is False


class TestSeparationOfPriceAndConfidence:
    """Spec 2: price and risk are different questions and must not be collapsed."""

    def test_an_extreme_discount_flags_itself_without_zeroing_the_rating(self):
        rating = rate_price_residual(-0.55)
        assert rating.implausible_discount is True
        # Suspicion is expressed as confidence and a flag, not as a price of zero.
        assert rating.rating > 0

    def test_adverse_selection_lands_on_confidence(self):
        comps = [
            CompCandidate(
                listing_id=i,
                source_listing_id=f"c{i}",
                year=2016,
                make="Mazda",
                model="CX-5",
                trim_text="Touring",
                price_cents=1_200_000,
                mileage=90_000 + i * 9_000,
                location_text=f"City{i}, MO",
            )
            for i in range(10)
        ]
        target = CompCandidate(
            listing_id=99,
            source_listing_id="t",
            year=2016,
            make="Mazda",
            model="CX-5",
            trim_text="Touring",
            price_cents=500_000,  # ~58% below the comps
            mileage=120_000,
            location_text="St Louis, MO",
        )
        comp_set = filter_comps(target, comps)
        estimate = estimate_expected_asking_price(comp_set)
        confidence = assess_confidence(comp_set, estimate, target.price_cents)
        assert Limiter.ADVERSE_SELECTION in confidence.limiters


class TestConfidenceLimiters:
    def _comps(self, n: int, **kw) -> list[CompCandidate]:
        base = dict(year=2016, make="Mazda", model="CX-5", trim_text="Touring")
        base.update(kw)
        return [
            CompCandidate(
                listing_id=i,
                source_listing_id=f"c{i}",
                price_cents=1_200_000 - i * 20_000,
                mileage=80_000 + i * 9_000,
                location_text=f"City{i}, MO",
                **base,  # type: ignore[arg-type]
            )
            for i in range(n)
        ]

    def _target(self, **kw) -> CompCandidate:
        base = dict(
            listing_id=99,
            source_listing_id="t",
            year=2016,
            make="Mazda",
            model="CX-5",
            trim_text="Touring",
            price_cents=1_150_000,
            mileage=115_000,
            location_text="St Louis, MO",
        )
        base.update(kw)
        return CompCandidate(**base)  # type: ignore[arg-type]

    def test_structural_gaps_are_always_reported(self):
        # Dealer filtering and recency weighting have no data at step 3, and
        # both bias the expected asking price upward. They are named on every
        # evaluation rather than silently omitted.
        a = assess_listing(self._target(), self._comps(12))
        assert Limiter.DEALER_FILTERING_UNAVAILABLE in a.confidence.limiters
        assert Limiter.NO_RECENCY_WEIGHTING in a.confidence.limiters

    def test_a_thin_comp_set_is_low_confidence(self):
        a = assess_listing(self._target(), self._comps(4))
        assert a.confidence.level is Confidence.LOW
        assert Limiter.COMP_COUNT in a.confidence.limiters

    def test_no_estimate_means_no_confidence(self):
        a = assess_listing(self._target(), self._comps(2))
        assert a.confidence.level is Confidence.NONE
        assert Limiter.NO_ESTIMATE in a.confidence.limiters

    def test_comps_from_the_wrong_metro_are_disqualifying(self):
        # Real defect: a Nashville listing was benchmarked against St. Louis
        # comps 300 miles away. That is not weak evidence, it is evidence about
        # a different market.
        a = assess_listing(self._target(), self._comps(20), location_scoped=False)
        assert a.confidence.level is Confidence.LOW
        assert Limiter.WRONG_MARKET in a.confidence.limiters

    def test_unstated_trim_on_both_sides_stays_an_honest_unknown(self):
        # When neither side says anything, there is genuinely nothing to
        # compare -- asserting a match (or a mismatch) neither side gave any
        # information for would be overclaiming.
        a = assess_listing(self._target(trim_text=None), self._comps(12, trim_text=None))
        assert Limiter.TRIM_UNKNOWN in a.confidence.limiters
        assert Limiter.TRIM_DISAGREEMENT not in a.confidence.limiters
        assert a.estimate.n_included == 12

    def test_unstated_target_trim_does_not_manufacture_disagreement(self):
        # Regression test for the bug this replaced: the target's unstated
        # trim used to be assumed "base", which a comp with a real, stated
        # trim could never actually match (nobody types the literal word
        # "base" either) -- so this used to fire TRIM_DISAGREEMENT on nearly
        # every listing whose own trim wasn't captured, independent of
        # whether a real mismatch existed. An unstated TARGET trim is now as
        # uncomparable as an unstated comp trim: this is TRIM_UNKNOWN, not
        # TRIM_DISAGREEMENT.
        a = assess_listing(self._target(trim_text=None), self._comps(12, trim_text="Grand Touring"))
        assert Limiter.TRIM_UNKNOWN in a.confidence.limiters
        assert Limiter.TRIM_DISAGREEMENT not in a.confidence.limiters
        assert a.estimate.n_included == 12

    def test_unknown_trim_costs_confidence_rather_than_comps(self):
        # Spec 4.3: "widen the interval and lower confidence rather than
        # pretending the comp set is clean." An unstated COMP trim is not
        # evidence it differs from the target's stated "Touring" -- it is
        # just missing, so this is confidence lost to uncertainty, not to a
        # disagreement that was never actually observed.
        a = assess_listing(self._target(), self._comps(12, trim_text=None))
        assert Limiter.TRIM_UNKNOWN in a.confidence.limiters
        assert Limiter.TRIM_DISAGREEMENT not in a.confidence.limiters
        assert a.estimate.n_included == 12

    def test_disagreeing_trim_costs_confidence_but_no_longer_disqualifies(self):
        # TRIM_DISAGREEMENT was disqualifying (forced LOW outright) until
        # measurement rejected it: across ~150 stored captures it fired on 83%
        # of them, because most vehicles genuinely have several trim levels and
        # a metro-wide comp pull rarely has a majority sharing the target's
        # exact one. Forcing LOW there made LOW the default regardless of comp
        # count or fit quality. It still counts as an ordinary limiter -- with
        # 12 comps this stays MEDIUM rather than reaching HIGH.
        a = assess_listing(self._target(), self._comps(12, trim_text="Grand Touring"))
        assert Limiter.TRIM_DISAGREEMENT in a.confidence.limiters
        assert a.confidence.level is Confidence.MEDIUM

    def test_a_thick_comp_set_is_capped_at_medium_not_forced_to_low(self):
        # The improvement this change is for: 15+ comps with trim disagreement
        # used to be indistinguishable from 3 comps with trim disagreement --
        # both forced to LOW. Now the comp count is allowed to matter: still
        # blocked from HIGH (trim disagreement is a real limiter, and HIGH
        # requires nothing wrong beyond the two structural gaps), but no
        # longer floored at LOW either.
        a = assess_listing(
            self._target(), self._comps(params.COMPS_FOR_HIGH_CONFIDENCE, trim_text="Grand Touring")
        )
        assert Limiter.TRIM_DISAGREEMENT in a.confidence.limiters
        assert a.confidence.level is Confidence.MEDIUM

    def test_extrapolating_past_the_comps_is_reported(self):
        a = assess_listing(self._target(mileage=400_000), self._comps(12))
        assert Limiter.MILEAGE_EXTRAPOLATION in a.confidence.limiters

    def test_confidence_never_changes_the_price(self):
        # The whole point of the separation: two comp sets that differ only in
        # what limits confidence must yield the same expected asking price.
        comps = self._comps(12)
        scoped = assess_listing(self._target(), comps, location_scoped=True)
        unscoped = assess_listing(self._target(), comps, location_scoped=False)
        assert scoped.confidence.level is not unscoped.confidence.level
        assert scoped.estimate.expected_asking_cents == unscoped.estimate.expected_asking_cents
        assert scoped.rating.rating == unscoped.rating.rating

    def test_every_limiter_has_explanatory_text(self):
        a = assess_listing(self._target(), self._comps(4))
        assert len(a.confidence.explain()) == len(a.confidence.limiters)
        assert all(text for text in a.confidence.explain())


class TestNegotiationAnchors:
    def test_anchors_bracket_the_expected_asking_price(self):
        anchors = negotiation_anchors(1_400_000, 1_380_000, 1_430_000)
        assert anchors["strong_offer_cents"] < 1_400_000 < anchors["walk_away_above_cents"]

    def test_anchors_are_withheld_when_the_range_is_too_wide(self):
        # Anchoring to the interval produced a "strong offer" of $3,944 against
        # an expected ask of $7,942 on real data. A number a buyer repeats to a
        # stranger is withheld rather than guessed.
        assert should_publish_anchors(794_200, 394_400, 1_194_000) is False

    def test_anchors_are_published_when_the_range_is_tight(self):
        assert should_publish_anchors(1_400_000, 1_380_000, 1_430_000) is True

    def test_no_anchors_without_an_estimate(self):
        assert should_publish_anchors(None, None, None) is False


class TestSuggestedOfferNeverExceedsTheAsk:
    """A car listed well below its expected asking price -- a branded title, say
    -- can put the model's own strong-offer anchor above the seller's actual ask.
    `strong_offer_cents` is allowed to sit there; it is a market benchmark. But
    the negotiation brief's "suggested offer" is advice to say to this specific
    seller, and no negotiating position ever justifies offering more than what
    they are already asking.
    """

    def test_caps_at_the_ask_when_the_anchor_sits_above_it(self):
        # Expected asking price far above a deeply-underpriced target: the model
        # anchor alone would suggest offering more than the ask.
        offer = suggested_offer_cents(strong_offer_cents=1_569_600, ask_cents=1_245_000, extra_discount=0.0)
        assert offer == 1_245_000

    def test_leverage_can_still_discount_below_the_ask(self):
        offer = suggested_offer_cents(strong_offer_cents=1_320_000, ask_cents=1_400_000, extra_discount=0.05)
        assert offer == 1_320_000 * 0.95

    def test_no_cap_applied_when_the_ask_is_unknown(self):
        offer = suggested_offer_cents(strong_offer_cents=1_320_000, ask_cents=None, extra_discount=0.0)
        assert offer == 1_320_000


class TestResolvableResidual:
    """Only the part of a price gap the comp set can tell apart from noise
    reaches the curve. Captured data had 51 of 111 evaluations rendering a
    verdict their own interval could not support -- a Tucson asking $8,000
    against a $3,521-$8,597 interval was rated 5/100 "asking above comparable
    listings".
    """

    def test_a_gap_smaller_than_the_margin_is_mostly_erased_but_not_flattened(self):
        # No longer a literal zero (see the docstring): a bounded tie-breaker
        # replaces the old flat floor so two different raw residuals under the
        # same margin don't collapse to an identical output. Still small --
        # under 7% of the raw gap survives here -- and still sign-preserving.
        assert resolvable_residual(0.32, 0.42) == pytest.approx(0.021768707, abs=1e-9)
        assert resolvable_residual(-0.32, 0.42) == pytest.approx(-0.021768707, abs=1e-9)

    def test_different_raw_gaps_under_the_same_margin_no_longer_tie(self):
        # THE regression test for the audit finding: 35% of rated listings on
        # real data shared an identical pricing sub-score because this
        # function flattened every fully-absorbed gap to the same 0.0.
        a = resolvable_residual(0.017, 0.088)
        b = resolvable_residual(-0.038, 0.098)
        assert a != 0.0
        assert b != 0.0
        assert a != b
        assert a > 0 > b

    def test_the_tiebreaker_never_escapes_the_fair_band_on_its_own(self):
        # Peaks at NOISE_FLOOR_TIEBREAKER_SCALE (ratio=0.5), which is chosen
        # below min(OVERPRICED_KNEE, abs(PLATEAU_START)) precisely so this
        # holds regardless of margin or raw residual, as long as the gap is
        # fully absorbed.
        for raw in (0.01, 0.05, 0.10, 0.30, 0.50, 0.90):
            for margin in (0.02, 0.10, 0.50, 1.0):
                if raw > margin:
                    continue
                scored = resolvable_residual(raw, margin)
                assert abs(scored) < min(params.OVERPRICED_KNEE, abs(params.PLATEAU_START))

    def test_a_gap_larger_than_the_margin_survives_reduced(self):
        assert resolvable_residual(0.32, 0.05) == pytest.approx(0.27)
        assert resolvable_residual(-0.60, 0.20) == pytest.approx(-0.40)

    def test_the_sign_is_always_preserved(self):
        # Erasing a discount into a premium would invert the verdict.
        assert resolvable_residual(-0.60, 0.20) < 0
        assert resolvable_residual(0.60, 0.20) > 0

    def test_no_margin_leaves_the_residual_untouched(self):
        for r in (-0.6, -0.1, 0.0, 0.1, 0.6):
            assert resolvable_residual(r, 0.0) == r

    def test_it_degrades_continuously_rather_than_at_a_cliff(self):
        # No single dollar of asking price may flip a verdict. The tie-breaker
        # bump is designed to vanish at exactly this boundary (ratio -> 1), so
        # both sides land near zero rather than jumping between 0 and a fixed
        # value.
        just_under = resolvable_residual(0.1999, 0.20)
        just_over = resolvable_residual(0.2001, 0.20)
        assert just_under == pytest.approx(0.0, abs=1e-4)
        assert just_over == pytest.approx(0.0001, abs=1e-9)
        assert abs(just_under) < abs(just_over) * 2


class TestRatingRespectsUncertainty:
    def test_an_uncertain_comp_set_cannot_call_a_listing_overpriced(self):
        confident = rate_price_residual(0.32, 0.05)
        uncertain = rate_price_residual(0.32, 0.42)
        assert confident.band == "overpriced"
        assert uncertain.band == "fair"
        assert uncertain.within_noise

    def test_a_confident_comp_set_keeps_its_verdict(self):
        # The adjustment must not neuter the product. A tight comp set is
        # exactly the case where a verdict is earned.
        rating = rate_price_residual(0.40, 0.03)
        assert rating.band == "overpriced"
        assert rating.rating < 30

    def test_a_genuine_bargain_survives_a_moderate_margin(self):
        rating = rate_price_residual(-0.30, 0.08)
        assert rating.band in ("plateau", "declining")
        assert not rating.within_noise

    def test_the_raw_gap_is_still_reported(self):
        # The user is shown what the listing actually asks relative to
        # expected; the adjustment governs the VERDICT, not the fact.
        rating = rate_price_residual(0.32, 0.42)
        assert rating.residual_fraction == pytest.approx(0.32)
        assert rating.scored_residual_fraction == pytest.approx(0.021768707, abs=1e-9)
        assert rating.uncertainty_margin == pytest.approx(0.42)

    def test_within_noise_says_so_in_the_label(self):
        rating = rate_price_residual(0.32, 0.42)
        assert "do not pin" in rating.label

    def test_a_genuinely_central_price_is_not_flagged_as_within_noise(self):
        # Landing near zero on a TIGHT comp set is a real finding ("priced
        # about right"), not an admission of ignorance, and the two must not
        # read the same.
        rating = rate_price_residual(0.0, 0.02)
        assert rating.band == "fair"
        assert not rating.within_noise
        assert "do not pin" not in rating.label

    def test_the_default_margin_preserves_the_bare_curve(self):
        for r in (-0.5, -0.3, -0.15, 0.0, 0.1, 0.4):
            assert rate_price_residual(r).band == rate_price_residual(r, 0.0).band

    def test_two_different_small_residuals_no_longer_earn_an_identical_rating(self):
        # The audit finding this whole change exists for: on real data, 35% of
        # rated listings shared the exact same pricing sub-score because any
        # raw residual smaller than its own margin flattened to 0.0. These two
        # inputs are drawn directly from that measurement (a +1.7% and a -3.8%
        # raw gap that both used to floor to identical zero).
        over = rate_price_residual(0.017, 0.088)
        under = rate_price_residual(-0.038, 0.098)
        assert over.rating != under.rating
        assert over.band == "fair"
        assert under.band == "fair"
        # Direction-appropriate: the one asking below expected should still
        # read as at least as good a deal as the one asking above.
        assert under.rating >= over.rating


class TestUncertaintyMarginIsTheMeanNotThePredictionInterval:
    """Which uncertainty feeds the verdict is the load-bearing choice here.

    The published interval says where ANOTHER listing would fall, and is wide
    partly because sellers of identical cars price them differently -- the very
    spread a deal rating exists to locate a listing within. Writing that off
    rated 86% of captured listings "fair". The verdict margin is instead how
    well the CENTRE of the market is known.
    """

    def _estimate(self):
        comps = [
            CompCandidate(
                listing_id=i,
                source_listing_id=f"c{i}",
                year=2016,
                make="Mazda",
                model="CX-5",
                trim_text="Touring",
                price_cents=(
                    int(2_000_000 - 8 * (60_000 + i * 12_000)) + (60_000 if i % 2 else -60_000)
                ),
                mileage=60_000 + i * 12_000,
                location_text=f"City{i}, MO",
            )
            for i in range(12)
        ]
        target = CompCandidate(
            listing_id=999,
            source_listing_id="target",
            year=2016,
            make="Mazda",
            model="CX-5",
            trim_text="Touring",
            price_cents=1_100_000,
            mileage=120_000,
            location_text="St Louis, MO",
        )
        return estimate_expected_asking_price(filter_comps(target, comps))

    def test_the_two_uncertainties_are_both_available_and_differ(self):
        est = self._estimate()
        assert est.interval_half_width_fraction is not None
        assert est.expected_uncertainty_fraction is not None
        assert est.expected_uncertainty_fraction < est.interval_half_width_fraction

    def test_the_median_fallback_also_reports_centre_uncertainty(self):
        # The location-only branch publishes a deliberately wide interval, but
        # still knows something about where the centre is.
        comps = [
            CompCandidate(
                listing_id=i,
                source_listing_id=f"m{i}",
                year=2016,
                make="Mazda",
                model="CX-5",
                trim_text="Touring",
                price_cents=1_000_000 + i * 40_000,
                mileage=None,
                location_text=f"City{i}, MO",
            )
            for i in range(8)
        ]
        target = CompCandidate(
            listing_id=999,
            source_listing_id="target",
            year=2016,
            make="Mazda",
            model="CX-5",
            trim_text="Touring",
            price_cents=1_100_000,
            mileage=120_000,
            location_text="St Louis, MO",
        )
        est = estimate_expected_asking_price(filter_comps(target, comps))
        assert est.expected_uncertainty_fraction is not None
        assert est.expected_uncertainty_fraction < params.FALLBACK_INTERVAL_HALF_WIDTH_FRACTION
