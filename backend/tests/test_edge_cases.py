"""The step-2 success criterion names these explicitly: missing mileage, empty
description, single photo, no price. They must persist as nulls rather than
being rejected — a listing with no price is real data about a real listing."""

import pytest
from sqlalchemy import select

from app.models import ListingObservation
from app.schemas import CaptureIn, ObservationIn
from app.services.ingest import ingest_capture
from tests.conftest import capture_payload, observation


def _ingest(session, payload):
    result = ingest_capture(session, CaptureIn.model_validate(payload))
    session.commit()
    return result


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("price_cents", None),
        ("mileage", None),
        ("description", ""),
        ("photo_count", 1),
        ("photo_count", 0),
        ("year", None),
        ("title_status", None),
        ("trim_text", None),
        ("posted_at", None),
        ("location_text", None),
        ("seller", None),
    ],
)
def test_missing_field_persists_as_null(session, field, value):
    _ingest(session, capture_payload(target=observation(**{field: value})))
    row = session.scalar(select(ListingObservation))
    assert row is not None

    if field == "seller":
        assert row.seller_id is None
    elif field == "description":
        assert row.description == ""
    else:
        assert getattr(row, field) == value


def test_missing_vin_leaves_the_listing_identity_without_one(session):
    """VIN is a fact about the vehicle, so it lives on `listings`, not on the
    per-sighting observation row."""
    from app.models import Listing

    _ingest(session, capture_payload(target=observation(vin=None)))
    assert session.scalar(select(Listing.vin)) is None


def test_almost_entirely_empty_listing_still_persists(session):
    """A card that yielded nothing but an id and a URL is still an observation:
    it is evidence the listing existed at this timestamp."""
    minimal = {
        "source_listing_id": "999",
        "listing_url": "https://www.facebook.com/marketplace/item/999/",
        "role": "target",
        "field_strategies": {},
    }
    result = _ingest(session, capture_payload(target=minimal))

    assert result.observations_written == 1
    row = session.scalar(select(ListingObservation))
    assert row.price_cents is None and row.mileage is None and row.make is None


def test_source_listing_id_is_required():
    with pytest.raises(ValueError):
        ObservationIn.model_validate({"role": "target", "source_listing_id": ""})


def test_km_mileage_unit_is_preserved(session):
    _ingest(session, capture_payload(target=observation(mileage=155_000, mileage_unit="km")))
    row = session.scalar(select(ListingObservation))
    assert (row.mileage, row.mileage_unit) == (155_000, "km")


def test_blank_strings_normalise_to_null(session):
    _ingest(session, capture_payload(target=observation(make="  ", location_text="")))
    row = session.scalar(select(ListingObservation))
    assert row.make is None
    assert row.location_text is None


def test_price_changed_tracks_three_states(session):
    for i, value in enumerate([True, False, None]):
        _ingest(
            session,
            capture_payload(
                target=observation(source_listing_id=f"5000{i}", price_changed=value)
            ),
        )
    values = session.scalars(
        select(ListingObservation.price_changed).order_by(ListingObservation.id)
    ).all()
    assert values == [True, False, None]
