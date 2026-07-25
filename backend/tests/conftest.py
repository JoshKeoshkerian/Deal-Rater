"""Test fixtures.

The suite runs against in-memory SQLite so it needs no server. The models use
a JSON/JSONB variant and portable column types specifically so this works; the
Alembic migration targets Postgres and is what production uses.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import get_session
from app.main import app
from app.models import Base


@pytest.fixture
def engine():
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )

    @event.listens_for(engine, "connect")
    def _fk_on(dbapi_connection, _record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    Base.metadata.create_all(engine)
    yield engine
    engine.dispose()


@pytest.fixture
def session(engine) -> Session:
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False, future=True)
    with factory() as s:
        yield s


@pytest.fixture
def client(session) -> TestClient:
    app.dependency_overrides[get_session] = lambda: session
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


# Relative to now so that the telemetry window in test_api stays valid whenever
# the suite is run.
CAPTURED_AT = datetime.now(UTC).replace(microsecond=0)


def observation(
    *,
    role: str = "target",
    source_listing_id: str = "100000000000001",
    **overrides,
) -> dict:
    """A fully populated observation. Tests override individual fields to
    produce the edge cases."""
    base = {
        "source": "facebook_marketplace",
        "source_listing_id": source_listing_id,
        "listing_url": f"https://www.facebook.com/marketplace/item/{source_listing_id}/",
        "role": role,
        "price_cents": 1_290_000,
        "currency": "USD",
        "mileage": 96_400,
        "mileage_unit": "mi",
        "year": 2014,
        "make": "Toyota",
        "model": "Camry",
        "trim_text": "SE",
        "title_status": "clean",
        "description": "Runs great, no issues. Clean title.",
        "photo_count": 12,
        "posted_at": "2026-07-04T00:00:00Z",
        "posted_relative_text": "listed 3 weeks ago",
        "price_changed": False,
        "location_text": "Tulsa, OK",
        "latitude": "36.153980",
        "longitude": "-95.992775",
        "vin": "4T1BF1FK5EU123456",
        "seller": {
            "seller_hash": "a" * 64,
            "hash_version": 1,
            "active_vehicle_listing_count": 1,
        },
        "field_strategies": {"price_cents": "json_payload", "mileage": "text_pattern"},
        "raw_extract": {"title": "2014 Toyota Camry SE"},
    }
    base.update(overrides)
    return base


def capture_payload(
    *,
    target: dict | None = None,
    comps: list[dict] | None = None,
    extraction_report: list[dict] | None = None,
    client_capture_id: str | None = None,
    captured_at: datetime = CAPTURED_AT,
) -> dict:
    return {
        "client": {"name": "chrome-extension", "version": "0.1.0"},
        "capture": {
            "client_capture_id": client_capture_id or str(uuid.uuid4()),
            "captured_at": captured_at.isoformat(),
            "comp_search_query": {"query": "2014 Toyota Camry", "radius_miles": 60},
        },
        "target": target if target is not None else observation(),
        "comps": comps if comps is not None else [],
        "extraction_report": extraction_report or [],
    }
