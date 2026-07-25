import pytest
from sqlalchemy import select

from app.models import ListingObservation
from app.schemas import CaptureIn
from app.services.ingest import ingest_capture
from app.services.redact import redact_contact_details
from tests.conftest import capture_payload, observation


@pytest.mark.parametrize(
    "text",
    [
        "call 918-555-0134",
        "call (918) 555-0134",
        "call 918.555.0134",
        "call 9185550134",
        "call +1 918 555 0134",
        "call 918 555 0134",
    ],
)
def test_phone_numbers_are_replaced(text):
    assert redact_contact_details(text) == "call [PHONE]"


def test_spelled_out_digits_are_replaced():
    result = redact_contact_details("nine one eight five five five oh one three four")
    assert "[PHONE]" in result
    assert "nine one eight" not in result


def test_email_is_replaced():
    assert redact_contact_details("email me at seller@example.com ok") == (
        "email me at [EMAIL] ok"
    )


def test_surrounding_language_survives():
    """The contact detail is the personal data; the phrasing around it is the
    scam and negotiation signal, and must not be collateral damage."""
    text = "Cash only, no lowballers. Text me at 918-555-0134, will not ship."
    result = redact_contact_details(text)
    assert result == "Cash only, no lowballers. Text me at [PHONE], will not ship."


def test_redaction_is_idempotent():
    once = redact_contact_details("call 918-555-0134 or seller@example.com")
    assert redact_contact_details(once) == once


@pytest.mark.parametrize(
    "text",
    [
        "asking 12500 obo",
        "runs great 189000 miles",
        "2014 Toyota Camry",
        "VIN 4T1BF1FK5EU123456",
    ],
)
def test_non_phone_numbers_are_left_alone(text):
    assert redact_contact_details(text) == text


def test_none_passes_through():
    assert redact_contact_details(None) is None


def test_backend_redacts_even_if_the_client_did_not(session):
    """The API cannot assume a well-behaved client and stays independent of any
    particular one (spec 8.1.4), so it redacts on the way in regardless."""
    payload = capture_payload(
        target=observation(description="Great car. Call me 918-555-0134 or me@example.com")
    )
    ingest_capture(session, CaptureIn.model_validate(payload))
    session.commit()

    stored = session.scalar(select(ListingObservation.description))
    assert "918" not in stored
    assert "example.com" not in stored
    assert "[PHONE]" in stored and "[EMAIL]" in stored
