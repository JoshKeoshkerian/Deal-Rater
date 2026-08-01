"""Programmatic retention enforcement (spec 8.2).

Run on a schedule you own:

    python -m app.retention              # delete, using DEAL_RATER_RETENTION_DAYS
    python -m app.retention --dry-run    # report only
    python -m app.retention --days 180

Deletion order follows the foreign keys: observations first, then the identity
rows that no longer have any observation behind them. A `sellers` row with no
remaining observations is a bare hash with nothing attached, so it goes too.

`listings` rows are dropped only once every observation of them has aged out,
which means the identity of a listing survives exactly as long as the evidence
that it existed. That is the intended behaviour: retention should not leave
orphaned identifiers behind.

SAVED EVALUATIONS ARE NOT DELETED HERE, and that is deliberate rather than an
oversight. `saved_evaluations.capture_id` and `.listing_id` are ON DELETE SET
NULL -- the only capture foreign keys in this schema that are not CASCADE -- so
this pass nulls them and leaves the row. The stored snapshot is the payload and
a user's bookmark is their data, not observation data; emptying someone's saved
list on a retention schedule they never saw would be a surprising thing for a
privacy control to do. What the NULL costs is the ability to re-run the
assessment from stored observations, which the wire contract reports as
`snapshot_only` (see `schemas.SavedEvaluationOut`).
"""

from __future__ import annotations

import argparse
from dataclasses import asdict, dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, exists, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import SessionLocal
from app.models import (
    Capture,
    ExtractionReport,
    Listing,
    ListingObservation,
    Seller,
    SellerObservation,
)


@dataclass
class RetentionResult:
    cutoff: str
    listing_observations: int
    seller_observations: int
    extraction_reports: int
    captures: int
    listings: int
    sellers: int
    dry_run: bool


def enforce_retention(
    session: Session, *, days: int, dry_run: bool = False, now: datetime | None = None
) -> RetentionResult:
    cutoff = (now or datetime.now(UTC)) - timedelta(days=days)

    if dry_run:
        counts = _count_expired(session, cutoff)
        return RetentionResult(cutoff=cutoff.isoformat(), dry_run=True, **counts)

    listing_obs = session.execute(
        delete(ListingObservation).where(ListingObservation.observed_at < cutoff)
    ).rowcount
    seller_obs = session.execute(
        delete(SellerObservation).where(SellerObservation.observed_at < cutoff)
    ).rowcount
    reports = session.execute(
        delete(ExtractionReport).where(ExtractionReport.observed_at < cutoff)
    ).rowcount

    captures = session.execute(
        delete(Capture).where(
            Capture.captured_at < cutoff,
            ~exists().where(ListingObservation.capture_id == Capture.id),
        )
    ).rowcount

    listings = session.execute(
        delete(Listing).where(~exists().where(ListingObservation.listing_id == Listing.id))
    ).rowcount

    sellers = session.execute(
        delete(Seller).where(
            ~exists().where(SellerObservation.seller_id == Seller.id),
            ~exists().where(ListingObservation.seller_id == Seller.id),
        )
    ).rowcount

    session.commit()

    return RetentionResult(
        cutoff=cutoff.isoformat(),
        listing_observations=listing_obs,
        seller_observations=seller_obs,
        extraction_reports=reports,
        captures=captures,
        listings=listings,
        sellers=sellers,
        dry_run=False,
    )


def _count_expired(session: Session, cutoff: datetime) -> dict[str, int]:
    from sqlalchemy import func

    def count(model, column) -> int:
        return session.scalar(select(func.count()).select_from(model).where(column < cutoff)) or 0

    return {
        "listing_observations": count(ListingObservation, ListingObservation.observed_at),
        "seller_observations": count(SellerObservation, SellerObservation.observed_at),
        "extraction_reports": count(ExtractionReport, ExtractionReport.observed_at),
        "captures": count(Capture, Capture.captured_at),
        # Identity rows are deleted by reachability rather than by age, so a
        # dry run cannot count them without simulating the cascade.
        "listings": 0,
        "sellers": 0,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Enforce the data retention window.")
    parser.add_argument("--days", type=int, default=None)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    days = args.days if args.days is not None else get_settings().retention_days
    with SessionLocal() as session:
        result = enforce_retention(session, days=days, dry_run=args.dry_run)

    for key, value in asdict(result).items():
        print(f"{key}: {value}")


if __name__ == "__main__":
    main()
