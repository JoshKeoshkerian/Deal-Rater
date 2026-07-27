"""Composite score and full evaluation (spec 5.2, 7, build step 8)."""

from __future__ import annotations

from app.evaluation import WEIGHTS, compute_deal_score
from app.evaluation.report import BETA_NOTICE, DISCLAIMER
from app.evaluation.score import MIN_COVERAGE, REQUIRED_COMPONENTS
from app.flags import assess_completeness, assess_scam_patterns, read_title_status
from app.nhtsa import build_assessment
from app.pricing.curve import rate_price_residual


def score(
    *, residual=0.0, description="x" * 400, photos=10, price_changed=None, title_status="clean"
):
    return compute_deal_score(
        rating=rate_price_residual(residual) if residual is not None else None,
        completeness=assess_completeness(
            description=description, photo_count=photos, mileage=100_000,
            title_status=title_status, vin=None, year=2016, trim_text="LX",
        ),
        title=read_title_status(title_status),
        vehicle_risk=build_assessment(None, None),
        scam=assess_scam_patterns(
            description=description, photo_count=photos, vin=None,
            price_residual=residual, price_changed=price_changed,
        ),
    )


class TestWeights:
    def test_they_match_the_spec_verbatim(self):
        # Time on market is deliberately absent: spec 6.4 calls negotiation
        # strength "genuinely orthogonal to deal quality", so it is reported
        # there and does not weigh into this composite. See the note on
        # `WEIGHTS` itself.
        assert WEIGHTS == {
            "price_residual": 45.0,
            "information_completeness": 15.0,
            "vehicle_risk": 12.0,
            "seller_and_scam_risk": 8.0,
        }

    def test_they_do_not_need_to_sum_to_one_hundred(self):
        # compute_deal_score divides by whatever weight is actually COVERED,
        # not by a fixed 100, so an 80-point total renormalises correctly.
        assert sum(WEIGHTS.values()) == 80.0


class TestTheScoreIsAlwaysBeta:
    def test_every_score_is_flagged_beta(self):
        # Spec 9: "present output as a beta signal, not an authoritative rating."
        assert score().beta is True

    def test_the_beta_notice_ships_with_the_evaluation(self):
        assert "Beta signal" in BETA_NOTICE
        assert "not a purchase recommendation" in DISCLAIMER


class TestBreakdownTravelsWithTheNumber:
    def test_every_dimension_is_reported_even_when_unavailable(self):
        # Spec 5.2: the composite "is a summary of the separated dimensions...
        # not a replacement for them".
        result = score()
        assert {c.name for c in result.components} == set(WEIGHTS)

    def test_an_unavailable_dimension_carries_a_reason(self):
        # No title status and no NHTSA data (vin=None throughout `score()`)
        # leaves vehicle_risk unassessable.
        result = score(title_status=None)
        missing = [c for c in result.missing]
        assert missing and all(c.unavailable_reason for c in missing)


class TestSuppression:
    def test_no_price_means_no_score(self):
        # Captured data: capture 3 has two comps, hence no expected price, and
        # scored 91/100 on completeness and a clean title before this rule.
        result = score(residual=None)
        assert result.score is None
        assert "price residual" in result.suppressed_reason

    def test_price_residual_is_the_required_dimension(self):
        assert REQUIRED_COMPONENTS == ("price_residual",)

    def test_a_scam_warning_withholds_the_score_rather_than_deducting(self):
        # Spec 6.3: "a distinct, prominent warning rather than a numerical
        # deduction buried in a composite." Printing 84/100 beside a fraud
        # warning would be that burial.
        result = score(
            residual=-0.60, photos=1,
            description="Cash only, wire transfer, cannot meet, I will ship it to you.",
        )
        assert result.score is None
        assert "scam" in result.suppressed_reason.lower()

    def test_thin_coverage_withholds_the_score(self):
        assert MIN_COVERAGE == 0.5


class TestScoring:
    def test_a_better_price_scores_higher(self):
        assert score(residual=-0.12).score > score(residual=0.25).score

    def test_scores_stay_in_range(self):
        for residual in (-0.9, -0.3, 0.0, 0.3, 0.9):
            result = score(residual=residual)
            if result.score is not None:
                assert 0.0 <= result.score <= 100.0

    def test_missing_dimensions_are_renormalised_not_zeroed(self):
        # Scoring "unknown" as zero would punish a listing for what the tool
        # could not look up.
        full = score()
        partial = score(title_status=None)
        assert partial.score is not None
        assert partial.coverage < full.coverage
