"""Loader-level fixups applied before comp filtering ever runs.

Regression test for a defect found in real captured data: every Tesla listing
carries `model="Model"` regardless of whether it's a 3, S, X or Y, with the
distinguishing letter sitting at the front of `trim_text` instead. Comp
filtering (spec 4.3) matches on `model` and never excludes on trim, so left
alone this pools a Model S in as a valid comp for a Model 3 -- confirmed on
captured data as a $0-$34,399 expected range for a $14,000 listing.
"""

from __future__ import annotations

import pytest

from app.pricing.loader import _resolve_tesla_model, load_captures
from app.schemas import CaptureIn
from app.services.ingest import ingest_capture
from tests.conftest import capture_payload, observation


class TestTeslaModelResolution:
    def test_the_letter_moves_from_trim_into_model(self):
        assert _resolve_tesla_model("Tesla", "Model", "3 Long Range Sedan 4D") == (
            "Model 3",
            "Long Range Sedan 4D",
        )

    def test_all_four_letters_are_recognised(self):
        for letter in ("3", "S", "X", "Y"):
            model, _ = _resolve_tesla_model("Tesla", "Model", letter)
            assert model == f"Model {letter}"

    def test_it_is_case_insensitive_on_make_model_and_letter(self):
        assert _resolve_tesla_model("tesla", "model", "s 70d awd") == ("Model S", "70d awd")

    def test_no_trailing_trim_becomes_no_trim_rather_than_empty_string(self):
        assert _resolve_tesla_model("Tesla", "Model", "3") == ("Model 3", None)

    def test_a_missing_trim_leaves_the_generic_model_alone(self):
        # Nothing to disambiguate with -- better to say "Model" than to guess.
        assert _resolve_tesla_model("Tesla", "Model", None) == ("Model", None)

    def test_a_model_that_is_already_specific_is_untouched(self):
        assert _resolve_tesla_model("Tesla", "Model Y", "Long Range") == (
            "Model Y",
            "Long Range",
        )

    def test_other_makes_are_never_touched(self):
        # "Civic" is not "Model", but this also guards against a make check
        # that accidentally matches on trim content rather than the make field.
        assert _resolve_tesla_model("Honda", "Civic", "EX-L") == ("Civic", "EX-L")

    def test_a_missing_make_does_not_crash_or_match(self):
        assert _resolve_tesla_model(None, "Model", "3") == ("Model", "3")

    def test_a_missing_model_passes_through(self):
        assert _resolve_tesla_model("Tesla", None, "3") == (None, "3")

    def test_an_unrecognised_first_token_is_left_alone(self):
        # Whatever this is, it is not one of the four known letters, so
        # guessing would risk inventing a distinction that is not real.
        assert _resolve_tesla_model("Tesla", "Model", "Plaid Long Range") == (
            "Model",
            "Plaid Long Range",
        )


class TestLoadCapturesSellerRating:
    """The seller's star rating (spec 6.3) reaches `StoredCapture` alongside
    the target listing it was observed with."""

    def _ingest(self, session, payload: dict):
        result = ingest_capture(session, CaptureIn.model_validate(payload))
        session.commit()
        return result

    def test_a_populated_rating_reaches_the_stored_capture(self, session):
        target = observation(
            seller={
                "seller_hash": "a" * 64,
                "hash_version": 1,
                "active_vehicle_listing_count": 1,
                "rating_average": 2.4,
                "rating_count": 7,
            },
        )
        self._ingest(session, capture_payload(target=target))

        [stored] = load_captures(session)
        assert stored.target_seller_rating_average == pytest.approx(2.4)
        assert stored.target_seller_rating_count == 7

    def test_no_rating_widget_leaves_both_fields_none(self, session):
        self._ingest(session, capture_payload())

        [stored] = load_captures(session)
        assert stored.target_seller_rating_average is None
        assert stored.target_seller_rating_count is None
