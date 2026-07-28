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

from ..models import Capture, Listing, ListingObservation, SellerObservation
from .comps import CompCandidate, normalize_key


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
    #: Target-only fields that step 4 (negotiation) reads. Comps carry neither,
    #: which is fine: negotiating position is a property of the listing being
    #: evaluated, not of the market around it.
    target_posted_at: object = None
    target_description: str | None = None
    target_observed_at: object = None
    #: Step 5 (flags) reads these.
    target_photo_count: int | None = None
    target_title_status: str | None = None
    target_vin: str | None = None
    target_price_changed: bool | None = None
    #: The seller's Marketplace star rating, as of this capture (spec 6.3).
    #: A reputation number read straight off the listing page, not identity --
    #: see `SellerObservation`'s docstring. None when the seller has no
    #: rating widget yet, or no seller was identified at all.
    target_seller_rating_average: float | None = None
    target_seller_rating_count: int | None = None


#: Tesla's Marketplace listings carry `model="Model"` for every one of the 3, S,
#: X and Y -- different vehicles, different platforms, different price tiers --
#: with the distinguishing letter sitting at the front of `trim_text` instead
#: (verified against every captured Tesla row: all 41 have model="Model"). Left
#: alone, spec 4.3's comp filter matches on `model` and treats trim only as a
#: soft signal that never excludes, so a Model S becomes a valid mileage-fit
#: comp for a Model 3 -- confirmed on captured data as a $0-$34,399 expected
#: range for a $14,000 Model 3.
#:
#: A DB query across every captured make found this exact "generic model word,
#: real identifier stuck in trim" pattern nowhere else with the same severity --
#: other wide-trim-spread cases (BMW 7 Series' 740i/750i/760i, Lexus RC's
#: 200t/300/350) are genuine trim variance within a correctly matched model, not
#: a mismatched `model` field, so they are left to the trim-preference fit
#: (below) rather than folded in here. Scoped to the one confirmed case rather
#: than a guessed-at general rule.
_TESLA_MODEL_LETTERS = {"3", "S", "X", "Y"}


def _resolve_tesla_model(
    make: str | None, model: str | None, trim_text: str | None
) -> tuple[str | None, str | None]:
    """Comp-matching (model, trim_text), correcting Tesla's generic `model` field.

    Moves the letter out of `trim_text` rather than duplicating it, so a
    display that joins model and trim reads "Model 3 Long Range" and not
    "Model 3 3 Long Range".
    """
    if not model or normalize_key(make) != "tesla" or normalize_key(model) != "model":
        return model, trim_text
    if not trim_text or not trim_text.strip():
        return model, trim_text
    tokens = trim_text.strip().split()
    first_token = tokens[0].upper()
    if first_token not in _TESLA_MODEL_LETTERS:
        return model, trim_text
    rest = " ".join(tokens[1:])
    return f"Model {first_token}", (rest or None)


def _to_candidate(obs: ListingObservation, listing: Listing) -> CompCandidate:
    raw = obs.raw_extract or {}
    title = raw.get("title") if isinstance(raw, dict) else None
    model, trim_text = _resolve_tesla_model(obs.make, obs.model, obs.trim_text)
    return CompCandidate(
        listing_id=listing.id,
        source_listing_id=listing.source_listing_id,
        year=obs.year,
        make=obs.make,
        model=model,
        trim_text=trim_text,
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

        rating_average: float | None = None
        rating_count: int | None = None
        target_seller_id = target_row[0].seller_id
        if target_seller_id is not None:
            seller_obs = session.scalar(
                select(SellerObservation).where(
                    SellerObservation.capture_id == capture.id,
                    SellerObservation.seller_id == target_seller_id,
                )
            )
            if seller_obs is not None:
                rating_average = (
                    float(seller_obs.rating_average)
                    if seller_obs.rating_average is not None
                    else None
                )
                rating_count = seller_obs.rating_count

        query = capture.comp_search_query or {}
        out.append(
            StoredCapture(
                capture_id=capture.id,
                client_capture_id=capture.client_capture_id,
                captured_at=capture.captured_at,
                target=_to_candidate(target_row[0], target_row[1]),
                target_observation_id=target_row[0].id,
                target_posted_at=target_row[0].posted_at,
                target_description=target_row[0].description,
                target_observed_at=target_row[0].observed_at,
                target_photo_count=target_row[0].photo_count,
                target_title_status=target_row[0].title_status,
                target_vin=target_row[1].vin,
                target_price_changed=target_row[0].price_changed,
                target_seller_rating_average=rating_average,
                target_seller_rating_count=rating_count,
                candidates=[_to_candidate(o, listing) for o, listing in rows if o.role == "comp"],
                location_scoped=query.get("location_scoped"),
                search_query=query.get("query"),
            )
        )
    return out
