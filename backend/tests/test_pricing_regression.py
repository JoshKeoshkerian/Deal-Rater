"""Mileage-adjusted expected ASKING price and its prediction interval (spec 5.1).

Includes the minimum-comp-count fallback ladder: regression -> comp median ->
no estimate. Spec 4.3: "Never silently score off 3 comps."
"""

from __future__ import annotations

import pytest

from app.pricing import params
from app.pricing.comps import CompCandidate, filter_comps
from app.pricing.regression import (
    EstimatorKind,
    _solve,
    estimate_expected_asking_price,
)
from app.pricing.tdist import t_cdf, t_two_sided


def comp(i: int, *, price: int, mileage: int | None, **kw) -> CompCandidate:
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
    )
    base.update(kw)
    return CompCandidate(**base)  # type: ignore[arg-type]


def target(
    mileage: int | None = 120_000,
    price: int = 1_100_000,
    *,
    year: int | None = 2016,
    trim_text: str | None = "Touring",
) -> CompCandidate:
    return CompCandidate(
        listing_id=999,
        source_listing_id="target",
        year=year,
        make="Mazda",
        model="CX-5",
        trim_text=trim_text,
        price_cents=price,
        mileage=mileage,
        location_text="St Louis, MO",
    )


def clean_line(n: int = 10, *, base: int = 2_000_000, slope: float = -8.0) -> list[CompCandidate]:
    """A comp set on a clean downward line: $0.08 of asking price per mile."""
    return [
        comp(i, price=int(base + slope * (60_000 + i * 12_000)), mileage=60_000 + i * 12_000)
        for i in range(n)
    ]


def build(t: CompCandidate, candidates: list[CompCandidate]):
    return estimate_expected_asking_price(filter_comps(t, candidates))


class TestTDistribution:
    @pytest.mark.parametrize(
        "df,expected",
        [(1, 12.706), (2, 4.303), (5, 2.571), (10, 2.228), (30, 2.042)],
    )
    def test_matches_published_critical_values(self, df, expected):
        assert t_two_sided(0.95, df) == pytest.approx(expected, abs=0.002)

    def test_cdf_is_symmetric(self):
        assert t_cdf(0.0, 8) == pytest.approx(0.5)
        assert t_cdf(-1.5, 8) == pytest.approx(1 - t_cdf(1.5, 8))


class TestRegression:
    def test_recovers_a_known_slope(self):
        est = build(target(120_000), clean_line())
        assert est.kind is EstimatorKind.MILEAGE_REGRESSION
        assert est.slope_cents_per_mile == pytest.approx(-8.0, abs=0.01)

    def test_expected_asking_price_sits_on_the_line(self):
        est = build(target(120_000), clean_line())
        assert est.expected_asking_cents == pytest.approx(2_000_000 - 8 * 120_000, rel=0.01)

    def test_a_higher_mileage_target_gets_a_lower_expected_asking_price(self):
        low = build(target(80_000), clean_line())
        high = build(target(180_000), clean_line())
        assert high.expected_asking_cents < low.expected_asking_cents

    def test_interval_brackets_the_point_estimate(self):
        est = build(target(120_000), clean_line())
        assert (
            est.asking_interval_low_cents
            < est.expected_asking_cents
            < est.asking_interval_high_cents
        )

    def test_noisier_comps_give_a_wider_interval(self):
        # Spec 5.1: interval width "honestly communicates comp quality".
        tight = clean_line()
        noisy = [
            comp(i, price=c.price_cents + (400_000 if i % 2 else -400_000), mileage=c.mileage)
            for i, c in enumerate(tight)
        ]
        w_tight = build(target(), tight)
        w_noisy = build(target(), noisy)
        tw = w_tight.asking_interval_high_cents - w_tight.asking_interval_low_cents
        nw = w_noisy.asking_interval_high_cents - w_noisy.asking_interval_low_cents
        assert nw > tw

    def test_extrapolation_widens_the_interval(self):
        # A target outside the comps' mileage range gets a wider interval, via
        # the leverage term. This is the honest response to extrapolation.
        inside = build(target(120_000), clean_line())
        outside = build(target(400_000), clean_line())
        iw = inside.asking_interval_high_cents - inside.asking_interval_low_cents
        ow = outside.asking_interval_high_cents - outside.asking_interval_low_cents
        assert ow > iw

    def test_interval_is_never_narrower_than_the_input_precision(self):
        # Comp mileage arrives rounded to 1,000, so a perfect fit would
        # otherwise publish a near-zero interval it has not earned.
        exact = [comp(i, price=2_000_000 - 8 * (60_000 + i * 12_000), mileage=60_000 + i * 12_000)
                 for i in range(10)]
        est = build(target(120_000), exact)
        half = (est.asking_interval_high_cents - est.asking_interval_low_cents) / 2
        assert est.interval_widened_to_floor
        assert half >= est.expected_asking_cents * params.MIN_INTERVAL_HALF_WIDTH_FRACTION

    def test_r_squared_is_reported(self):
        est = build(target(), clean_line())
        assert est.r_squared == pytest.approx(1.0, abs=0.01)


class TestSlopeGuards:
    def test_a_positive_slope_is_rejected_as_noise(self):
        # More miles for more money is sampling noise, not a finding, and
        # extrapolating it produces a confidently wrong number.
        rising = [comp(i, price=800_000 + 8 * (60_000 + i * 12_000), mileage=60_000 + i * 12_000)
                  for i in range(10)]
        est = build(target(200_000), rising)
        assert est.kind is EstimatorKind.COMP_MEDIAN
        assert any("positive" in r for r in est.fallback_reasons)

    def test_identical_mileage_everywhere_falls_back(self):
        flat = [comp(i, price=1_000_000 + i * 10_000, mileage=100_000) for i in range(10)]
        est = build(target(100_000), flat)
        assert est.kind is EstimatorKind.COMP_MEDIAN
        assert any("same mileage" in r for r in est.fallback_reasons)

    def test_a_target_without_mileage_cannot_be_mileage_adjusted(self):
        est = build(target(None), clean_line())
        assert est.kind is EstimatorKind.COMP_MEDIAN
        assert any("no mileage" in r for r in est.fallback_reasons)


class TestFallbackLadder:
    def test_too_few_for_a_slope_falls_back_to_the_median(self):
        few = clean_line(params.MIN_COMPS_FOR_SLOPE - 1)
        est = build(target(), few)
        assert est.kind is EstimatorKind.COMP_MEDIAN
        assert est.expected_asking_cents is not None

    def test_below_the_floor_publishes_no_estimate_at_all(self):
        # Spec 4.3: "Never silently score off 3 comps."
        est = build(target(), clean_line(2))
        assert est.kind is EstimatorKind.INSUFFICIENT
        assert est.expected_asking_cents is None
        assert est.asking_interval_low_cents is None

    def test_the_median_fallback_interval_is_wide(self):
        est = build(target(), clean_line(params.MIN_COMPS_FOR_SLOPE - 1))
        width = est.asking_interval_high_cents - est.asking_interval_low_cents
        assert width / est.expected_asking_cents > 0.3

    def test_comps_without_mileage_still_count_toward_the_floor(self):
        # They cannot sit on the line, but they are evidence the market is
        # thick, so they are not discarded.
        candidates = [
            *clean_line(2),
            comp(50, price=1_150_000, mileage=None),
            comp(51, price=1_180_000, mileage=None),
        ]
        est = build(target(), candidates)
        assert est.n_included == 4
        assert est.n_fit_points == 2
        assert est.kind is EstimatorKind.COMP_MEDIAN


class TestAskingPriceSemantics:
    def test_residual_is_positive_when_asking_above_expected(self):
        est = build(target(120_000), clean_line())
        expected = est.expected_asking_cents
        assert est.residual_fraction(int(expected * 1.2)) == pytest.approx(0.2, abs=0.01)

    def test_residual_is_negative_when_asking_below_expected(self):
        est = build(target(120_000), clean_line())
        expected = est.expected_asking_cents
        assert est.residual_fraction(int(expected * 0.8)) == pytest.approx(-0.2, abs=0.01)

    def test_a_zero_dollar_ask_is_not_treated_as_a_100_percent_discount(self):
        # Captured data has a Protege target at $0 and a comp at $25. Those are
        # "make an offer" placeholders, not asks, and treating them as real
        # would return the model's most extreme output on its least meaningful
        # input.
        est = build(target(120_000), clean_line())
        assert est.residual_fraction(0) is None
        assert est.residual_fraction(2_500) is None

    def test_within_interval_reports_containment(self):
        est = build(target(120_000), clean_line())
        assert est.within_interval(est.expected_asking_cents) is True
        assert est.within_interval(est.asking_interval_high_cents + 1_000_000) is False

    def test_every_public_money_field_is_named_asking(self):
        # Spec 4.5 / 5.1: this is what comparable vehicles are ADVERTISED at,
        # not what they sell for, and the naming is what stops the weaker claim
        # being quietly upgraded later.
        est = build(target(), clean_line())
        # Fit COEFFICIENTS are exempt: slope, intercept and residual standard
        # error are parameters of the line, not prices anyone is shown. The rule
        # applies to every figure that reaches a user.
        coefficients = ("slope", "std_error", "intercept")
        money_fields = [
            f
            for f in est.__dataclass_fields__
            if f.endswith("_cents") and not any(c in f for c in coefficients)
        ]
        assert money_fields
        for name in money_fields:
            assert "asking" in name, f"{name} does not say 'asking'"


class TestOutlierSensitivity:
    """A robust fit is computed as a DIAGNOSTIC, never published as the price."""

    def test_a_clean_comp_set_shows_low_sensitivity(self):
        est = build(target(120_000), clean_line())
        assert est.outlier_sensitivity is not None
        assert est.outlier_sensitivity < 0.05

    def test_one_junk_listing_moves_least_squares_and_is_detected(self):
        # Spec 2: a private-party market oversupplies exactly this. One badly
        # underpriced low-mileage car levers the OLS line down at that end.
        #
        # $7,000 against a ~$14,400 trend is roughly half off: cheap enough to
        # drag the fit, not cheap enough for the junk screen to call it
        # not-an-offer. That gap is this diagnostic's job.
        contaminated = [*clean_line(9)]
        contaminated.append(comp(99, price=700_000, mileage=70_000))
        est = build(target(180_000), contaminated)
        assert est.n_junk_excluded == 0
        assert est.outlier_sensitivity > params.MAX_ROBUST_DISAGREEMENT

    def test_the_robust_fit_is_never_the_published_price(self):
        contaminated = [*clean_line(9), comp(99, price=700_000, mileage=70_000)]
        est = build(target(180_000), contaminated)
        # The published number stays the OLS one. Which estimator is right is a
        # calibration question (spec 9.4) with no ground truth set to settle it.
        assert est.kind is EstimatorKind.MILEAGE_REGRESSION
        assert est.expected_asking_cents != est.robust_asking_cents


class TestJunkPriceScreen:
    """Fit points too far below the robust trend to be real asking prices.

    Captured data is full of these -- a $1,234 and a $1,400 "CX-5" beside a
    $7,900 median, a $4,500 2020 Camry at 121k miles. They are placeholders,
    parts cars or scams, and one of them anchoring an eight-point regression
    moves the expected price for every listing scored against it.
    """

    def test_a_listing_far_below_trend_is_dropped_from_the_fit(self):
        # ~72% below the ~$14,400 trend at 70k miles.
        est = build(target(120_000), [*clean_line(9), comp(99, price=400_000, mileage=70_000)])
        assert est.n_junk_excluded == 1
        assert est.n_fit_points == 9

    def test_dropping_it_protects_the_expected_price(self):
        clean = build(target(120_000), clean_line(9))
        contaminated = build(
            target(120_000), [*clean_line(9), comp(99, price=400_000, mileage=70_000)]
        )
        # Within a percent of the uncontaminated answer, rather than levered
        # down by the junk point.
        assert contaminated.expected_asking_cents == pytest.approx(
            clean.expected_asking_cents, rel=0.01
        )

    def test_the_screen_is_one_sided(self):
        # An implausibly HIGH ask is a real thing a real seller really did, and
        # this model reports ASKING prices (spec 4.5). Only the low side is
        # evidence of a non-offer.
        est = build(target(120_000), [*clean_line(9), comp(99, price=9_000_000, mileage=70_000)])
        assert est.n_junk_excluded == 0
        assert est.n_fit_points == 10

    def test_it_refuses_to_fire_when_it_would_gut_the_comp_set(self):
        # A comp set that is mostly junk has nothing to say. Screening down to
        # two survivors and fitting a confident line through them would be
        # worse than the wide median fallback.
        mostly_junk = [comp(i, price=200_000, mileage=60_000 + i * 12_000) for i in range(7)]
        est = build(target(120_000), [*clean_line(3), *mostly_junk])
        assert est.n_junk_excluded == 0

    def test_a_genuinely_cheap_but_plausible_comp_survives(self):
        # The product exists to find underpriced cars (spec 1). A comp 25%
        # under trend is a bargain, not a placeholder, and must stay in.
        est = build(target(120_000), [*clean_line(9), comp(99, price=1_080_000, mileage=70_000)])
        assert est.n_junk_excluded == 0

    def test_sensitivity_is_absent_when_no_slope_was_fitted(self):
        est = build(target(), clean_line(4))
        assert est.kind is EstimatorKind.COMP_MEDIAN
        assert est.outlier_sensitivity is None


class TestTrimPreferredFit:
    """Regression tests for a real finding: restricting to trim-matched comps
    narrows the interval MOST of the time, but not always, because a smaller,
    more similar set can still leave the target's mileage outside the range it
    covers. On real captured data (a 2017 RAV4), doing this unconditionally
    took a 20.9% interval to 44.4% by dropping every high-mileage comp that
    happened to carry a different trim. See the module docstring on why every
    candidate is compared on half-width rather than trim match being an
    override.
    """

    def test_restricting_to_trim_wins_when_it_narrows_the_interval(self):
        # The Touring line is clean; the Sport comps mixed into the same
        # mileage range are noise. Restricting to Touring recovers the clean
        # fit instead of averaging it with noise that shares no trim.
        touring = clean_line()
        sport_noise = [
            comp(
                100 + i,
                price=c.price_cents + (500_000 if i % 2 else -500_000),
                mileage=c.mileage,
                trim_text="Sport",
            )
            for i, c in enumerate(touring)
        ]
        mixed = build(target(120_000), touring + sport_noise)
        touring_only = build(target(120_000), touring)

        assert mixed.restricted_to_trim_match
        assert mixed.n_fit_points == len(touring)
        # Restricting recovers (approximately) the clean line's own fit --
        # not exactly, because the guard against reading the input precision
        # too finely (MIN_INTERVAL_HALF_WIDTH_FRACTION) can floor both alike.
        assert mixed.expected_asking_cents == pytest.approx(
            touring_only.expected_asking_cents, rel=0.01
        )

    def test_restricting_to_trim_is_declined_when_it_would_widen_the_interval(self):
        # Touring comps only cover up to ~168k miles. A target at 300k miles
        # restricted to Touring alone would extrapolate hugely; mixing in
        # higher-mileage Sport comps that bracket the target keeps leverage
        # low even though they are a different trim. The wider, more diverse
        # set is the more informative one here, and the model should say so
        # by not restricting.
        touring = clean_line()
        high_mileage_sport = [
            comp(
                200 + i,
                price=int(1_800_000 - 2 * (250_000 + i * 15_000)),
                mileage=250_000 + i * 15_000,
                trim_text="Sport",
            )
            for i in range(6)
        ]
        est = build(target(300_000), touring + high_mileage_sport)

        assert not est.restricted_to_trim_match
        assert est.n_fit_points == len(touring) + len(high_mileage_sport)

    def test_a_uniform_trim_comp_set_is_unaffected_by_the_choice(self):
        # Every fixture elsewhere in this file uses a uniform trim, so the
        # trim-matched subset and the full set are identical -- the two
        # candidates tie on half-width, and the baseline wins the tie. Either
        # answer would be defensible when restricting changes nothing; what
        # matters is the published estimate is exactly the clean line's own
        # fit either way, not which flag a tie happens to set.
        est = build(target(120_000), clean_line())
        assert est.expected_asking_cents == pytest.approx(2_000_000 - 8 * 120_000, rel=0.01)


class TestTheLinearSolver:
    """`_solve` underpins every multi-regressor fit, so its failure modes are
    the fit's failure modes. A wrong answer here is a wrong price."""

    def test_it_solves_a_known_system(self):
        # 2x + y = 5, x + 3y = 10  ->  x = 1, y = 3
        solved = _solve([[2.0, 1.0], [1.0, 3.0]], [5.0, 10.0])
        assert solved is not None
        assert solved[0] == pytest.approx(1.0)
        assert solved[1] == pytest.approx(3.0)

    def test_a_singular_system_returns_none_rather_than_raising(self):
        # Second row is twice the first: no unique solution. The caller treats
        # this as "this candidate fit has nothing to add", not as an error.
        assert _solve([[1.0, 2.0], [2.0, 4.0]], [3.0, 6.0]) is None

    def test_it_survives_the_scale_real_cross_products_arrive_at(self):
        # Entries are sums of squared mileages, so they run to 1e10 and up. An
        # absolute pivot epsilon would call this singular; the tolerance is
        # relative for exactly this reason.
        big = [[4.0e10, 1.0e9], [1.0e9, 2.0e10]]
        solved = _solve(big, [8.0e10, 4.0e10])
        assert solved is not None
        assert all(abs(v) < 1e3 for v in solved)

    def test_it_handles_a_system_needing_a_pivot_swap(self):
        # A zero in the leading position forces partial pivoting; without the
        # swap this divides by zero.
        solved = _solve([[0.0, 2.0], [1.0, 1.0]], [4.0, 3.0])
        assert solved is not None
        assert solved[0] == pytest.approx(1.0)
        assert solved[1] == pytest.approx(2.0)


class TestYearTermFit:
    """Model year as a second regressor. Optional: tried alongside the
    mileage-only baseline and kept only when it narrows the interval (see the
    module docstring)."""

    def _year_varying_rows(self, n: int) -> list[tuple[int, int, int]]:
        """(mileage, year, price) with price = f(mileage, year) exactly, and
        mileage varying independently of year so neither absorbs the other."""
        rows = []
        for i in range(n):
            year = 2013 + (i % 6)
            mileage = 50_000 + ((i * 37) % 9) * 15_000
            price = int(2_000_000 - 5 * mileage + 60_000 * (year - 2016))
            rows.append((mileage, year, price))
        return rows

    def _comps(self, rows: list[tuple[int, int, int]]) -> list[CompCandidate]:
        return [
            comp(i, price=price, mileage=mileage, year=year)
            for i, (mileage, year, price) in enumerate(rows)
        ]

    def test_a_year_term_is_used_when_it_narrows_the_interval(self):
        rows = self._year_varying_rows(12)
        est = estimate_expected_asking_price(
            filter_comps(target(120_000, year=2016), self._comps(rows), year_window=10)
        )
        assert est.uses_year_term
        assert est.slope_cents_per_year == pytest.approx(60_000.0, abs=1.0)
        # Mileage alone leaves real, independent year-driven variance
        # unexplained; adding year should recover a much tighter fit.
        assert est.r_squared > 0.99

    def test_a_year_term_is_skipped_below_the_comp_floor(self):
        # Same underlying relationship as the test above, but at exactly
        # MIN_COMPS_FOR_SLOPE -- one below MIN_COMPS_FOR_YEAR_TERM. The extra
        # parameter is not attempted even though it would help, because there
        # is not enough data to trust it.
        assert params.MIN_COMPS_FOR_YEAR_TERM > params.MIN_COMPS_FOR_SLOPE
        rows = self._year_varying_rows(params.MIN_COMPS_FOR_SLOPE)
        est = estimate_expected_asking_price(
            filter_comps(target(120_000, year=2016), self._comps(rows), year_window=10)
        )
        assert not est.uses_year_term
        assert est.kind is EstimatorKind.MILEAGE_REGRESSION

    def test_a_year_term_is_skipped_when_year_does_not_vary(self):
        # Every comp shares the target's model year here (clean_line's
        # default), so year carries no information to add -- confirmed
        # directly rather than only inferred from the many other tests in
        # this file that happen not to trigger it.
        est = build(target(120_000), clean_line())
        assert not est.uses_year_term

    def test_predicting_at_a_different_year_uses_the_year_slope(self):
        rows = self._year_varying_rows(12)
        est = estimate_expected_asking_price(
            filter_comps(target(120_000, year=2016), self._comps(rows), year_window=10)
        )
        assert est.uses_year_term
        newer = est.predict_asking_cents(120_000, 2018)
        older = est.predict_asking_cents(120_000, 2014)
        # Constructed with a positive year slope (newer costs more).
        assert newer > older

    def test_predicting_without_a_year_fails_closed_when_the_fit_needs_one(self):
        rows = self._year_varying_rows(12)
        est = estimate_expected_asking_price(
            filter_comps(target(120_000, year=2016), self._comps(rows), year_window=10)
        )
        assert est.uses_year_term
        # Silently reusing the mileage-only line would drop a term the
        # published fit relies on -- refusing is the honest response.
        assert est.predict_asking_cents(120_000, None) is None

    def test_residual_against_own_expectation_accepts_a_year(self):
        rows = self._year_varying_rows(12)
        est = estimate_expected_asking_price(
            filter_comps(target(120_000, year=2016), self._comps(rows), year_window=10)
        )
        own_price = est.predict_asking_cents(150_000, 2015)
        assert est.residual_against_own_expectation(own_price, 150_000, 2015) == pytest.approx(
            0.0, abs=0.01
        )
