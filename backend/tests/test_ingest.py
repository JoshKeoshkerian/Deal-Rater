from datetime import UTC, datetime

import pytest
from sqlalchemy import select

from app.models import Capture, Listing, ListingObservation, Seller, SellerObservation
from app.schemas import CaptureIn
from app.services.ingest import ingest_capture
from tests.conftest import CAPTURED_AT, capture_payload, observation


def _ingest(session, payload: dict):
    result = ingest_capture(session, CaptureIn.model_validate(payload))
    session.commit()
    return result


def test_capture_persists_target_and_comps(session):
    comps = [observation(role="comp", source_listing_id=f"20000000000{i:04d}") for i in range(5)]
    result = _ingest(session, capture_payload(comps=comps))

    assert result.observations_written == 6
    assert result.listings_ingested == 6
    assert session.scalar(select(Capture.comp_count)) == 5

    roles = session.scalars(select(ListingObservation.role)).all()
    assert sorted(roles) == ["comp"] * 5 + ["target"]


def test_repeat_observation_appends_a_row_rather_than_updating(session):
    """Spec 4.4: every sighting is a timestamped row."""
    first = datetime(2026, 7, 1, 12, 0, tzinfo=UTC)
    second = datetime(2026, 7, 20, 12, 0, tzinfo=UTC)

    _ingest(session, capture_payload(captured_at=first))
    _ingest(
        session,
        capture_payload(target=observation(price_cents=1_190_000), captured_at=second),
    )

    listings = session.scalars(select(Listing)).all()
    assert len(listings) == 1, "same source_listing_id must resolve to one identity row"

    observations = session.scalars(
        select(ListingObservation).order_by(ListingObservation.observed_at)
    ).all()
    assert [o.price_cents for o in observations] == [1_290_000, 1_190_000]

    listing = listings[0]
    assert listing.first_observed_at.replace(tzinfo=UTC) == first
    assert listing.last_observed_at.replace(tzinfo=UTC) == second


def test_out_of_order_capture_does_not_move_last_observed_backwards(session):
    late = datetime(2026, 7, 20, 12, 0, tzinfo=UTC)
    early = datetime(2026, 7, 1, 12, 0, tzinfo=UTC)

    _ingest(session, capture_payload(captured_at=late))
    _ingest(session, capture_payload(captured_at=early))

    listing = session.scalar(select(Listing))
    assert listing.last_observed_at.replace(tzinfo=UTC) == late
    assert listing.first_observed_at.replace(tzinfo=UTC) == early


def test_replayed_capture_is_idempotent(session):
    payload = capture_payload(client_capture_id="11111111-1111-4111-8111-111111111111")

    first = _ingest(session, payload)
    second = _ingest(session, payload)

    assert first.duplicate is False
    assert second.duplicate is True
    assert second.capture.id == first.capture.id
    assert second.observations_written == 1
    assert session.scalar(select(Listing.id)) is not None
    assert len(session.scalars(select(ListingObservation)).all()) == 1


def test_target_appearing_in_its_own_comp_set_is_written_once(session):
    """Marketplace search frequently surfaces the listing being evaluated."""
    target = observation(source_listing_id="777")
    comps = [observation(role="comp", source_listing_id="777")]

    result = _ingest(session, capture_payload(target=target, comps=comps))

    assert result.observations_written == 1
    assert len(session.scalars(select(ListingObservation)).all()) == 1


def test_vin_is_retained_once_recovered(session):
    _ingest(session, capture_payload(target=observation(vin=None)))
    assert session.scalar(select(Listing.vin)) is None

    _ingest(session, capture_payload(target=observation(vin="4T1BF1FK5EU123456")))
    assert session.scalar(select(Listing.vin)) == "4T1BF1FK5EU123456"


def test_seller_is_reduced_to_a_hash_and_a_count(session):
    _ingest(session, capture_payload())

    seller = session.scalar(select(Seller))
    assert seller.seller_hash == "a" * 64
    assert seller.hash_version == 1

    # The only seller columns that exist are the ones the spec permits.
    columns = {c.name for c in Seller.__table__.columns}
    assert columns == {"id", "seller_hash", "hash_version", "first_seen_at", "last_seen_at"}

    seller_obs = session.scalar(select(SellerObservation))
    assert seller_obs.active_vehicle_listing_count == 1
    assert seller_obs.rating_average is None
    assert seller_obs.rating_count is None


def test_seller_rating_is_persisted_when_present(session):
    target = observation(
        seller={
            "seller_hash": "a" * 64,
            "hash_version": 1,
            "active_vehicle_listing_count": 1,
            "rating_average": 2.4,
            "rating_count": 7,
        },
    )
    _ingest(session, capture_payload(target=target))

    seller_obs = session.scalar(select(SellerObservation))
    assert float(seller_obs.rating_average) == pytest.approx(2.4)
    assert seller_obs.rating_count == 7


def test_seller_observation_written_once_per_capture_for_repeated_seller(session):
    comps = [
        observation(role="comp", source_listing_id=f"3000{i}")
        for i in range(3)
    ]
    _ingest(session, capture_payload(comps=comps))

    # One seller hash across four listings -> one seller row, one observation.
    assert len(session.scalars(select(Seller)).all()) == 1
    assert len(session.scalars(select(SellerObservation)).all()) == 1


def test_required_field_failure_marks_the_capture_as_degraded(session):
    """Only an unambiguous scraper failure flips the flag."""
    report = [
        {
            "scope": "target",
            "field_name": "listing_payload",
            "status": "missing",
            "expectation": "required",
            "strategies_attempted": ["json_payload", "aria_dom", "text_pattern"],
            "page_signature": "abc123",
        }
    ]
    result = _ingest(session, capture_payload(extraction_report=report))

    assert result.capture.extraction_ok is False
    assert result.extraction_reports_written == 1


@pytest.mark.parametrize("expectation", ["expected", "optional"])
def test_non_required_issues_are_recorded_without_raising_an_alarm(session, expectation):
    """A listing with no price is real data, not breakage. The report row still
    gets written — the fill rate over time is the signal, not the one event."""
    report = [
        {
            "scope": "target",
            "field_name": "price_cents",
            "status": "missing",
            "expectation": expectation,
            "strategies_attempted": ["json_payload", "text_pattern"],
        }
    ]
    result = _ingest(session, capture_payload(extraction_report=report))

    assert result.capture.extraction_ok is True
    assert result.extraction_reports_written == 1


def test_field_strategies_are_recorded_per_observation(session):
    _ingest(session, capture_payload())
    strategies = session.scalar(select(ListingObservation.field_strategies))
    assert strategies["price_cents"] == "json_payload"
    assert strategies["mileage"] == "text_pattern"


def test_captured_at_drives_observed_at_not_server_time(session):
    result = _ingest(session, capture_payload())
    observation_row = session.scalar(select(ListingObservation))
    assert observation_row.observed_at.replace(tzinfo=UTC) == CAPTURED_AT
    assert result.capture.received_at is not None
