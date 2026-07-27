"""Leave-one-out cross-validation harness (app/cli/backtest.py).

The harness exists to decide whether a change to the pricing model ships, so it
has to be trustworthy in its own right: a backtest that silently reports a good
number is worse than no backtest. These tests pin the properties that make its
output mean what it claims -- that the held-out comp really is absent from the
fit predicting it, and that a comp set with a known answer produces the error
that answer implies.
"""

from __future__ import annotations

from dataclasses import replace

import pytest

from app.cli.backtest import Prediction, _strata, _without, predictions_for
from app.pricing import params
from app.pricing.comps import CompCandidate, filter_comps
from app.pricing.loader import StoredCapture
from app.pricing.regression import EstimatorKind


def comp(i: int, *, price: int, mileage: int, trim: str | None = "Touring") -> CompCandidate:
    return CompCandidate(
        listing_id=i,
        source_listing_id=f"c{i}",
        year=2016,
        make="Mazda",
        model="CX-5",
        trim_text=trim,
        price_cents=price,
        mileage=mileage,
        location_text=f"City{i}, MO",
    )


def target(mileage: int = 120_000, trim: str | None = "Touring") -> CompCandidate:
    return CompCandidate(
        listing_id=999,
        source_listing_id="target",
        year=2016,
        make="Mazda",
        model="CX-5",
        trim_text=trim,
        price_cents=1_100_000,
        mileage=mileage,
        location_text="St Louis, MO",
    )


def capture(candidates: list[CompCandidate], t: CompCandidate | None = None) -> StoredCapture:
    return StoredCapture(
        capture_id=1,
        client_capture_id="cap-1",
        captured_at=None,
        target=t or target(),
        target_observation_id=1,
        candidates=candidates,
        location_scoped=True,
        search_query=None,
    )


def on_a_line(n: int = 12, *, base: int = 2_000_000, slope: float = -8.0) -> list[CompCandidate]:
    """Comps sitting exactly on price = base + slope * mileage."""
    return [
        comp(i, price=int(base + slope * (60_000 + i * 8_000)), mileage=60_000 + i * 8_000)
        for i in range(n)
    ]


def run(candidates: list[CompCandidate], t: CompCandidate | None = None) -> list[Prediction]:
    return predictions_for(capture(candidates, t), coverage=params.INTERVAL_COVERAGE)


class TestTheHarnessMeasuresWhatItClaims:
    def test_a_perfectly_linear_comp_set_predicts_itself_almost_exactly(self):
        # Every comp lies on one line, so dropping any single one leaves the
        # rest determining that same line -- the held-out point is recovered.
        # This is the harness's calibration check: if it cannot score a known
        # answer near zero, no number it reports elsewhere can be believed.
        predictions = run(on_a_line())
        assert predictions
        assert max(p.ape for p in predictions) < 0.01

    def test_scatter_produces_error_the_linear_case_does_not(self):
        noisy = on_a_line()
        # Move one comp far off the line. It should be badly mispredicted when
        # held out, because the other eleven still describe the clean line.
        noisy[5] = comp(5, price=4_000_000, mileage=100_000)
        predictions = run(noisy)
        worst = max(predictions, key=lambda p: p.ape)
        assert worst.source_listing_id == "c5"
        assert worst.ape > 0.5

    def test_the_held_out_comp_is_absent_from_the_fit_that_predicts_it(self):
        # The out-of-sample property, asserted directly rather than trusted:
        # each prediction is made by a fit with one fewer point than the set.
        full = filter_comps(target(), on_a_line())
        n_fit = len(full.fit_points)
        predictions = run(on_a_line())
        assert all(p.n_fit_points == n_fit - 1 for p in predictions)

    def test_every_usable_comp_is_held_out_exactly_once(self):
        predictions = run(on_a_line())
        ids = [p.source_listing_id for p in predictions]
        assert len(ids) == len(set(ids)) == 12


class TestWhatIsAndIsNotPredicted:
    def test_a_comp_without_mileage_is_not_predicted(self):
        # It cannot sit on the x axis, so it is not a fit point and there is
        # nothing to hold out. It is still a comp for thickness purposes.
        no_mileage = replace(comp(50, price=1_200_000, mileage=90_000), mileage=None)
        assert "c50" not in {p.source_listing_id for p in run([*on_a_line(), no_mileage])}

    def test_a_comp_set_too_thin_to_fit_yields_no_predictions(self):
        # Two comps cannot support a fit that drops one of them.
        assert run(on_a_line(2)) == []

    def test_predictions_carry_the_estimator_that_made_them(self):
        # Broken out in the report because a median fallback and a regression
        # are different models and averaging them hides which one moved.
        predictions = run(on_a_line())
        assert all(p.kind is EstimatorKind.MILEAGE_REGRESSION for p in predictions)


class TestApe:
    def test_it_is_symmetric_and_relative(self):
        p = Prediction(
            capture_id=1,
            source_listing_id="c1",
            actual_cents=1_000_000,
            predicted_cents=1_200_000,
            mileage=100_000,
            trim_matches=True,
            n_fit_points=9,
            kind=EstimatorKind.MILEAGE_REGRESSION,
        )
        assert p.ape == pytest.approx(0.2)


class TestWithout:
    def test_it_removes_exactly_one_decision_and_keeps_the_rest(self):
        comp_set = filter_comps(target(), on_a_line())
        reduced = _without(comp_set, 0)
        assert len(reduced.decisions) == len(comp_set.decisions) - 1
        assert reduced.decisions == comp_set.decisions[1:]

    def test_it_preserves_the_year_window_rather_than_rewidening(self):
        # Re-running the widening ladder on the reduced set could select a
        # different window and change which comps exist, which would measure
        # the ladder instead of the fit.
        comp_set = filter_comps(target(), on_a_line(), year_window=4)
        assert _without(comp_set, 0).year_window == 4

    def test_the_original_set_is_left_intact(self):
        comp_set = filter_comps(target(), on_a_line())
        before = len(comp_set.decisions)
        _without(comp_set, 0)
        assert len(comp_set.decisions) == before


class TestStrata:
    def test_trim_strata_partition_the_predictions(self):
        # Every prediction lands in exactly one of the three trim buckets, so
        # the trim comparison in the report cannot double-count or drop rows.
        mixed = [
            *on_a_line(8),
            *[
                comp(20 + i, price=1_500_000, mileage=90_000 + i * 5_000, trim="Grand Touring")
                for i in range(4)
            ],
        ]
        predictions = run(mixed)
        strata = dict(_strata(predictions))
        buckets = (
            len(strata["trim matches target"])
            + len(strata["trim differs from target"])
            + len(strata["trim not comparable"])
        )
        assert buckets == len(predictions)

    def test_a_comp_with_no_trim_is_assumed_base_and_compared(self):
        # A comp with no stated trim is assumed base (see `comps._BASE_TRIM`),
        # not left uncompared. Against a "Touring" target that assumption
        # disagrees, so it lands in "differs" rather than "not comparable" --
        # the bucket that stratum is now structurally empty, since every
        # comparison has an answer once both sides default to base.
        mixed = [*on_a_line(10), comp(30, price=1_400_000, mileage=95_000, trim=None)]
        strata = dict(_strata(run(mixed)))
        assert "c30" in {p.source_listing_id for p in strata["trim differs from target"]}
        assert strata["trim not comparable"] == []
