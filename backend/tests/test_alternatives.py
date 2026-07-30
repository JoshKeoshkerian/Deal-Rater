"""Alternatives nearby (spec 6.5, build step 7).

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

from app.alternatives import find_alternatives
from app.alternatives import params as alt_params
from app.pricing.comps import CompCandidate, filter_comps
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


def run(t: CompCandidate, comps: list[CompCandidate]):
    comp_set = filter_comps(t, comps)
    estimate = estimate_expected_asking_price(comp_set)
    return find_alternatives(t, comp_set.included, estimate)


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

    def test_a_trivial_advantage_still_counts_as_equalish(self):
        # 2026-07-30: a same-trim comp within EQUALISH_TOLERANCE of the
        # target's own residual is a practical tie, not "not worth naming" --
        # dropping it made "no alternatives" indistinguishable from "no
        # BETTER alternatives" (see finder.py's TRIM-RESTRICTED note).
        comps = line()
        estimate = estimate_expected_asking_price(filter_comps(target(), comps))
        expected = estimate.expected_asking_cents
        result = run(target(price=int(expected * 1.001), mileage=120_000), comps)
        assert result.has_alternatives
        assert all(a.advantage < alt_params.MIN_RESIDUAL_ADVANTAGE for a in result.alternatives)

    def test_a_meaningfully_worse_comp_is_never_shown(self):
        # Beyond EQUALISH_TOLERANCE, a same-trim comp is genuinely worse value
        # than the target and must not appear in `alternatives`.
        comps = line()
        estimate = estimate_expected_asking_price(filter_comps(target(), comps))
        expected = estimate.expected_asking_cents
        result = run(target(price=int(expected * 0.80), mileage=120_000), comps)
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

    def test_a_target_priced_better_than_half_its_comps_still_shows_them(self):
        # 2026-07-30 (later same day): a prior version suppressed
        # `alternatives` outright whenever the target beat the MEDIAN comp,
        # even when it did not beat all of them and genuinely better-priced
        # comps existed -- the exact bug reported against a captured 2010
        # 370Z. "This listing is priced better than at least half of its
        # comparable listings, so alternatives are not worth the distraction"
        # reads as "there might be something better and this tool is
        # choosing not to tell you," which is worse than naming the comps.
        # Only `target_is_best` (beats EVERY comp) suppresses now.
        comps = [*line(9), comp(50, price=984_000, mileage=100_000)]
        result = run(target(price=1_000_000, mileage=120_000), comps)
        assert not result.target_is_best
        assert result.has_alternatives
        assert "not worth the distraction" not in result.message()

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


class TestTrimRestriction:
    """2026-07-30: `alternatives` is same-trim only; a different-trim comp that
    is meaningfully cheaper goes in `different_trim` instead, never both."""

    def test_a_cheaper_different_trim_comp_is_not_an_alternative(self):
        # A cheaper EX-L is not an alternative to a Touring -- it is a
        # different car.
        comps = [*line(9), comp(50, price=950_000, mileage=100_000, trim_text="EX-L")]
        result = run(target(price=1_600_000, mileage=100_000), comps)
        assert all(a.candidate.trim_text != "EX-L" for a in result.alternatives)
        assert any(a.candidate.trim_text == "EX-L" for a in result.different_trim)

    def test_same_trim_comps_never_land_in_different_trim(self):
        # Every comp in `line()` shares the target's "Touring" trim.
        result = run(target(price=1_600_000, mileage=100_000), line())
        assert not result.different_trim

    def test_an_unstated_trim_comp_is_excluded_from_both_lists(self):
        # Spec 4.3: an unstated trim costs confidence, it is not grounds for a
        # same-vs-different comparison either way.
        comps = [*line(9), comp(50, price=900_000, mileage=100_000, trim_text=None)]
        result = run(target(price=1_600_000, mileage=100_000), comps)
        ids = {
            a.candidate.source_listing_id for a in (*result.alternatives, *result.different_trim)
        }
        assert "c50" not in ids

    def test_different_trim_still_requires_a_meaningful_advantage(self):
        # EQUALISH_TOLERANCE is a same-trim concession only -- a different trim
        # priced about the same as the target is not a finding worth its own
        # dropdown, since it is neither cheaper for what it is nor the same car.
        comps = line()
        estimate = estimate_expected_asking_price(filter_comps(target(), comps))
        expected = estimate.expected_asking_cents
        near_tie = comp(50, price=expected, mileage=120_000, trim_text="EX-L")
        result = run(target(price=int(expected * 1.001), mileage=120_000), [*comps, near_tie])
        assert not any(a.candidate.source_listing_id == "c50" for a in result.different_trim)

    def test_the_different_trim_list_is_capped(self):
        comps = [
            comp(i, price=900_000, mileage=100_000 + i, trim_text=f"Trim{i}") for i in range(10)
        ]
        result = run(target(price=1_600_000, mileage=100_000), [*line(), *comps])
        assert len(result.different_trim) <= alt_params.MAX_DIFFERENT_TRIM_ALTERNATIVES


class TestUnknownTargetTrim:
    """2026-07-30 (later same day): a target with no stated trim graded every
    comp `UNKNOWN` (grade_trim requires both sides to state one), which
    emptied `alternatives` AND `different_trim` regardless of price -- the
    exact bug reported against a captured 2013 Scion FR-S asking $16,000
    against same-mileage comps asking $12,000, which showed "No better-priced
    alternatives found."
    """

    def test_alternatives_still_show_when_the_target_states_no_trim(self):
        t = replace(target(price=1_600_000, mileage=100_000), trim_text=None)
        result = run(t, line())
        assert result.has_alternatives

    def test_an_empty_string_trim_is_treated_the_same_as_none(self):
        # The captured listing had "" rather than a null trim_text.
        t = replace(target(price=1_600_000, mileage=100_000), trim_text="")
        result = run(t, line())
        assert result.has_alternatives

    def test_the_message_notes_trim_was_not_matched(self):
        t = replace(target(price=1_600_000, mileage=100_000), trim_text=None)
        result = run(t, line())
        assert not result.trim_known
        assert "trim" in result.message().lower()

    def test_a_stated_target_trim_still_restricts_normally(self):
        # Guards against the fix disabling the restriction unconditionally
        # rather than only when the TARGET's own trim is unknown.
        comps = [*line(9), comp(50, price=950_000, mileage=100_000, trim_text="EX-L")]
        result = run(target(price=1_600_000, mileage=100_000), comps)
        assert result.trim_known
        assert all(a.candidate.trim_text != "EX-L" for a in result.alternatives)
