"""Load stored captures into the shapes the pricing model works on.

The pricing package deliberately knows nothing about SQLAlchemy -- every module
in it takes plain dataclasses -- so this is the one adapter between the two.
That is what lets the model be unit tested without a database, and what lets the
comp filter be re-run over historical captures after a rule changes.
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Capture, Listing, ListingObservation
from .comps import CompCandidate


@dataclass(frozen=True)
class StoredCapture:
    """One user click, reassembled: the target and the comps found for it."""

    capture_id: int
    client_capture_id: str
    captured_at: object
    target: CompCandidate
    target_observation_id: int
    candidates: list[CompCandidate]
    #: From `comp_search_query.location_scoped`. None for captures taken before
    #: the search carried the listing's own coordinates -- which is every
    #: capture currently stored, and the reason that flag exists.
    location_scoped: bool | None
    search_query: str | None


def _to_candidate(obs: ListingObservation, listing: Listing) -> CompCandidate:
    raw = obs.raw_extract or {}
    title = raw.get("title") if isinstance(raw, dict) else None
    return CompCandidate(
        listing_id=listing.id,
        source_listing_id=listing.source_listing_id,
        year=obs.year,
        make=obs.make,
        model=obs.model,
        trim_text=obs.trim_text,
        price_cents=obs.price_cents,
        mileage=obs.mileage,
        location_text=obs.location_text,
        relisting_key=listing.relisting_key,
        listing_url=obs.listing_url,
        title=title if isinstance(title, str) else None,
    )


def load_captures(session: Session, capture_ids: list[int] | None = None) -> list[StoredCapture]:
    """Reassemble stored captures, newest first."""
    stmt = select(Capture).order_by(Capture.captured_at.desc())
    if capture_ids:
        stmt = stmt.where(Capture.id.in_(capture_ids))

    out: list[StoredCapture] = []
    for capture in session.scalars(stmt):
        rows = session.execute(
            select(ListingObservation, Listing)
            .join(Listing, Listing.id == ListingObservation.listing_id)
            .where(ListingObservation.capture_id == capture.id)
        ).all()

        target_row = next((r for r in rows if r[0].role == "target"), None)
        if target_row is None:
            # A capture with no target is not evaluable. It is still a valid
            # observation row for the phase-three history, so it is skipped
            # rather than treated as an error.
            continue

        query = capture.comp_search_query or {}
        out.append(
            StoredCapture(
                capture_id=capture.id,
                client_capture_id=capture.client_capture_id,
                captured_at=capture.captured_at,
                target=_to_candidate(target_row[0], target_row[1]),
                target_observation_id=target_row[0].id,
                candidates=[_to_candidate(o, listing) for o, listing in rows if o.role == "comp"],
                location_scoped=query.get("location_scoped"),
                search_query=query.get("query"),
            )
        )
    return out
