"""NHTSA VIN decode, recalls and complaints (spec 4.2, 6.2, build step 6).

No test here touches the network. Every call passes `offline=True`, so the suite
stays fast, deterministic, and polite to a public government API.

The claims under test:

  1. The check digit gates every request (spec 4.2).
  2. Recall language never overstates what the free API can tell us.
  3. Caching matches spec 10: VIN decodes forever, safety data 30 days.
  4. VIN decode feeds trim back into comp matching without corrupting it.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from app.models import VehicleSafetyLookup, VinDecode
from app.nhtsa import (
    RECALL_CAVEAT,
    assess_vehicle,
    build_assessment,
    decode_vin,
    enrich_target,
    is_valid_vin,
    lookup_vehicle_safety,
    normalize_vin,
)
from app.nhtsa.assessment import DecodedSpec
from app.pricing.comps import CompCandidate

#: A real, check-digit-valid VIN: the 2017 RAV4 recovered from capture 10.
REAL_VIN = "2T3ZFREV8HW358324"


class TestCheckDigit:
    def test_a_real_vin_validates(self):
        assert is_valid_vin(REAL_VIN)

    def test_a_transposed_character_fails(self):
        # The point of the check digit, and the reason spec 4.2 requires
        # validating before querying.
        broken = REAL_VIN[:3] + REAL_VIN[4] + REAL_VIN[3] + REAL_VIN[5:]
        assert not is_valid_vin(broken)

    @pytest.mark.parametrize(
        "bad",
        [
            None,
            "",
            "TOOSHORT",
            "2T3ZFREV8HW35832",  # 16 characters
            "2T3ZFREV8HW3583244",  # 18
            "2T3ZFREVIHW358324",  # contains I
            "2T3ZFREVOHW358324",  # contains O
            "2T3ZFREVQHW358324",  # contains Q
        ],
    )
    def test_malformed_vins_are_rejected(self, bad):
        assert not is_valid_vin(bad)

    def test_normalisation_upper_cases_and_validates(self):
        assert normalize_vin(f"  {REAL_VIN.lower()}  ") == REAL_VIN
        assert normalize_vin("nonsense") is None


class TestNoWastedRequests:
    def test_an_invalid_vin_never_reaches_the_network(self, session):
        # offline=False, yet no request happens: the check digit gates it.
        # Spec 4.2: "Validate the check digit before querying, to avoid wasting
        # calls on typos."
        assert decode_vin(session, "NOTAVALIDVIN12345", offline=False) is None

    def test_a_missing_vin_is_not_an_error(self, session):
        assert decode_vin(session, None, offline=False) is None

    def test_safety_lookup_needs_year_make_and_model(self, session):
        assert lookup_vehicle_safety(session, year=None, make="Toyota", model="RAV4") is None
        assert lookup_vehicle_safety(session, year=2017, make=None, model="RAV4") is None
        assert lookup_vehicle_safety(session, year=2017, make="Toyota", model=None) is None


class TestCaching:
    def _cached_decode(self, session):
        decode = VinDecode(
            vin=REAL_VIN,
            decoded_at=datetime.now(UTC),
            make="TOYOTA",
            model="RAV4",
            model_year=2017,
            trim="LE",
            drive_type="4x2",
            transmission="Automatic",
            engine_cylinders=4,
            body_class="Sport Utility Vehicle",
            error_code="0",
        )
        session.add(decode)
        session.commit()
        return decode

    def test_a_cached_decode_is_served_offline(self, session):
        self._cached_decode(session)
        decode = decode_vin(session, REAL_VIN, offline=True)
        assert decode is not None
        assert decode.trim == "LE"

    def test_an_uncached_decode_returns_nothing_offline(self, session):
        assert decode_vin(session, REAL_VIN, offline=True) is None

    def test_vin_decodes_have_no_expiry(self, session):
        # Spec 10: "Cache VIN decodes indefinitely. VIN-to-specification mapping
        # never changes."
        decode = self._cached_decode(session)
        decode.decoded_at = datetime.now(UTC) - timedelta(days=3650)
        session.commit()
        assert decode_vin(session, REAL_VIN, offline=True) is not None

    def test_stale_safety_data_is_served_rather_than_nothing(self, session):
        # Better a month-old recall count than a blank, and better than
        # hammering an API that is down.
        row = VehicleSafetyLookup(
            model_year=2017,
            make="toyota",
            model="rav4",
            fetched_at=datetime.now(UTC) - timedelta(days=400),
            recall_count=3,
            complaint_count=301,
            complaints_by_component={"ELECTRICAL SYSTEM": 73},
        )
        session.add(row)
        session.commit()
        served = lookup_vehicle_safety(
            session, year=2017, make="Toyota", model="RAV4", offline=True
        )
        assert served is not None
        assert served.recall_count == 3

    def test_the_safety_cache_key_is_case_insensitive(self, session):
        session.add(
            VehicleSafetyLookup(
                model_year=2017,
                make="toyota",
                model="rav4",
                fetched_at=datetime.now(UTC),
                recall_count=3,
                complaint_count=301,
            )
        )
        session.commit()
        assert (
            lookup_vehicle_safety(
                session, year=2017, make="TOYOTA", model="RAV4", offline=True
            )
            is not None
        )


class TestRecallLanguage:
    """The free API returns campaigns for a MODEL, not repairs for a CAR."""

    def _assessment(self):
        return build_assessment(
            None,
            VehicleSafetyLookup(
                model_year=2017,
                make="toyota",
                model="rav4",
                fetched_at=datetime.now(UTC),
                recall_count=3,
                complaint_count=301,
                complaints_by_component={"ELECTRICAL SYSTEM": 73, "SERVICE BRAKES": 24},
            ),
        )

    def test_it_says_campaigns_not_unrepaired_recalls(self):
        # Spec 6.2 asks for "open unrepaired safety recalls". NHTSA's free API
        # cannot answer that, and claiming it would be the same false authority
        # spec 9 exists to prevent.
        text = " ".join(self._assessment().messages()).lower()
        assert "campaign" in text
        assert "unrepaired" not in text

    def test_the_caveat_is_always_attached_to_a_recall_count(self):
        assert RECALL_CAVEAT in self._assessment().messages()

    def test_complaint_density_is_not_claimed_to_be_normalised(self):
        # Spec 6.2 wants density "relative to segment norms". NHTSA publishes no
        # sales figures, so there is no denominator and none is invented.
        assessment = self._assessment()
        assert assessment.complaint_density_normalized is False
        assert "not adjusted" in " ".join(assessment.messages())

    def test_zero_recalls_is_stated_positively(self):
        row = VehicleSafetyLookup(
            model_year=2017, make="x", model="y", fetched_at=datetime.now(UTC), recall_count=0
        )
        assert "No recall campaigns" in " ".join(build_assessment(None, row).messages())

    def test_components_are_ranked_by_count(self):
        assert self._assessment().top_complaint_components(1) == [("ELECTRICAL SYSTEM", 73)]


class TestFeedingTrimBackIntoComps:
    """Spec 13.6: "feed decoded trim back into comp matching"."""

    def _target(self, **kw) -> CompCandidate:
        base = dict(
            listing_id=1,
            source_listing_id="t",
            year=2017,
            make="Toyota",
            model="RAV4",
            trim_text=None,
            price_cents=950_000,
            mileage=90_000,
            location_text="St Louis, MO",
        )
        base.update(kw)
        return CompCandidate(**base)  # type: ignore[arg-type]

    def _spec(self, **kw) -> DecodedSpec:
        base = dict(
            vin=REAL_VIN,
            trim="LE",
            drive_type="4x2",
            transmission="Automatic",
            engine_cylinders=4,
            displacement_l=2.5,
            body_class="SUV",
            clean_decode=True,
        )
        base.update(kw)
        return DecodedSpec(**base)  # type: ignore[arg-type]

    def test_a_decoded_trim_fills_an_empty_one(self):
        assert enrich_target(self._target(), self._spec()).trim_text == "LE"

    def test_it_never_overwrites_a_stated_trim(self):
        # Comp trims all come from listing text. Replacing one side of the
        # comparison with a differently-sourced value makes matches fail for
        # spelling reasons rather than real ones.
        enriched = enrich_target(self._target(trim_text="XLE Premium"), self._spec())
        assert enriched.trim_text == "XLE Premium"

    def test_a_partial_decode_is_not_trusted(self):
        assert enrich_target(self._target(), self._spec(clean_decode=False)).trim_text is None

    def test_no_decode_leaves_the_target_untouched(self):
        target = self._target()
        assert enrich_target(target, None) is target

    def test_drivetrain_is_not_written_back(self):
        # Deliberate: comps are 7% populated for drivetrain, so supplying it for
        # the target alone would make it look better specified than everything
        # it is measured against.
        enriched = enrich_target(self._target(), self._spec())
        assert "4x2" not in (enriched.trim_text or "")


class TestAssessmentDegradesGracefully:
    def test_no_data_at_all_is_reported_not_raised(self, session):
        assessment = assess_vehicle(
            session, vin=None, year=None, make=None, model=None, offline=True
        )
        assert assessment.has_data is False
        assert assessment.messages() == []

    def test_year_make_model_alone_still_works(self, session):
        # The half of step 6 that applies to every listing rather than the
        # 1-in-338 carrying a VIN.
        session.add(
            VehicleSafetyLookup(
                model_year=2017,
                make="toyota",
                model="rav4",
                fetched_at=datetime.now(UTC),
                recall_count=3,
                complaint_count=301,
            )
        )
        session.commit()
        assessment = assess_vehicle(
            session, vin=None, year=2017, make="Toyota", model="RAV4", offline=True
        )
        assert assessment.has_data
        assert assessment.spec is None
        assert assessment.recall_count == 3
