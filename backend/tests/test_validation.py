import pytest
from pydantic import ValidationError

from app.schemas import CaptureIn, ObservationIn, SellerIn
from tests.conftest import capture_payload, observation


@pytest.mark.parametrize("vin", ["4T1BF1FK5EU12345I", "4T1BF1FK5EU12345O", "4T1BF1FK5EU12345Q"])
def test_vin_rejects_i_o_q(vin):
    """Spec 4.2: 17 characters, excluding I, O and Q."""
    with pytest.raises(ValidationError):
        ObservationIn.model_validate({"role": "target", "source_listing_id": "1", "vin": vin})


def test_vin_rejects_wrong_length():
    with pytest.raises(ValidationError):
        ObservationIn.model_validate(
            {"role": "target", "source_listing_id": "1", "vin": "4T1BF1FK5EU12345"}
        )


def test_vin_is_upper_cased():
    obs = ObservationIn.model_validate(
        {"role": "target", "source_listing_id": "1", "vin": "4t1bf1fk5eu123456"}
    )
    assert obs.vin == "4T1BF1FK5EU123456"


def test_seller_hash_must_be_sha256_hex():
    with pytest.raises(ValidationError):
        SellerIn.model_validate({"seller_hash": "not-a-hash", "hash_version": 1})


def test_seller_rejects_identity_fields():
    """Spec 8.2: nothing beyond a hash and a count may be sent, and a client
    trying to send more must fail loudly rather than have it silently dropped."""
    for extra in ("display_name", "profile_url", "profile_photo", "join_date"):
        with pytest.raises(ValidationError):
            SellerIn.model_validate({"seller_hash": "a" * 64, "hash_version": 1, extra: "x"})


def test_unknown_observation_fields_are_rejected():
    with pytest.raises(ValidationError):
        ObservationIn.model_validate(
            {"role": "target", "source_listing_id": "1", "seller_name": "Jane"}
        )


def test_target_role_must_be_target():
    with pytest.raises(ValidationError):
        CaptureIn.model_validate(capture_payload(target=observation(role="comp")))


def test_comp_role_must_be_comp():
    with pytest.raises(ValidationError):
        CaptureIn.model_validate(capture_payload(comps=[observation(role="target")]))


def test_negative_price_rejected():
    with pytest.raises(ValidationError):
        ObservationIn.model_validate(
            {"role": "target", "source_listing_id": "1", "price_cents": -1}
        )


def test_implausible_year_rejected():
    with pytest.raises(ValidationError):
        ObservationIn.model_validate({"role": "target", "source_listing_id": "1", "year": 1492})
