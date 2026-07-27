"""Better alternatives nearby (spec 6.5, build step 7).

The claims under test:

  1. "Better" means better VALUE against the fitted line, not a lower sticker.
  2. Implausibly cheap comps are never recommended (spec 2's adverse selection,
     arrived at from the opposite direction).
  3. When the target is the best of its comps, that is stated rather than left
     as silence (spec 6.5).
  4. Nothing is fetched -- alternatives come from comps already in hand.
"""

from __future__ import annotations

from dataclasses import replace

import pytest

from app.alternatives import find_alternatives
from app.alternatives import params as alt_params
from app.pricing.comps import CompCandidate, filter_comps
from app.pricing.confidence import Confidence
from app.pricing.regression import estimate_expected_asking_price


def comp(i: int, *, price: int, mileage: int, **kw) -> CompCandidate:
    base = dict(
        listing_id=i,
        source_listing_id=f"c{i}",
        year=2016,
        make="Mazda",
        model="CX-5",
        trim_text="Touring",
        price_cents=price,
        mileage=mileage,
        location_text=f"City{i}, MO",
        listing_url=f"https://www.facebook.com/marketplace/item/{i}/",
    )
    base.update(kw)
    return CompCandidate(**base)  # type: ignore[arg-type]


def target(price: int = 1_200_000, mileage: int = 120_000) -> CompCandidate:
    return CompCandidate(
        listing_id=999,
        source_listing_id="target",
        year=2016,
        make="Mazda",
        model="CX-5",
        trim_text="Touring",
        price_cents=price,
        mileage=mileage,
        location_text="St Louis, MO",
    )


def line(n: int = 10) -> list[CompCandidate]:
    """Comps on a clean line: $20,000 at 0 miles, falling $0.08 per mile."""
    return [
        comp(i, price=2_000_000 - 8 * (60_000 + i * 12_000), mileage=60_000 + i * 12_000)
        for i in range(n)
    ]


def run(
    t: CompCandidate,
    comps: list[CompCandidate],
    confidence: Confidence | None = Confidence.HIGH,
):
    comp_set = filter_comps(t, comps)
    estimate = estimate_expected_asking_price(comp_set)
    return find_alternatives(t, comp_set.included, estimate, confidence)


class TestBetterMeansValueNotPrice:
    def test_a_cheaper_car_with_far_more_miles_is_flagged_as_a_tradeoff(self):
        comps = [*line(9), comp(50, price=900_000, mileage=200_000)]
        result = run(target(price=1_300_000, mileage=100_000), comps)
        tradeoffs = [a for a in result.alternatives if a.mileage_tradeoff]
        assert tradeoffs, "a much higher-mileage comp should be marked a trade-off"

    def test_a_dearer_car_can_still_be_the_better_value(self):
        # Lower mileage justifies a higher sticker. Ranking on price alone would
        # miss this entirely -- and an earlier implementation did exactly that,
        # because it priced every comp at the TARGET's mileage.
        comps = [*line(9), comp(50, price=1_400_000, mileage=40_000)]
        result = run(target(price=1_300_000, mileage=150_000), comps)
        best = result.alternatives[0]
        assert best.candidate.source_listing_id == "c50"
        assert not best.cheaper_outright, "the best value here costs MORE than the target"

    def test_alternatives_are_ordered_best_value_first(self):
        result = run(target(price=1_600_000, mileage=100_000), line())
        residuals = [a.residual for a in result.alternatives]
        assert residuals == sorted(residuals)

    def test_a_trivial_advantage_is_not_worth_naming(self):
        # Without a margin, a comp 0.4% cheaper becomes "advice".
        comps = line()
        estimate = estimate_expected_asking_price(filter_comps(target(), comps))
        expected = estimate.expected_asking_cents
        result = run(target(price=int(expected * 1.001), mileage=120_000), comps)
        assert not result.has_alternatives


class TestAdverseSelectionExclusion:
    def test_an_implausibly_cheap_comp_is_never_recommended(self):
        # Sorting by residual alone would make the single cheapest car in the
        # set -- disproportionately the worst one -- the top recommendation.
        comps = [*line(9), comp(50, price=200_000, mileage=100_000)]
        result = run(target(price=1_600_000, mileage=100_000), comps)
        assert all(
            a.residual > alt_params.TOO_CHEAP_TO_RECOMMEND for a in result.alternatives
        )

    def test_withheld_listings_are_named_with_their_reason(self):
        # A count on its own ("3 cheaper listings withheld") tells a buyer
        # something exists, declines to say what, and reads as concealment.
        comps = [*line(9), comp(50, price=200_000, mileage=100_000)]
        result = run(target(price=1_600_000, mileage=100_000), comps)
        assert result.withheld
        withheld = result.withheld[0]
        assert withheld.candidate.source_listing_id == "c50"
        assert "below what comparable listings suggest" in withheld.reason
        assert "$2,000" in withheld.describe()
        assert result.withheld_as_implausible == len(result.withheld)


class TestSuppression:
    def test_the_target_being_best_is_stated_not_silent(self):
        # Spec 6.5: "Suppress when the target is already the best available, and
        # say so, since that is also useful."
        result = run(target(price=400_000, mileage=120_000), line())
        assert result.target_is_best
        assert not result.has_alternatives
        assert "best of them" in result.message()

    def test_a_target_priced_better_than_half_its_comps_suppresses(self):
        # Spec 6.5 gates display on the target scoring average or worse. Better
        # comps exist here, so the suppression is the gate doing its job rather
        # than there being nothing to show.
        comps = [*line(9), comp(50, price=984_000, mileage=100_000)]
        result = run(target(price=1_000_000, mileage=120_000), comps)
        assert not result.has_alternatives
        assert not result.target_is_best
        assert "better than at least half" in result.message()

    def test_a_target_priced_above_its_comps_is_never_called_well_priced(self):
        # THE REGRESSION THIS RULE EXISTS FOR.
        #
        # The old gate was an absolute threshold on the pricing curve
        # (`rating > 60`), and a listing asking 35% ABOVE what its own comps
        # suggest still cleared it -- so the panel printed "already well priced
        # against its comps" directly under a pricing section saying the
        # opposite, with price residual its worst sub-score. "Better than its
        # comps" is a comparison, so it is now decided by comparison.
        comps = [*line(9), comp(50, price=1_000_000, mileage=61_000)]
        result = run(target(price=1_400_000, mileage=120_000), comps)
        assert result.has_alternatives
        assert "well priced" not in result.message()

    def test_low_confidence_never_suppresses(self):
        # Suppressing on a fit the same evaluation is disowning asserts a
        # ranking it has just said it cannot make.
        comps = [*line(9), comp(50, price=984_000, mileage=100_000)]
        good = target(price=1_000_000, mileage=120_000)
        assert not run(good, comps, Confidence.HIGH).has_alternatives
        assert run(good, comps, Confidence.LOW).has_alternatives
        assert run(good, comps, Confidence.NONE).has_alternatives

    def test_an_implausibly_cheap_target_is_not_called_well_priced(self):
        # True by construction under rule 1 -- a car advertised 60% under the
        # line beats every comp -- and calling it "well priced" would be spec
        # 2's adverse selection restated as praise.
        result = run(target(price=400_000, mileage=120_000), line())
        assert "better than at least half" not in result.message()

    def test_target_is_best_stays_truthful_even_when_display_is_gated(self):
        # The comparison still runs; only the display is suppressed.
        result = run(target(price=400_000, mileage=120_000), line())
        assert result.target_is_best is True

    def test_no_estimate_means_no_ranking(self):
        result = run(target(), line(2))
        assert not result.has_alternatives
        assert "nothing to rank" in result.message()

    def test_a_fit_dominated_by_one_comp_suppresses_recommendations(self):
        # Capture 9's case: R-squared 0.18, 72% outlier sensitivity, and the
        # "best alternative" was a 2006 Civic advertised at 2,200 miles --
        # almost certainly a typo. Naming a specific car to a first-time buyer
        # deserves a firmer fit than printing a range does.
        #
        # The estimate is built directly rather than fitted from synthetic
        # comps: reproducing a 30%-plus sensitivity from a clean generated line
        # takes contortions that would obscure what is being asserted, which is
        # the guard itself.
        comps = line()
        comp_set = filter_comps(target(), comps)
        fitted = estimate_expected_asking_price(comp_set)
        dominated = replace(
            fitted,
            robust_asking_cents=int(fitted.expected_asking_cents * 1.8),
        )
        assert dominated.outlier_sensitivity > alt_params.MAX_OUTLIER_SENSITIVITY_TO_RECOMMEND

        result = find_alternatives(
            target(price=1_600_000, mileage=100_000),
            comp_set.included,
            dominated,
            Confidence.HIGH,
        )
        assert not result.has_alternatives
        assert "outlier sensitivity" in result.message()

    def test_a_trustworthy_fit_is_not_suppressed(self):
        result = run(target(price=1_600_000, mileage=100_000), line())
        assert result.has_alternatives

    def test_the_list_is_capped(self):
        result = run(target(price=2_500_000, mileage=200_000), line(12))
        assert len(result.alternatives) <= alt_params.MAX_ALTERNATIVES


class TestOutputShape:
    def test_each_alternative_carries_a_link(self):
        # Spec 6.5's example ends in "[links]" -- the point is to click through.
        result = run(target(price=1_600_000, mileage=100_000), line())
        assert result.has_alternatives
        for alternative in result.alternatives:
            assert alternative.url and alternative.url.startswith("https://")

    def test_the_description_compares_against_the_target(self):
        # An earlier version printed each comp's own residual, producing
        # "better priced ... (42% over expected)" -- true but unreadable.
        result = run(target(price=1_600_000, mileage=100_000), line())
        text = result.alternatives[0].describe()
        assert "better value by" in text
        assert "mi" in text and "$" in text

    def test_it_reads_naturally_for_a_single_alternative(self):
        comps = [*line(8), comp(60, price=1_050_000, mileage=120_000)]
        result = run(target(price=1_250_000, mileage=120_000), comps)
        if len(result.alternatives) == 1:
            assert " is better priced" in result.message()

    @pytest.mark.parametrize(
        "confidence", [None, Confidence.LOW, Confidence.MEDIUM, Confidence.HIGH]
    )
    def test_an_overpriced_target_shows_alternatives_at_any_confidence(self, confidence):
        result = run(target(price=1_600_000, mileage=100_000), line(), confidence)
        assert result.has_alternatives
