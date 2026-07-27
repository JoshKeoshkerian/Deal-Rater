"""Mileage-adjusted expected ASKING price and its prediction interval (spec 5.1).

Includes the minimum-comp-count fallback ladder: regression -> comp median ->
no estimate. Spec 4.3: "Never silently score off 3 comps."
"""

from __future__ import annotations

import pytest

from app.pricing import params
from app.pricing.comps import CompCandidate, filter_comps
from app.pricing.regression import EstimatorKind, estimate_expected_asking_price
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


def target(mileage: int | None = 120_000, price: int = 1_100_000) -> CompCandidate:
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
        money_fields = [
            f
            for f in est.__dataclass_fields__
            if f.endswith("_cents") and "slope" not in f and "std_error" not in f
        ]
        assert money_fields
        for name in money_fields:
            assert "asking" in name, f"{name} does not say 'asking'"
