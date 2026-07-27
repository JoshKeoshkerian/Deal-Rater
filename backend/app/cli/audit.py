"""Audit stored observations for identity corruption and duplication.

    python -m app.cli.audit
    python -m app.cli.audit --delete-corrupt

REPORT ONLY BY DEFAULT. Deletion requires --delete-corrupt and prints every row
it will remove first.

WHAT IT LOOKS FOR
-----------------
identity corruption
    One `source_listing_id` describing two different vehicles. Marketplace is a
    single-page app: clicking from listing A to listing B swaps the URL before
    B's payload arrives, and the extractor used to pair the new id with the old
    listing's data. Captured data contains one such row -- listing
    2061074687826390 appearing as both a 2010 Mercedes C-Class and a 2017
    Infiniti Q50.

    This is the most damaging defect the pipeline can produce, because spec 4.4
    keys a per-listing time series on that id. A mismatch does not just add a
    bad row; it attributes one car's price history to another, and every
    phase-three feature reads it as fact.

    The extractor no longer guesses (see `findTargetListingNode`), so this
    should find nothing in data captured after that fix. It stays because the
    check is cheap and the failure is silent.

duplicate targets
    The same vehicle captured more than once. Legitimate for the time series --
    that is the point of append-only observations -- but it double-counts in a
    ground truth set, where each vehicle should be judged once.
"""

from __future__ import annotations

import argparse
from collections import defaultdict

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import session_scope
from ..models import GroundTruthLabel, Listing, ListingObservation


def _targets(session: Session):
    return session.execute(
        select(ListingObservation, Listing)
        .join(Listing, Listing.id == ListingObservation.listing_id)
        .where(ListingObservation.role == "target")
        .order_by(ListingObservation.capture_id)
    ).all()


def _vehicle(obs: ListingObservation) -> tuple:
    return (obs.year, (obs.make or "").lower(), (obs.model or "").lower())


def _describe(obs: ListingObservation) -> str:
    price = f"${(obs.price_cents or 0) / 100:,.0f}"
    mileage = f"{obs.mileage:,}mi" if obs.mileage else "unknown mileage"
    return (
        f"capture {obs.capture_id:>3}  obs {obs.id:>4}  "
        f"{obs.year or '????'} {obs.make or '?'} {obs.model or '?'}  {price}  {mileage}"
    )


def find_corrupt(session: Session) -> list[ListingObservation]:
    """Observations sharing a listing id with a different vehicle.

    The newest observation for a corrupted id is kept and the older ones are
    reported for removal: the id belongs to whichever listing the URL pointed
    at, and the stale payload is what got mispaired onto it.
    """
    by_listing: dict[str, list[ListingObservation]] = defaultdict(list)
    for obs, listing in _targets(session):
        by_listing[listing.source_listing_id].append(obs)

    corrupt: list[ListingObservation] = []
    for entries in by_listing.values():
        if len({_vehicle(o) for o in entries}) <= 1:
            continue
        newest = max(entries, key=lambda o: o.capture_id)
        corrupt.extend(o for o in entries if o.id != newest.id)
    return corrupt


def find_duplicate_vehicles(session: Session) -> dict[tuple, list[ListingObservation]]:
    """Same vehicle at the same price, captured more than once."""
    groups: dict[tuple, list[ListingObservation]] = defaultdict(list)
    for obs, _ in _targets(session):
        if obs.make and obs.model:
            groups[(*_vehicle(obs), obs.price_cents, obs.mileage)].append(obs)
    return {k: v for k, v in groups.items() if len(v) > 1}


def run(session: Session, delete_corrupt: bool) -> int:
    targets = _targets(session)
    corrupt = find_corrupt(session)
    duplicates = find_duplicate_vehicles(session)

    print(f"\nTarget observations: {len(targets)}")

    print(f"\nIDENTITY CORRUPTION: {len(corrupt)} observation(s)")
    if corrupt:
        print("  One listing id describing two different vehicles. Spec 4.4 keys the")
        print("  per-listing time series on this id, so these poison price history.")
        for obs in corrupt:
            print(f"    {_describe(obs)}")
    else:
        print("  None found.")

    print(f"\nDUPLICATE VEHICLES: {len(duplicates)} group(s)")
    if duplicates:
        print("  Fine for the time series, but each should be labelled only once.")
        for entries in duplicates.values():
            captures = ", ".join(str(o.capture_id) for o in entries)
            print(f"    {_describe(entries[0])}   also in capture(s) {captures}")
    else:
        print("  None found.")

    if not corrupt:
        return 0

    if not delete_corrupt:
        print("\nRe-run with --delete-corrupt to remove the corrupted observation(s).")
        return 0

    labelled = {
        row.observation_id
        for row in session.scalars(
            select(GroundTruthLabel).where(
                GroundTruthLabel.observation_id.in_([o.id for o in corrupt])
            )
        )
    }
    if labelled:
        # A human verdict on a row means someone spent judgement on it, and the
        # vehicle they judged is not the one the id claims. Refusing is safer
        # than silently discarding that work.
        print(f"\nREFUSING: {len(labelled)} of these carry a ground truth label.")
        print("Remove the label first if you are sure; the labelled vehicle may be real.")
        return 1

    for obs in corrupt:
        print(f"  deleting {_describe(obs)}")
        session.delete(obs)
    session.commit()
    print(f"\nDeleted {len(corrupt)} corrupted observation(s).")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Audit observations for identity corruption and duplication.",
    )
    parser.add_argument(
        "--delete-corrupt",
        action="store_true",
        help="remove observations whose listing id describes a different vehicle",
    )
    args = parser.parse_args(argv)

    with session_scope() as session:
        return run(session, args.delete_corrupt)


if __name__ == "__main__":
    raise SystemExit(main())
