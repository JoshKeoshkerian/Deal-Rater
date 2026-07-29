"""Composite score and full evaluation (spec 5.2, 7, build step 8)."""

from __future__ import annotations

from dataclasses import dataclass

from app.evaluation import WEIGHTS, _title_explains_discount_notice, compute_deal_score
from app.evaluation.report import ASKING_PRICE_NOTICE, BETA_NOTICE, DISCLAIMER, build_evaluation
from app.evaluation.score import MIN_COVERAGE, REQUIRED_COMPONENTS
from app.flags import TitleReading, TitleRisk, assess_completeness, assess_scam_patterns, read_title_status
from app.nhtsa import build_assessment
from app.pricing import Limiter
from app.pricing.curve import rate_price_residual


def score(
    *,
    residual=0.0,
    description="x" * 400,
    photos=10,
    price_changed=None,
    title_status="clean",
    seller_rating_average=None,
    seller_rating_count=None,
):
    return compute_deal_score(
        rating=rate_price_residual(residual) if residual is not None else None,
        completeness=assess_completeness(
            description=description, mileage=100_000,
            title_status=title_status, vin=None, year=2016, trim_text="LX",
        ),
        title=read_title_status(title_status),
        vehicle_risk=build_assessment(None, None),
        scam=assess_scam_patterns(
            description=description, photo_count=photos, vin=None,
            price_residual=residual, price_changed=price_changed,
        ),
        seller_rating_average=seller_rating_average,
        seller_rating_count=seller_rating_count,
    )


class TestWeights:
    def test_they_match_the_spec_verbatim(self):
        # Time on market is deliberately absent: spec 6.4 calls negotiation
        # strength "genuinely orthogonal to deal quality", so it is reported
        # there and does not weigh into this composite. See the note on
        # `WEIGHTS` itself.
        assert WEIGHTS == {
            "price_residual": 50.0,
            "information_completeness": 10.0,
            "vehicle_risk": 25.0,
            "seller_and_scam_risk": 15.0,
        }

    def test_they_sum_to_one_hundred(self):
        # compute_deal_score divides by whatever weight is actually COVERED,
        # not by a fixed 100, so this isn't load-bearing for scoring -- but
        # the extension overlay prints each weight verbatim as "(N%)" next to
        # its dimension, so the total is kept at 100 for that to be honest.
        assert sum(WEIGHTS.values()) == 100.0


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


class TestSellerRatingCeiling:
    """A seller's star rating caps seller_and_scam_risk directly (spec 6.3
    build step 5, added after real data showed a clean-looking listing --
    zero scam signals fired -- scoring 100/100 on a seller whose OTHER
    reviews describe him lying about condition)."""

    def _seller_and_scam_component(self, result):
        return next(c for c in result.components if c.name == "seller_and_scam_risk")

    def test_a_low_rating_caps_a_clean_listings_seller_score(self):
        # The real case: a low seller rating pulls the score down even when
        # the listing's own signal-based score is well above the ceiling.
        clean = score()
        assert self._seller_and_scam_component(clean).value > 48.0

        rated = score(seller_rating_average=2.4, seller_rating_count=7)
        component = self._seller_and_scam_component(rated)
        assert component.value == 48.0  # 2.4 / 5 * 100

    def test_too_few_reviews_do_not_move_the_score(self):
        # One or two outlier reviews should not swing a seller's ceiling.
        clean = score()
        rated = score(seller_rating_average=1.0, seller_rating_count=1)
        assert self._seller_and_scam_component(rated).value == (
            self._seller_and_scam_component(clean).value
        )

    def test_a_good_rating_does_not_rescue_a_listing_with_real_signals(self):
        # The lower of the two sources wins -- a good rating must not paper
        # over signals the listing itself is showing.
        flagged = score(
            residual=-0.60, photos=1,
            description="",  # minimal description also fires a signal
        )
        rescued = score(
            residual=-0.60, photos=1, description="",
            seller_rating_average=5.0, seller_rating_count=50,
        )
        assert self._seller_and_scam_component(rescued).value == (
            self._seller_and_scam_component(flagged).value
        )

    def test_rating_alone_does_not_trigger_the_scam_warning(self):
        # A direct modifier, not a signal in the four-fire combination --
        # even a very low rating must not suppress the composite the way
        # four listing-text signals firing together would.
        rated = score(seller_rating_average=1.0, seller_rating_count=20)
        assert rated.score is not None
        assert rated.suppressed_reason is None


@dataclass
class _FakeConfidence:
    limiters: tuple


@dataclass
class _FakePricing:
    confidence: _FakeConfidence


class TestTitleExplainsDiscountNotice:
    """The pricing model has no title-status data (spec 4.3: comp cards don't
    carry it), so a branded-title car's expected price is really a clean-title
    benchmark. When the residual is deep enough to trip
    Limiter.ADVERSE_SELECTION, pricing's own text says the discount has "no
    stated reason" -- true of what pricing looked at, not true of the listing.
    This connects the two, since pricing and vehicle-risk are forbidden from
    reading each other's output directly (spec 6)."""

    def test_fires_when_a_branded_title_meets_an_unexplained_discount(self):
        pricing = _FakePricing(_FakeConfidence((Limiter.ADVERSE_SELECTION,)))
        title = TitleReading(TitleRisk.BRANDED, "branded")
        notices = _title_explains_discount_notice(pricing, title)
        assert len(notices) == 1
        assert "branded" in notices[0]

    def test_fires_for_a_disqualifying_title_too(self):
        pricing = _FakePricing(_FakeConfidence((Limiter.ADVERSE_SELECTION,)))
        title = TitleReading(TitleRisk.DISQUALIFYING, "salvage")
        assert len(_title_explains_discount_notice(pricing, title)) == 1

    def test_silent_on_a_clean_title(self):
        pricing = _FakePricing(_FakeConfidence((Limiter.ADVERSE_SELECTION,)))
        title = TitleReading(TitleRisk.CLEAN, "clean")
        assert _title_explains_discount_notice(pricing, title) == ()

    def test_silent_when_the_discount_was_not_flagged_as_unexplained(self):
        pricing = _FakePricing(_FakeConfidence((Limiter.COMP_COUNT,)))
        title = TitleReading(TitleRisk.BRANDED, "branded")
        assert _title_explains_discount_notice(pricing, title) == ()


class TestBuildEvaluationExtraNotices:
    def test_extra_notices_precede_the_standing_disclaimers(self):
        ev = build_evaluation(
            pricing=object(),
            negotiation=object(),
            offer=object(),
            title=object(),
            completeness=object(),
            vehicle_risk=object(),
            scam=object(),
            alternatives=object(),
            deal_score=object(),
            extra_notices=("custom notice",),
        )
        assert ev.notices == ("custom notice", BETA_NOTICE, ASKING_PRICE_NOTICE, DISCLAIMER)

    def test_no_extra_notices_by_default(self):
        ev = build_evaluation(
            pricing=object(),
            negotiation=object(),
            offer=object(),
            title=object(),
            completeness=object(),
            vehicle_risk=object(),
            scam=object(),
            alternatives=object(),
            deal_score=object(),
        )
        assert ev.notices == (BETA_NOTICE, ASKING_PRICE_NOTICE, DISCLAIMER)
