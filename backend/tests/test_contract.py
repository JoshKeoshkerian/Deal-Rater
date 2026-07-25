"""The backend half of the contract check.

`extension/tests/contract.test.ts` asserts the extension emits exactly the
shape in `contract/capture-example.json`. This asserts the API accepts it, with
`extra="forbid"` in force, so a field added on one side without the other fails
here rather than as a 422 in production.
"""

import json
from pathlib import Path

import pytest
from sqlalchemy import select

from app.models import Capture, ListingObservation
from app.schemas import CaptureIn

EXAMPLE_PATH = Path(__file__).resolve().parents[2] / "contract" / "capture-example.json"


@pytest.fixture
def example() -> dict:
    return json.loads(EXAMPLE_PATH.read_text())


def test_example_validates(example):
    payload = CaptureIn.model_validate(example)
    assert payload.target.source_listing_id == "100000000000001"
    assert len(payload.comps) == 1


def test_example_round_trips_through_the_api(client, example):
    response = client.post("/v1/captures", json=example)

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["observations_written"] == 2
    assert body["extraction_reports_written"] == 2
    assert body["extraction_ok"] is True


def test_example_persists_every_field_it_declares(client, session, example):
    client.post("/v1/captures", json=example)

    target = session.scalar(
        select(ListingObservation).where(ListingObservation.role == "target")
    )
    assert target.price_cents == 1_290_000
    assert target.mileage == 96_400
    assert target.photo_count == 12
    assert target.location_text == "Tulsa, OK"
    assert target.posted_relative_text == "Listed 3 weeks ago"
    assert target.field_strategies["price_cents"] == "json_payload"

    capture = session.scalar(select(Capture))
    assert capture.comp_search_query["query"] == "2014 Toyota Camry"


def test_the_example_carries_no_contact_details(example):
    """The example is documentation as well as a test; it should not model
    storing something the client is supposed to strip."""
    description = example["target"]["description"]
    assert "[PHONE]" in description
    assert not any(char.isdigit() for char in description.split("[PHONE]")[0])


def test_an_extra_field_anywhere_is_rejected(example):
    example["target"]["seller_display_name"] = "Jane"
    with pytest.raises(ValueError):
        CaptureIn.model_validate(example)


def test_an_extra_seller_field_is_rejected(example):
    example["target"]["seller"]["profile_url"] = "https://facebook.com/jane"
    with pytest.raises(ValueError):
        CaptureIn.model_validate(example)
