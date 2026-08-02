"""Save, unsave, and list -- through the API, with a real session.

`?offline=true` throughout, for the same reason `test_api.py` uses it on the
evaluation endpoint: the suite must not make network calls.
"""

from __future__ import annotations

from datetime import datetime

import pytest
from sqlalchemy import select

from app.auth.service import request_sign_in, verify_code
from app.config import Settings
from app.models import Capture, Listing, SavedEvaluation
from app.retention import enforce_retention

from .conftest import capture_payload, observation


def _instant(raw: str) -> datetime:
    return datetime.fromisoformat(raw.replace("Z", "+00:00")).replace(tzinfo=None)


@pytest.fixture
def settings() -> Settings:
    return Settings(resend_api_key="test-key")


def sign_in(session, settings, email: str = "buyer@example.com") -> dict[str, str]:
    """A ready-to-use Authorization header for `email`."""
    normalized, code = request_sign_in(session, settings, email=email)
    issued = verify_code(session, settings, email=normalized, code=code)
    session.commit()
    return {"Authorization": f"Bearer {issued.token}"}


def ingest(client, **kwargs) -> int:
    response = client.post("/v1/captures", json=capture_payload(**kwargs))
    assert response.status_code == 201, response.text
    return response.json()["capture_id"]


# --- authentication ---------------------------------------------------------


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("get", "/v1/evaluations/1/save"),
        ("post", "/v1/evaluations/1/save"),
        ("delete", "/v1/evaluations/1/save"),
        ("get", "/v1/users/me/saved"),
        ("get", "/v1/users/me"),
    ],
)
def test_every_saved_endpoint_needs_a_session(client, method, path):
    assert getattr(client, method)(path).status_code == 401


def test_a_bad_token_is_not_a_session(client):
    response = client.get(
        "/v1/users/me/saved", headers={"Authorization": "Bearer nope"}
    )
    assert response.status_code == 401


def test_capture_ingest_is_still_unauthenticated(client):
    """This change adds accounts; it does not gate the capture path. Anything
    that quietly required a session here would break every install."""
    assert ingest(client) > 0


# --- saving -----------------------------------------------------------------


def test_save_then_read_it_back(client, session, settings):
    auth = sign_in(session, settings)
    capture_id = ingest(client)

    saved = client.post(f"/v1/evaluations/{capture_id}/save?offline=true", headers=auth)
    assert saved.status_code == 201, saved.text
    body = saved.json()
    assert body["capture_id"] == capture_id
    assert body["snapshot_only"] is False
    assert body["vehicle"].startswith("2014 Toyota Camry")

    listed = client.get("/v1/users/me/saved", headers=auth)
    assert listed.status_code == 200
    items = listed.json()["items"]
    assert len(items) == 1
    # The full evaluation contract, not a thinner second serialization.
    assert items[0]["evaluation"]["deal_score"]["beta"] is True
    assert items[0]["evaluation"]["capture_id"] == capture_id


def test_vehicle_label_does_not_repeat_a_trim_that_matches_the_model(client, session, settings):
    """Some models (e.g. Subaru's WRX) get restated as their own catalog trim,
    so `model` and `trim_text` can independently resolve to the identical
    string. Saved as "2017 Subaru WRX WRX" before the fix in
    `services/serialize.py`'s `_vehicle_label`."""
    auth = sign_in(session, settings)
    capture_id = ingest(
        client,
        target=observation(year=2017, make="Subaru", model="WRX", trim_text="WRX"),
    )

    saved = client.post(f"/v1/evaluations/{capture_id}/save?offline=true", headers=auth)
    assert saved.json()["vehicle"] == "2017 Subaru WRX"


def test_saving_twice_creates_one_row(client, session, settings):
    auth = sign_in(session, settings)
    capture_id = ingest(client)

    first = client.post(f"/v1/evaluations/{capture_id}/save?offline=true", headers=auth)
    second = client.post(f"/v1/evaluations/{capture_id}/save?offline=true", headers=auth)

    assert first.status_code == 201
    assert second.status_code == 200
    assert first.json()["id"] == second.json()["id"]
    assert len(client.get("/v1/users/me/saved", headers=auth).json()["items"]) == 1


def test_re_saving_does_not_overwrite_the_snapshot(client, session, settings):
    """Idempotent means the second call does not quietly replace the figures
    the user saved with today's. Refreshing them is a separate action."""
    auth = sign_in(session, settings)
    capture_id = ingest(client)

    first = client.post(f"/v1/evaluations/{capture_id}/save?offline=true", headers=auth).json()
    row = session.scalars(select(SavedEvaluation)).one()
    row.evaluation = {**row.evaluation, "headline": "a snapshot from before"}
    session.commit()

    second = client.post(f"/v1/evaluations/{capture_id}/save?offline=true", headers=auth).json()

    # Compared as instants rather than as strings: SQLite drops the timezone on
    # the round trip, so the re-read carries no `Z` even though the value is
    # identical. Postgres round-trips it and both would be aware.
    assert _instant(second["evaluated_at"]) == _instant(first["evaluated_at"])
    assert second["evaluation"]["headline"] == "a snapshot from before"


def test_saving_an_unknown_capture_is_404(client, session, settings):
    auth = sign_in(session, settings)
    assert client.post("/v1/evaluations/9999/save?offline=true", headers=auth).status_code == 404


def test_saved_state_reflects_save_and_unsave(client, session, settings):
    auth = sign_in(session, settings)
    capture_id = ingest(client)
    state = f"/v1/evaluations/{capture_id}/save"

    assert client.get(state, headers=auth).json()["saved"] is False
    client.post(f"{state}?offline=true", headers=auth)
    assert client.get(state, headers=auth).json()["saved"] is True
    assert client.delete(state, headers=auth).status_code == 204
    assert client.get(state, headers=auth).json()["saved"] is False


def test_unsaving_something_not_saved_is_still_204(client, session, settings):
    auth = sign_in(session, settings)
    capture_id = ingest(client)

    assert client.delete(f"/v1/evaluations/{capture_id}/save", headers=auth).status_code == 204


# --- isolation between users ------------------------------------------------


def test_one_users_list_is_not_anothers(client, session, settings):
    alice = sign_in(session, settings, "alice@example.com")
    bob = sign_in(session, settings, "bob@example.com")
    capture_id = ingest(client)

    client.post(f"/v1/evaluations/{capture_id}/save?offline=true", headers=alice)

    assert len(client.get("/v1/users/me/saved", headers=alice).json()["items"]) == 1
    assert client.get("/v1/users/me/saved", headers=bob).json()["items"] == []
    assert client.get(f"/v1/evaluations/{capture_id}/save", headers=bob).json()["saved"] is False


def test_one_user_cannot_unsave_anothers(client, session, settings):
    alice = sign_in(session, settings, "alice@example.com")
    bob = sign_in(session, settings, "bob@example.com")
    capture_id = ingest(client)
    client.post(f"/v1/evaluations/{capture_id}/save?offline=true", headers=alice)

    client.delete(f"/v1/evaluations/{capture_id}/save", headers=bob)

    assert len(client.get("/v1/users/me/saved", headers=alice).json()["items"]) == 1


def test_two_users_can_save_the_same_capture(client, session, settings):
    alice = sign_in(session, settings, "alice@example.com")
    bob = sign_in(session, settings, "bob@example.com")
    capture_id = ingest(client)

    assert (
        client.post(f"/v1/evaluations/{capture_id}/save?offline=true", headers=alice).status_code
        == 201
    )
    assert (
        client.post(f"/v1/evaluations/{capture_id}/save?offline=true", headers=bob).status_code
        == 201
    )


# --- ordering ---------------------------------------------------------------


def test_list_is_most_recent_first(client, session, settings):
    auth = sign_in(session, settings)
    ids = [
        ingest(client, target=observation(source_listing_id=f"10000000000000{n}"))
        for n in range(3)
    ]
    for capture_id in ids:
        client.post(f"/v1/evaluations/{capture_id}/save?offline=true", headers=auth)

    items = client.get("/v1/users/me/saved", headers=auth).json()["items"]
    listed = [item["capture_id"] for item in items]

    assert listed == list(reversed(ids))


# --- retention --------------------------------------------------------------


def test_retention_nulls_the_link_but_keeps_the_snapshot(client, session, settings):
    """The one place this schema does not CASCADE off captures. A user's saved
    list must not empty itself on a retention schedule they never saw."""
    auth = sign_in(session, settings)
    capture_id = ingest(client)
    client.post(f"/v1/evaluations/{capture_id}/save?offline=true", headers=auth)

    enforce_retention(session, days=0)

    assert session.get(Capture, capture_id) is None
    assert session.scalars(select(Listing)).all() == []

    items = client.get("/v1/users/me/saved", headers=auth).json()["items"]
    assert len(items) == 1
    assert items[0]["snapshot_only"] is True
    assert items[0]["capture_id"] == capture_id
    # The card still renders in full: the snapshot is the payload.
    assert items[0]["evaluation"]["vehicle"].startswith("2014 Toyota Camry")


def test_unsave_still_works_after_retention(client, session, settings):
    """`source_capture_id` is a plain column for exactly this reason -- matching
    on the nullable foreign key would strand the row as un-unsaveable."""
    auth = sign_in(session, settings)
    capture_id = ingest(client)
    client.post(f"/v1/evaluations/{capture_id}/save?offline=true", headers=auth)
    enforce_retention(session, days=0)

    assert client.delete(f"/v1/evaluations/{capture_id}/save", headers=auth).status_code == 204
    assert client.get("/v1/users/me/saved", headers=auth).json()["items"] == []
