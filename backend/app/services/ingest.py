"""Capture ingestion.

Turns one posted capture into: identity upserts, append-only observation rows,
and telemetry rows. Never updates a fact in place (spec 4.4).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import (
    Capture,
    ExtractionReport,
    Listing,
    ListingObservation,
    Seller,
    SellerObservation,
)
from app.schemas import CaptureIn, ObservationIn, SellerIn
from app.services.redact import redact_contact_details
from app.services.relisting_key import compute_relisting_key

# Only `required` flips extraction_ok. A missing `expected` field is often real
# data — a listing genuinely has no price, a card genuinely shows no mileage —
# so treating it as breakage would make the flag fire constantly and mean
# nothing. Those still produce report rows; what you watch there is the fill
# rate over time, not the individual event.
BLOCKING_EXPECTATIONS = frozenset({"required"})


def _as_utc(value: datetime) -> datetime:
    """Normalise to an aware UTC datetime before comparing.

    Not every backend round-trips timezone information — SQLite drops it
    entirely — so a value read back from the database can be naive even though
    it was written aware. Comparing the two raises, so coerce first.
    """
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


@dataclass
class IngestResult:
    capture: Capture
    duplicate: bool
    listings_ingested: int
    observations_written: int
    extraction_reports_written: int


def ingest_capture(session: Session, payload: CaptureIn) -> IngestResult:
    existing = session.scalar(
        select(Capture).where(Capture.client_capture_id == payload.capture.client_capture_id)
    )
    if existing is not None:
        # Replays happen: a client retries after a timeout that in fact succeeded.
        # Returning the original capture keeps the observation series free of
        # duplicate rows that would look like two sightings of the same listing.
        return IngestResult(
            capture=existing,
            duplicate=True,
            listings_ingested=0,
            observations_written=_count_observations(session, existing.id),
            extraction_reports_written=0,
        )

    now = datetime.now(UTC)
    observed_at = payload.capture.captured_at

    extraction_ok = not any(
        issue.expectation in BLOCKING_EXPECTATIONS for issue in payload.extraction_report
    )

    capture = Capture(
        client_capture_id=payload.capture.client_capture_id,
        client_name=payload.client.name,
        client_version=payload.client.version,
        captured_at=observed_at,
        received_at=now,
        comp_search_query=payload.capture.comp_search_query,
        comp_count=len(payload.comps),
        extraction_ok=extraction_ok,
    )
    session.add(capture)
    session.flush()

    listings_ingested = 0
    observations_written = 0
    seen_listing_ids: set[int] = set()
    seen_seller_ids: set[int] = set()

    for observation_in in [payload.target, *payload.comps]:
        listing, created = _upsert_listing(session, observation_in, observed_at)
        if created:
            listings_ingested += 1

        # A search page can surface the target itself, or the same card twice.
        # One observation per listing per capture, enforced in the schema too.
        if listing.id in seen_listing_ids:
            continue
        seen_listing_ids.add(listing.id)

        seller = _upsert_seller(session, observation_in.seller, observed_at)
        if seller is not None and seller.id not in seen_seller_ids:
            seen_seller_ids.add(seller.id)
            session.add(
                SellerObservation(
                    seller_id=seller.id,
                    capture_id=capture.id,
                    observed_at=observed_at,
                    active_vehicle_listing_count=(
                        observation_in.seller.active_vehicle_listing_count
                        if observation_in.seller
                        else None
                    ),
                    rating_average=(
                        observation_in.seller.rating_average if observation_in.seller else None
                    ),
                    rating_count=(
                        observation_in.seller.rating_count if observation_in.seller else None
                    ),
                )
            )

        session.add(
            _build_observation(
                observation_in,
                listing_id=listing.id,
                capture_id=capture.id,
                observed_at=observed_at,
                seller_id=seller.id if seller else None,
            )
        )
        observations_written += 1

    for issue in payload.extraction_report:
        session.add(
            ExtractionReport(
                capture_id=capture.id,
                observed_at=observed_at,
                scope=issue.scope,
                field_name=issue.field_name,
                status=issue.status,
                expectation=issue.expectation,
                strategies_attempted=list(issue.strategies_attempted),
                page_signature=issue.page_signature,
            )
        )

    session.flush()
    return IngestResult(
        capture=capture,
        duplicate=False,
        listings_ingested=listings_ingested,
        observations_written=observations_written,
        extraction_reports_written=len(payload.extraction_report),
    )


def _count_observations(session: Session, capture_id: int) -> int:
    return session.scalar(
        select(func.count()).select_from(ListingObservation).where(
            ListingObservation.capture_id == capture_id
        )
    ) or 0


def _build_observation(
    obs: ObservationIn,
    *,
    listing_id: int,
    capture_id: int,
    observed_at: datetime,
    seller_id: int | None,
) -> ListingObservation:
    return ListingObservation(
        listing_id=listing_id,
        capture_id=capture_id,
        observed_at=observed_at,
        role=obs.role,
        price_cents=obs.price_cents,
        currency=obs.currency,
        mileage=obs.mileage,
        mileage_unit=obs.mileage_unit,
        year=obs.year,
        make=obs.make,
        model=obs.model,
        trim_text=obs.trim_text,
        title_status=obs.title_status,
        description=redact_contact_details(obs.description),
        photo_count=obs.photo_count,
        posted_at=obs.posted_at,
        posted_relative_text=obs.posted_relative_text,
        price_changed=obs.price_changed,
        location_text=obs.location_text,
        latitude=obs.latitude,
        longitude=obs.longitude,
        listing_url=obs.listing_url,
        seller_id=seller_id,
        field_strategies=dict(obs.field_strategies),
        raw_extract=obs.raw_extract,
    )


def _upsert_listing(
    session: Session, obs: ObservationIn, observed_at: datetime
) -> tuple[Listing, bool]:
    listing = session.scalar(
        select(Listing).where(
            Listing.source == obs.source,
            Listing.source_listing_id == obs.source_listing_id,
        )
    )
    created = False

    if listing is None:
        listing = Listing(
            source=obs.source,
            source_listing_id=obs.source_listing_id,
            first_observed_at=observed_at,
            last_observed_at=observed_at,
        )
        try:
            with session.begin_nested():
                session.add(listing)
        except IntegrityError:
            # Lost a race with a concurrent capture of the same listing.
            listing = session.scalar(
                select(Listing).where(
                    Listing.source == obs.source,
                    Listing.source_listing_id == obs.source_listing_id,
                )
            )
            assert listing is not None
        else:
            created = True

    if observed_at > _as_utc(listing.last_observed_at):
        listing.last_observed_at = observed_at
    if observed_at < _as_utc(listing.first_observed_at):
        listing.first_observed_at = observed_at

    # A VIN recovered on any sighting is retained for all of them: it is a fact
    # about the vehicle, not about the moment it was scraped.
    if obs.vin and not listing.vin:
        listing.vin = obs.vin

    key = compute_relisting_key(
        year=obs.year,
        make=obs.make,
        model=obs.model,
        mileage=obs.mileage,
        location_text=obs.location_text,
    )
    if key and not listing.relisting_key:
        listing.relisting_key = key

    session.flush()
    return listing, created


def _upsert_seller(
    session: Session, seller_in: SellerIn | None, observed_at: datetime
) -> Seller | None:
    if seller_in is None:
        return None

    seller = session.scalar(
        select(Seller).where(
            Seller.seller_hash == seller_in.seller_hash,
            Seller.hash_version == seller_in.hash_version,
        )
    )

    if seller is None:
        seller = Seller(
            seller_hash=seller_in.seller_hash,
            hash_version=seller_in.hash_version,
            first_seen_at=observed_at,
            last_seen_at=observed_at,
        )
        try:
            with session.begin_nested():
                session.add(seller)
        except IntegrityError:
            seller = session.scalar(
                select(Seller).where(
                    Seller.seller_hash == seller_in.seller_hash,
                    Seller.hash_version == seller_in.hash_version,
                )
            )
            assert seller is not None

    if observed_at > _as_utc(seller.last_seen_at):
        seller.last_seen_at = observed_at
    if observed_at < _as_utc(seller.first_seen_at):
        seller.first_seen_at = observed_at

    session.flush()
    return seller
