from datetime import UTC, datetime, timedelta

from sqlalchemy import select

from app.models import Capture, ExtractionReport, Listing, ListingObservation, Seller
from app.retention import enforce_retention
from app.schemas import CaptureIn
from app.services.ingest import ingest_capture
from tests.conftest import capture_payload, observation

NOW = datetime(2026, 7, 25, tzinfo=UTC)


def _ingest(session, payload):
    ingest_capture(session, CaptureIn.model_validate(payload))
    session.commit()


def test_expired_observations_and_their_identities_are_removed(session):
    _ingest(session, capture_payload(captured_at=NOW - timedelta(days=500)))

    result = enforce_retention(session, days=400, now=NOW)

    assert result.listing_observations == 1
    assert session.scalars(select(ListingObservation)).all() == []
    assert session.scalars(select(Capture)).all() == []
    # No orphaned identifiers left behind once the evidence has aged out.
    assert session.scalars(select(Listing)).all() == []
    assert session.scalars(select(Seller)).all() == []


def test_recent_data_is_untouched(session):
    _ingest(session, capture_payload(captured_at=NOW - timedelta(days=10)))

    enforce_retention(session, days=400, now=NOW)

    assert len(session.scalars(select(ListingObservation)).all()) == 1
    assert len(session.scalars(select(Listing)).all()) == 1


def test_listing_survives_while_any_observation_is_in_window(session):
    _ingest(
        session,
        capture_payload(captured_at=NOW - timedelta(days=500)),
    )
    _ingest(
        session,
        capture_payload(captured_at=NOW - timedelta(days=10)),
    )

    enforce_retention(session, days=400, now=NOW)

    assert len(session.scalars(select(ListingObservation)).all()) == 1
    assert len(session.scalars(select(Listing)).all()) == 1, (
        "the identity must persist as long as any sighting of it does"
    )


def test_extraction_reports_expire_too(session):
    _ingest(
        session,
        capture_payload(
            captured_at=NOW - timedelta(days=500),
            extraction_report=[
                {
                    "scope": "target",
                    "field_name": "mileage",
                    "status": "missing",
                    "expectation": "expected",
                }
            ],
        ),
    )

    enforce_retention(session, days=400, now=NOW)
    assert session.scalars(select(ExtractionReport)).all() == []


def test_dry_run_reports_without_deleting(session):
    _ingest(session, capture_payload(captured_at=NOW - timedelta(days=500)))

    result = enforce_retention(session, days=400, dry_run=True, now=NOW)

    assert result.dry_run is True
    assert result.listing_observations == 1
    assert len(session.scalars(select(ListingObservation)).all()) == 1


def test_comp_observations_expire_with_their_capture(session):
    comps = [observation(role="comp", source_listing_id=f"8000{i}") for i in range(4)]
    _ingest(session, capture_payload(comps=comps, captured_at=NOW - timedelta(days=500)))

    result = enforce_retention(session, days=400, now=NOW)

    assert result.listing_observations == 5
    assert session.scalars(select(Listing)).all() == []
