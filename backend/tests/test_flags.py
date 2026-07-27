"""Flags, completeness and scam patterns (spec 6.2, 6.3, build step 5).

The structural claims under test:

  1. Scam detection flags the COMBINATION and returns NO SCORE (spec 6.3).
  2. Signals report evaluable separately from fired -- an unchecked signal is
     not a passed one.
  3. Title status never moves a price (spec 2).
  4. Signals the spec's own privacy decision forbids stay permanently absent.
"""

from __future__ import annotations

import dataclasses

import pytest

from app.flags import (
    Signal,
    TitleRisk,
    assess_completeness,
    assess_scam_patterns,
    read_title_status,
)
from app.flags.params import SCAM_SIGNALS_FOR_WARNING


def scam(**kw):
    base = dict(
        description="A perfectly ordinary description that runs on for a while, "
        "describing the car, its service history and its condition in detail.",
        photo_count=12,
        vin=None,
        price_residual=0.0,
        price_changed=None,
    )
    base.update(kw)
    return assess_scam_patterns(**base)  # type: ignore[arg-type]


class TestTitleStatus:
    @pytest.mark.parametrize(
        "raw,risk",
        [
            ("salvage", TitleRisk.DISQUALIFYING),
            ("parts_only", TitleRisk.DISQUALIFYING),
            ("no_title", TitleRisk.DISQUALIFYING),
            ("rebuilt", TitleRisk.BRANDED),
            ("branded", TitleRisk.BRANDED),
            ("clean", TitleRisk.CLEAN),
        ],
    )
    def test_classification(self, raw, risk):
        assert read_title_status(raw).risk is risk

    def test_casing_is_normalised(self):
        # Captured data holds both "clean" (from description text) and "CLEAN"
        # (from Facebook's structured field) for the same meaning.
        assert read_title_status("CLEAN").risk is read_title_status("clean").risk

    def test_unstated_is_not_clean(self):
        # Most listings simply do not say. Treating silence as a clean title
        # would invent a reassurance the seller never gave.
        assert read_title_status(None).risk is TitleRisk.UNSTATED
        assert read_title_status("  ").risk is TitleRisk.UNSTATED

    def test_hard_disqualifiers_are_identified_for_the_llm_gate(self):
        # Spec 10: skip the model call when the description carries a hard
        # disqualifier.
        assert read_title_status("salvage").is_hard_disqualifier
        assert not read_title_status("clean").is_hard_disqualifier

    def test_an_unknown_branding_word_is_treated_as_branded_not_clean(self):
        assert read_title_status("water_damage").risk is TitleRisk.BRANDED


class TestScamIsACombinationNotAScore:
    def test_the_assessment_exposes_no_score_field(self):
        # Spec 6.3: "a distinct, prominent warning rather than a numerical
        # deduction buried in a composite." A float here would invite exactly
        # the burial the spec rules out.
        fields = {f.name for f in dataclasses.fields(scam())}
        assert not any("score" in f or "penalty" in f or "weight" in f for f in fields)

    def test_one_signal_does_not_warn(self):
        # Spec 6.3: "Any one of these is weak."
        result = scam(description="Short.")
        assert len(result.fired) == 1
        assert result.warn is False

    def test_four_signals_warn(self):
        # Spec 6.3: "Four together is a strong signal."
        result = scam(
            description="Cash only, wire transfer, I cannot meet, I will ship it to you.",
            photo_count=1,
            price_residual=-0.60,
        )
        assert len(result.fired) >= SCAM_SIGNALS_FOR_WARNING
        assert result.warn is True

    def test_the_threshold_matches_the_spec(self):
        assert SCAM_SIGNALS_FOR_WARNING == 4


class TestSignalsIndividually:
    def test_a_deep_discount_with_no_explanation_fires(self):
        result = scam(price_residual=-0.60)
        assert any(r.signal is Signal.UNEXPLAINED_DEEP_DISCOUNT and r.fired for r in result.results)

    def test_a_deep_discount_WITH_an_explanation_does_not(self):
        # Spec 6.3's wording is "with no explanation in the description". A car
        # that says it needs a transmission is explaining itself.
        result = scam(
            price_residual=-0.60,
            description="Priced low because it needs a transmission. Runs but slips badly. "
            "Selling as-is, mechanic's special, plenty of life in the rest of it.",
        )
        assert not any(
            r.signal is Signal.UNEXPLAINED_DEEP_DISCOUNT and r.fired for r in result.results
        )

    @pytest.mark.parametrize(
        "text",
        [
            "Payment by wire transfer only please",
            "I can ship it to you anywhere in the country",
            "Cannot meet in person, currently deployed overseas",
            "Send a deposit to hold it",
            "Protected by eBay Motors escrow",
        ],
    )
    def test_payment_red_flags(self, text):
        result = scam(description=text + " " * 200)
        assert any(
            r.signal is Signal.PAYMENT_OR_MEETING_RED_FLAGS and r.fired for r in result.results
        )

    def test_ordinary_payment_language_does_not_fire(self):
        result = scam(description="Cash on pickup, happy to meet at my bank. " * 6)
        assert not any(
            r.signal is Signal.PAYMENT_OR_MEETING_RED_FLAGS and r.fired for r in result.results
        )

    def test_vin_omission_only_counts_on_an_otherwise_detailed_listing(self):
        # Spec 4.2: "A VIN omitted from an otherwise detailed listing is itself
        # a mild signal." Most listings omit it, so omission alone is normal.
        detailed = scam(description="x" * 500, vin=None)
        sparse = scam(description="x" * 150, vin=None)
        assert any(
            r.signal is Signal.VIN_OMITTED_FROM_DETAILED_LISTING and r.fired
            for r in detailed.results
        )
        assert not any(
            r.signal is Signal.VIN_OMITTED_FROM_DETAILED_LISTING and r.fired
            for r in sparse.results
        )

    def test_a_present_vin_never_fires_that_signal(self):
        result = scam(description="x" * 500, vin="4T1BF1FK5EU123456")
        assert not any(
            r.signal is Signal.VIN_OMITTED_FROM_DETAILED_LISTING and r.fired
            for r in result.results
        )


class TestEvaluabilityIsSeparateFromFiring:
    def test_an_unchecked_signal_is_not_a_passed_signal(self):
        result = scam(photo_count=None)
        photos = next(r for r in result.results if r.signal is Signal.FEW_OR_STOCK_PHOTOS)
        assert photos.evaluable is False
        assert photos.fired is False
        assert photos.unavailable_reason

    def test_price_revised_upward_is_phase_three(self):
        # Spec 12. `price_changed` is NULL on every captured observation.
        result = scam(price_changed=None)
        signal = next(r for r in result.results if r.signal is Signal.PRICE_REVISED_UPWARD)
        assert signal.evaluable is False
        assert "phase three" in signal.unavailable_reason

    def test_account_age_is_permanently_unavailable_by_decision(self):
        # Spec 6.3 names it as a scam signal; spec 8.2 forbids collecting it
        # ("Explicitly not collected: ... join date, account age"). 8.2 is among
        # the settled decisions in spec 14, so it wins.
        result = scam()
        signal = next(r for r in result.results if r.signal is Signal.NEW_ACCOUNT)
        assert signal.evaluable is False
        assert "8.2" in signal.unavailable_reason

    def test_account_age_is_never_evaluable_whatever_the_inputs(self):
        for kw in [{}, {"description": "x" * 900}, {"photo_count": 0}, {"price_residual": -0.9}]:
            result = scam(**kw)
            signal = next(r for r in result.results if r.signal is Signal.NEW_ACCOUNT)
            assert signal.evaluable is False

    def test_reduced_sensitivity_is_reported(self):
        # Four of seven is a very different bar from four of five, and a quiet
        # "no warning" must not be mistaken for a clean bill.
        assert scam().reduced_sensitivity is True

    def test_all_seven_spec_signals_are_present(self):
        assert {r.signal for r in scam().results} == set(Signal)


class TestCompleteness:
    def _c(self, **kw):
        base = dict(
            description="A thorough description of the vehicle and its history. " * 6,
            photo_count=12,
            mileage=120_000,
            title_status="clean",
            vin="4T1BF1FK5EU123456",
            year=2015,
            trim_text="EX",
        )
        base.update(kw)
        return assess_completeness(**base)  # type: ignore[arg-type]

    def test_a_full_listing_scores_high(self):
        assert self._c().score >= 95

    def test_a_bare_listing_scores_low(self):
        bare = self._c(
            description=None, photo_count=None, mileage=None, title_status=None,
            vin=None, trim_text=None,
        )
        assert bare.score <= 20

    def test_missing_fields_are_named(self):
        assert "VIN" in self._c(vin=None).missing
        assert "mileage" in self._c(mileage=None).missing

    def test_it_measures_disclosure_not_quality(self):
        # A sparse listing from an honest seller scores low, and that is
        # correct: the buyer genuinely knows less.
        assert self._c(description=None).score < self._c().score

    def test_score_stays_in_range(self):
        for photos in (0, 1, 5, 40):
            assert 0.0 <= self._c(photo_count=photos).score <= 100.0


class TestSeparationFromPricing:
    def test_flags_modules_never_import_pricing(self):
        # Spec 2: price and risk must not be collapsed. A branded title is a
        # risk flag, never a price adjustment.
        import inspect

        from app.flags import completeness
        from app.flags import scam as scam_mod

        for module in (completeness, scam_mod):
            source = inspect.getsource(module)
            assert "from ..pricing" not in source
            assert "import pricing" not in source
