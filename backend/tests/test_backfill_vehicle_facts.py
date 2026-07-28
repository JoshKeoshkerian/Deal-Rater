"""Backfill of the decomposed trim columns (app/cli/backfill_vehicle_facts.py).

The backfill exists because `raw_extract.title` retains the verbatim listing
title, separator and all -- which `docs/schema.md` says is exactly what that
whitelist is for: "so a parser fix can be re-derived against observations
already collected instead of needing a fresh scrape of listings that may be
gone."

What these tests mostly pin is the boundary: what it must NOT invent.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from app.cli.backfill_vehicle_facts import run
from app.models import Capture, Listing, ListingObservation

NOW = datetime(2026, 7, 28, tzinfo=UTC)


@pytest.fixture
def stored(session):
    """Three observations spanning the cases the backfill has to distinguish."""
    capture = Capture(
        client_capture_id="11111111-1111-4111-8111-111111111111",
        client_name="test",
        client_version="0",
        captured_at=NOW,
        received_at=NOW,
        comp_count=0,
    )
    session.add(capture)
    session.flush()

    rows = []
    for i, (trim, title) in enumerate(
        [
            # Catalog trim: the separator survived in the stored title.
            ("Touring Sport Utility 4D", "2016 Mazda CX-5 · Touring Sport Utility 4D"),
            # Seller-typed: no separator anywhere.
            ("grand touring awd", "2016 Mazda cx-5 grand touring awd"),
            # A trim with no title retained: unattributable, and must stay so.
            ("LX Sedan 4D", None),
        ]
    ):
        listing = Listing(
            source="facebook_marketplace",
            source_listing_id=f"l{i}",
            first_observed_at=NOW,
            last_observed_at=NOW,
        )
        session.add(listing)
        session.flush()
        observation = ListingObservation(
            listing_id=listing.id,
            capture_id=capture.id,
            observed_at=NOW,
            role="comp",
            trim_text=trim,
            field_strategies={},
            raw_extract={"title": title} if title else {},
        )
        session.add(observation)
        rows.append(observation)

    session.flush()
    return rows


def test_decomposes_every_stored_trim(session, stored, capsys):
    assert run(session, dry_run=False) == 0
    session.flush()

    catalog, seller_typed, no_title = stored
    assert catalog.trim_level == "touring"
    assert catalog.body_style == "sport_utility"
    assert seller_typed.trim_level == "grand touring"
    assert seller_typed.drivetrain == "awd"
    assert no_title.trim_level == "lx"


def test_recovers_trim_provenance_from_the_stored_title(session, stored):
    run(session, dry_run=False)
    session.flush()

    catalog, seller_typed, no_title = stored
    assert catalog.trim_source == "fb_catalog"
    assert seller_typed.trim_source == "title_text"
    # No title was retained, so the trim cannot be attributed. Guessing
    # `title_text` would overstate what is known about the row.
    assert no_title.trim_source is None


def test_never_invents_seller_type_or_transmission(session, stored):
    """The fields that were never captured stay NULL.

    Nothing was stored to recover them from -- the payload keys were wrong, so
    tier 1 never fired. Inferring a seller type from anything else would make a
    comp set read "dealers excluded" when no dealer check ever ran, which is
    precisely the false authority spec 9 exists to prevent.
    """
    run(session, dry_run=False)
    session.flush()

    assert all(o.seller_type is None for o in stored)
    assert all(o.transmission is None for o in stored)


def test_dry_run_writes_nothing(session, stored):
    assert run(session, dry_run=True) == 0
    session.flush()
    assert all(o.trim_level is None for o in stored)
    assert all(o.trim_source is None for o in stored)


def test_is_idempotent(session, stored):
    run(session, dry_run=False)
    session.flush()
    first = [(o.trim_level, o.body_style, o.trim_source) for o in stored]

    run(session, dry_run=False)
    session.flush()
    assert [(o.trim_level, o.body_style, o.trim_source) for o in stored] == first


def test_reports_rather_than_failing_on_an_empty_table(session, capsys):
    assert run(session, dry_run=False) == 0
    assert "nothing to backfill" in capsys.readouterr().out
